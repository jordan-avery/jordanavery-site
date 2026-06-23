"""
CLV Engine — core analytical model.

Pipeline:
  1. Ingest whatever data sources are available (CRM required; rest optional)
  2. Build RFM summary from CRM transactions
  3. Fit BG/NBD model → predict future purchase frequency
  4. Fit Gamma-Gamma model → predict expected order value
  5. Compute predicted CLV = freq × AOV × margin × time_horizon
  6. Enrich with GA4 behavioural signals (if available)
  7. Compute CLV:CAC ratio by channel (if media spend available)
  8. Segment customers into four actionable tiers
  9. Compute feature importance via lightweight regression
  10. Return structured results dict ready for the API/dashboard

Design principle: every step degrades gracefully.  If GA4 isn't provided,
we skip the behavioural enrichment.  If media spend isn't provided, the
CLV:CAC matrix is omitted from the output.  The dashboard adapts accordingly.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from lifetimes import BetaGeoFitter, GammaGammaFitter
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")  # lifetimes emits convergence noise


# ---------------------------------------------------------------------------
# Data source container
# ---------------------------------------------------------------------------

@dataclass
class DataSources:
    """
    Holds optional DataFrames for each data source a user may provide.
    Only `crm` is required.  All others are None by default.
    """
    crm: pd.DataFrame                            # required
    ga4: Optional[pd.DataFrame] = None           # optional
    media_spend: Optional[pd.DataFrame] = None   # optional
    customer_profiles: Optional[pd.DataFrame] = None  # optional

    def available_sources(self) -> list[str]:
        sources = ["crm"]
        if self.ga4 is not None:            sources.append("ga4")
        if self.media_spend is not None:    sources.append("media_spend")
        if self.customer_profiles is not None: sources.append("customer_profiles")
        return sources


# ---------------------------------------------------------------------------
# Step 1 — RFM summary
# ---------------------------------------------------------------------------

def build_rfm(crm: pd.DataFrame, observation_end: Optional[str] = None) -> pd.DataFrame:
    """
    Computes the RFM summary table that BG/NBD expects.

    Returns a DataFrame indexed by customer_id with columns:
      frequency     — repeat purchases (total - 1, min 0)
      recency       — weeks between first and last purchase
      T             — weeks between first purchase and observation end
      monetary_value — mean order value (repeat purchases only)
      total_revenue — raw lifetime spend
      n_transactions — total transaction count
      acquisition_channel, acquisition_date, customer_region
    """
    crm = crm.copy()
    crm["transaction_date"] = pd.to_datetime(crm["transaction_date"])
    crm["acquisition_date"] = pd.to_datetime(crm["acquisition_date"])

    if observation_end is None:
        obs_end = crm["transaction_date"].max() + pd.Timedelta(days=1)
    else:
        obs_end = pd.to_datetime(observation_end)

    # Core RFM aggregation — extend conditionally for optional CRM columns
    agg_kwargs = dict(
        first_purchase      = ("transaction_date", "min"),
        last_purchase       = ("transaction_date", "max"),
        n_transactions      = ("transaction_date", "count"),
        total_revenue       = ("order_value",       "sum"),
        mean_order_value    = ("order_value",       "mean"),
        acquisition_channel = ("acquisition_channel", "first"),
        acquisition_date    = ("acquisition_date",    "first"),
        customer_region     = ("customer_region",     "first"),
    )
    if "gender" in crm.columns:
        agg_kwargs["gender"] = ("gender", "first")
    if "product_category" in crm.columns:
        agg_kwargs["n_unique_products"] = ("product_category", "nunique")

    agg = crm.groupby("customer_id").agg(**agg_kwargs).reset_index()

    # BG/NBD convention: time in weeks, frequency = repeat purchases
    agg["T"]         = (obs_end - agg["first_purchase"]).dt.days / 7
    agg["recency"]   = (agg["last_purchase"] - agg["first_purchase"]).dt.days / 7
    agg["frequency"] = (agg["n_transactions"] - 1).clip(lower=0)

    # Monetary value for Gamma-Gamma: mean of repeat (non-first) purchases per customer.
    # cumcount avoids groupby.apply, which changed behaviour in pandas 2.2+.
    crm_sorted = crm.sort_values(["customer_id", "transaction_date"]).copy()
    crm_sorted["_txn_rank"] = crm_sorted.groupby("customer_id").cumcount()
    repeat_txns = (
        crm_sorted[crm_sorted["_txn_rank"] > 0]
        .groupby("customer_id")["order_value"]
        .mean()
        .reset_index()
        .rename(columns={"order_value": "monetary_value"})
    )
    agg = agg.merge(repeat_txns, on="customer_id", how="left")
    agg["monetary_value"] = agg["monetary_value"].fillna(agg["mean_order_value"])

    return agg.set_index("customer_id")


# ---------------------------------------------------------------------------
# Step 2 — BG/NBD + Gamma-Gamma model
# ---------------------------------------------------------------------------

def fit_clv_model(
    rfm: pd.DataFrame,
    time_horizon_months: int = 12,
    margin: float = 0.30,
    discount_rate: float = 0.01,
) -> pd.DataFrame:
    """
    Fits the BG/NBD and Gamma-Gamma models and returns the RFM table
    enriched with:
      predicted_purchases  — expected repeat purchases in next `time_horizon_months`
      expected_aov         — expected average order value
      predicted_clv        — predicted CLV over the horizon
      p_alive              — probability customer is still active
    """
    rfm = rfm.copy()

    bgf = BetaGeoFitter(penalizer_coef=0.001)
    bgf.fit(
        rfm["frequency"],
        rfm["recency"],
        rfm["T"],
    )

    time_weeks = time_horizon_months * 4.33
    rfm["predicted_purchases"] = bgf.conditional_expected_number_of_purchases_up_to_time(
        time_weeks,
        rfm["frequency"],
        rfm["recency"],
        rfm["T"],
    )
    rfm["p_alive"] = bgf.conditional_probability_alive(
        rfm["frequency"],
        rfm["recency"],
        rfm["T"],
    )

    # Gamma-Gamma: fit only on customers with repeat purchases
    repeat_mask = rfm["frequency"] > 0
    ggf = GammaGammaFitter(penalizer_coef=0.001)
    ggf.fit(
        rfm.loc[repeat_mask, "frequency"],
        rfm.loc[repeat_mask, "monetary_value"],
    )

    rfm["expected_aov"] = rfm["monetary_value"].copy()
    rfm.loc[repeat_mask, "expected_aov"] = ggf.conditional_expected_average_profit(
        rfm.loc[repeat_mask, "frequency"],
        rfm.loc[repeat_mask, "monetary_value"],
    )
    pop_mean_aov = rfm.loc[repeat_mask, "expected_aov"].mean()
    rfm["expected_aov"] = rfm["expected_aov"].fillna(pop_mean_aov)

    rfm["predicted_clv"] = (
        rfm["predicted_purchases"]
        * rfm["expected_aov"]
        * margin
    )
    rfm["predicted_clv"] = rfm["predicted_clv"] / (1 + discount_rate) ** (time_horizon_months / 12)

    return rfm


# ---------------------------------------------------------------------------
# Step 3 — Behavioural enrichment (GA4)
# ---------------------------------------------------------------------------

def enrich_with_ga4(rfm: pd.DataFrame, ga4: pd.DataFrame) -> pd.DataFrame:
    """
    Merges GA4 signals into the RFM table and adds a composite
    `engagement_score` (0–1) that boosts CLV predictions for high-engagers.
    """
    ga4 = ga4.set_index("customer_id") if "customer_id" in ga4.columns else ga4

    merged = rfm.join(ga4, how="left")

    def norm(series: pd.Series) -> pd.Series:
        p99 = series.quantile(0.99)
        clipped = series.clip(upper=p99)
        span = clipped.max() - clipped.min()
        return (clipped - clipped.min()) / span if span > 0 else clipped * 0

    merged["_depth"]   = norm(merged.get("avg_pages_per_session", pd.Series(dtype=float)) *
                               merged.get("avg_session_duration_s", pd.Series(dtype=float)))
    merged["_key_evt"] = norm(
        merged.get("total_key_events", pd.Series(dtype=float)) /
        merged.get("total_sessions",   pd.Series(dtype=float)).replace(0, np.nan)
    )
    merged["_return"]  = norm(
        merged.get("returning_sessions", pd.Series(dtype=float)) /
        merged.get("total_sessions",      pd.Series(dtype=float)).replace(0, np.nan)
    )
    merged["_bounce"]  = norm(1 - merged.get("bounce_rate", pd.Series(dtype=float)).fillna(0.5))

    ga4_cols = ["_depth", "_key_evt", "_return", "_bounce"]
    weights  = [0.30,     0.35,       0.20,       0.15]

    available = [c for c in ga4_cols if c in merged.columns and merged[c].notna().any()]
    if available:
        w_used = [weights[ga4_cols.index(c)] for c in available]
        w_used = [w / sum(w_used) for w in w_used]
        merged["engagement_score"] = sum(
            merged[c].fillna(0) * w for c, w in zip(available, w_used)
        )
        merged["predicted_clv"] = merged["predicted_clv"] * (
            1 + 0.15 * merged["engagement_score"].fillna(0)
        )
    else:
        merged["engagement_score"] = np.nan

    merged.drop(columns=ga4_cols, errors="ignore", inplace=True)
    return merged


# ---------------------------------------------------------------------------
# Step 4 — Segmentation
# ---------------------------------------------------------------------------

SEGMENT_LABELS = {
    3: "high_potential",
    2: "loyal",
    1: "at_risk",
    0: "low_value",
}

SEGMENT_CONFIG = {
    "high_potential": {
        "color":       "#1D9E75",
        "action":      "Proactive outreach, concierge service, retention incentive",
        "service":     "Dedicated rep — invest heavily",
        "media_guide": "All paid channels — max budget; CLV:CAC ≥ 3× expected",
    },
    "loyal": {
        "color":       "#378ADD",
        "action":      "Fast-track support, loyalty reward, upsell opportunity",
        "service":     "Priority queue — invest selectively",
        "media_guide": "Paid search + owned channels; target lookalikes",
    },
    "at_risk": {
        "color":       "#BA7517",
        "action":      "Win-back email, soft discount, churn-reason survey",
        "service":     "Automated re-engagement — minimal rep time",
        "media_guide": "Retargeting only; no broad prospecting spend",
    },
    "low_value": {
        "color":       "#888780",
        "action":      "Self-serve only; nurture via low-cost email",
        "service":     "No concierge investment",
        "media_guide": "Awareness/brand only — no performance budget",
    },
}


def segment_customers(rfm: pd.DataFrame) -> pd.DataFrame:
    """
    Assigns each customer to one of four actionable segments using
    percentile-based CLV thresholds:
      high_potential : top 15%
      loyal          : 15–45%
      at_risk        : 45–70%
      low_value      : bottom 30%
    """
    rfm = rfm.copy()
    pct = rfm["predicted_clv"].rank(pct=True)

    conditions = [
        pct >= 0.85,
        (pct >= 0.55) & (pct < 0.85),
        (pct >= 0.30) & (pct < 0.55),
        pct < 0.30,
    ]
    segment_ids = [3, 2, 1, 0]
    rfm["segment_id"]   = np.select(conditions, segment_ids, default=0)
    rfm["segment"]      = rfm["segment_id"].map(SEGMENT_LABELS)
    rfm["segment_color"]= rfm["segment"].map(lambda s: SEGMENT_CONFIG[s]["color"])
    return rfm


# ---------------------------------------------------------------------------
# Step 5 — CLV:CAC matrix (requires media_spend)
# ---------------------------------------------------------------------------

def compute_clv_cac_matrix(
    rfm: pd.DataFrame,
    media_spend: pd.DataFrame,
) -> dict:
    """
    Returns a nested dict: { segment → { channel → clv_cac_ratio } }
    """
    channel_summary = (
        media_spend.groupby("channel")
        .agg(
            total_spend     = ("spend_usd", "sum"),
            total_conv      = ("attributed_conversions", "sum"),
        )
        .reset_index()
    )
    channel_summary["cac"] = (
        channel_summary["total_spend"] / channel_summary["total_conv"].replace(0, np.nan)
    ).fillna(0)

    segment_clv = rfm.groupby("segment")["predicted_clv"].mean().to_dict()

    matrix = {}
    for seg, avg_clv in segment_clv.items():
        matrix[seg] = {}
        for _, row in channel_summary.iterrows():
            ch  = row["channel"]
            cac = row["cac"]
            if cac > 0:
                ratio = round(avg_clv / cac, 2)
            else:
                ratio = None
            matrix[seg][ch] = ratio

    return matrix


# ---------------------------------------------------------------------------
# Step 6 — Feature importance
# ---------------------------------------------------------------------------

def compute_feature_importance(rfm: pd.DataFrame) -> list[dict]:
    """
    Ranks features by r² (numeric) or η² / eta-squared (categorical) with predicted CLV.
    """
    results = []
    target = rfm["predicted_clv"].dropna()

    # Numeric features — Pearson r²
    numeric_features = {
        "frequency":          "Purchase frequency",
        "monetary_value":     "Avg order value",
        "recency":            "Recency (weeks)",
        "T":                  "Customer tenure",
        "p_alive":            "P(still active)",
        "engagement_score":   "Engagement score",
        "n_transactions":     "Total transactions",
        "n_unique_products":  "Unique product categories",
    }
    for col, label in numeric_features.items():
        if col not in rfm.columns:
            continue
        series = rfm[col].reindex(target.index).fillna(0)
        if series.std() == 0:
            continue
        corr = series.corr(target)
        if np.isnan(corr):
            continue
        results.append({
            "feature":    label,
            "importance": round(abs(float(corr ** 2)), 4),
            "direction":  "positive" if corr > 0 else "negative",
            "raw_corr":   round(float(corr), 4),
        })

    # Categorical features — η² (eta squared: variance explained by group membership)
    cat_features = {
        "gender":              "Gender",
        "acquisition_channel": "Acquisition channel",
        "customer_region":     "Region",
    }
    for col, label in cat_features.items():
        if col not in rfm.columns:
            continue
        tmp = pd.DataFrame({"y": target, "g": rfm[col].reindex(target.index)}).dropna()
        if len(tmp) < 10:
            continue
        grand_mean = tmp["y"].mean()
        ss_total = float(((tmp["y"] - grand_mean) ** 2).sum())
        if ss_total < 1e-10:
            continue
        ss_between = float(sum(
            len(g) * (g["y"].mean() - grand_mean) ** 2
            for _, g in tmp.groupby("g")
        ))
        eta_sq = round(min(1.0, ss_between / ss_total), 4)
        if eta_sq <= 0:
            continue
        results.append({
            "feature":    label,
            "importance": eta_sq,
            "direction":  "categorical",
            "raw_corr":   None,
        })

    return sorted(results, key=lambda x: x["importance"], reverse=True)


# ---------------------------------------------------------------------------
# Step 7 — Assemble final results dict
# ---------------------------------------------------------------------------

def build_results(
    rfm: pd.DataFrame,
    data_sources: DataSources,
    time_horizon_months: int = 12,
) -> dict:
    """
    Packages the enriched RFM table into the structured dict that the
    FastAPI /results endpoint will return to the React frontend.
    """
    seg_counts = rfm["segment"].value_counts().to_dict()

    kpis = {
        "avg_predicted_clv":    round(float(rfm["predicted_clv"].mean()), 0),
        "median_predicted_clv": round(float(rfm["predicted_clv"].median()), 0),
        "high_potential_count": int(seg_counts.get("high_potential", 0)),
        "high_potential_pct":   round(seg_counts.get("high_potential", 0) / len(rfm) * 100, 1),
        "at_risk_revenue":      round(float(rfm[rfm["segment"] == "at_risk"]["predicted_clv"].sum()), 0),
        "total_customers":      len(rfm),
        "time_horizon_months":  time_horizon_months,
        "data_sources_used":    data_sources.available_sources(),
    }

    segments = []
    for seg_id in [3, 2, 1, 0]:
        seg_name = SEGMENT_LABELS[seg_id]
        mask     = rfm["segment"] == seg_name
        sub      = rfm[mask]
        segments.append({
            "segment":       seg_name,
            "segment_id":    seg_id,
            "count":         int(len(sub)),
            "pct_of_base":   round(len(sub) / len(rfm) * 100, 1),
            "avg_clv":       round(float(sub["predicted_clv"].mean()), 0),
            "avg_p_alive":   round(float(sub["p_alive"].mean()), 3),
            "avg_frequency": round(float(sub["frequency"].mean()), 1),
            "avg_aov":       round(float(sub["expected_aov"].mean()), 0),
            "color":         SEGMENT_CONFIG[seg_name]["color"],
            "action":        SEGMENT_CONFIG[seg_name]["action"],
            "service":       SEGMENT_CONFIG[seg_name]["service"],
            "media_guide":   SEGMENT_CONFIG[seg_name]["media_guide"],
        })

    customer_records = (
        rfm[["segment", "predicted_clv", "frequency", "expected_aov",
             "p_alive", "total_revenue", "acquisition_channel",
             "customer_region"]]
        .sort_values("predicted_clv", ascending=False)
        .head(500)
        .round(2)
        .reset_index()
        .rename(columns={"customer_id": "id"})
        .to_dict(orient="records")
    )

    # CLV histogram: exclude customers with near-zero predicted activity (predicted_purchases < 0.1).
    # BG/NBD correctly marks long-lapsed single-purchase customers as churned (≈$0 future value).
    # Keeping them inflates the first bin and obscures the active-customer distribution.
    hist_mask     = rfm["predicted_purchases"] >= 0.1
    clv_hist      = rfm.loc[hist_mask, "predicted_clv"].replace([np.inf, -np.inf], np.nan).dropna()
    low_clv_count = int(len(rfm) - len(clv_hist))
    if len(clv_hist) > 1:
        p99  = float(np.percentile(clv_hist, 99))
        bins = np.linspace(0, max(p99, 1.0), 21)
        hist, edges = np.histogram(clv_hist.clip(upper=p99), bins=bins)
        clv_distribution = [
            {"bin_start": round(float(edges[i]), 0), "count": int(hist[i])}
            for i in range(len(hist))
        ]
    else:
        clv_distribution = []
    kpis["low_activity_count"] = low_clv_count
    kpis["low_activity_pct"]   = round(low_clv_count / len(rfm) * 100, 1)

    channel_clv = (
        rfm.groupby("acquisition_channel")
        .agg(avg_clv=("predicted_clv", "mean"), count=("predicted_clv", "count"))
        .round({"avg_clv": 0})
        .reset_index()
        .sort_values("avg_clv", ascending=False)
        .to_dict(orient="records")
    )

    # --- Phase 1 additions ---------------------------------------------------

    # Monthly revenue + orders trend
    crm_ts = data_sources.crm.copy()
    crm_ts["transaction_date"] = pd.to_datetime(crm_ts["transaction_date"])
    crm_ts["month"] = crm_ts["transaction_date"].dt.to_period("M").astype(str)
    monthly = (
        crm_ts.groupby("month")
        .agg(revenue=("order_value", "sum"), orders=("order_value", "count"),
             avg_order_value=("order_value", "mean"))
        .reset_index().sort_values("month")
    )
    monthly_trend = monthly.assign(
        revenue=lambda d: d.revenue.round(2),
        avg_order_value=lambda d: d.avg_order_value.round(2),
    ).to_dict(orient="records")

    # Within-segment CLV distribution (box-plot data)
    segment_clv_distribution = []
    for seg_name in ["high_potential", "loyal", "at_risk", "low_value"]:
        sub = rfm[rfm["segment"] == seg_name]["predicted_clv"]
        if len(sub) == 0:
            continue
        segment_clv_distribution.append({
            "segment": seg_name,
            "min":    round(float(sub.min()), 0),
            "p25":    round(float(sub.quantile(0.25)), 0),
            "median": round(float(sub.median()), 0),
            "p75":    round(float(sub.quantile(0.75)), 0),
            "max":    round(float(sub.max()), 0),
            "mean":   round(float(sub.mean()), 0),
        })

    # Tenure vs CLV scatter (300 sample)
    rfm["tenure_months"] = (rfm["T"] / 4.33).round(1)
    scatter_sample = (
        rfm[["predicted_clv", "tenure_months", "segment", "frequency"]]
        .sample(min(300, len(rfm)), random_state=42)
        .round({"predicted_clv": 0, "tenure_months": 1})
        .reset_index()
        .rename(columns={"customer_id": "id"})
        .to_dict(orient="records")
    )

    # Concentration KPIs
    total_clv = rfm["predicted_clv"].sum()
    kpis["top_50_clv_pct"]  = round(rfm.nlargest(50,  "predicted_clv")["predicted_clv"].sum() / total_clv * 100, 1)
    kpis["top_100_clv_pct"] = round(rfm.nlargest(100, "predicted_clv")["predicted_clv"].sum() / total_clv * 100, 1)

    # Extended channel metrics: CVR, CAC, ROAS — requires media_spend
    channel_metrics = None
    if data_sources.media_spend is not None:
        ms = data_sources.media_spend
        ch_agg = (
            ms.groupby("channel")
            .agg(total_spend=("spend_usd", "sum"),
                 total_conversions=("attributed_conversions", "sum"),
                 total_clicks=("clicks", "sum"),
                 total_revenue=("attributed_revenue", "sum"))
            .reset_index()
        )
        ch_agg["cac"]   = (ch_agg["total_spend"] / ch_agg["total_conversions"].replace(0, np.nan)).round(2)
        ch_agg["cvr"]   = (ch_agg["total_conversions"] / ch_agg["total_clicks"].replace(0, np.nan)).round(4)
        ch_agg["roas"]  = (ch_agg["total_revenue"] / ch_agg["total_spend"].replace(0, np.nan)).round(2)
        ch_clv_map      = {r["acquisition_channel"]: r["avg_clv"] for r in channel_clv}
        ch_agg["avg_clv"]       = ch_agg["channel"].map(ch_clv_map).fillna(0).round(0)
        ch_agg["clv_cac_ratio"] = (ch_agg["avg_clv"] / ch_agg["cac"].replace(0, np.nan)).round(2)
        channel_metrics = ch_agg.sort_values("clv_cac_ratio", ascending=False).to_dict(orient="records")

    # -------------------------------------------------------------------------

    result = {
        "kpis":               kpis,
        "segments":           segments,
        "clv_distribution":   clv_distribution,
        "channel_clv":        channel_clv,
        "feature_importance": compute_feature_importance(rfm),
        "customer_records":   customer_records,
        "clv_cac_matrix":     None,
        "intervention_queue":         None,
        "intervention_queue_summary": None,
        "uplift_config":              None,
        "uplift_default":             None,
        "optimizer_config":           None,
        "monthly_trend":            monthly_trend,
        "segment_clv_distribution": segment_clv_distribution,
        "tenure_clv_scatter":       scatter_sample,
        "channel_metrics":          channel_metrics,
    }

    if data_sources.media_spend is not None:
        result["clv_cac_matrix"] = compute_clv_cac_matrix(rfm, data_sources.media_spend)

    return result


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Decision Intelligence layer
# ---------------------------------------------------------------------------

_NBA_RULES: dict = {
    "at_risk": [
        {
            "condition":   lambda r: float(r.get("p_alive") or 1) < 0.3,
            "action":      "Immediate win-back — customer is likely churned",
            "action_type": "winback",
            "urgency":     "immediate",
            "channel":     "email_or_phone",
            "lift_factor": 0.60,
            "why":         "P(alive) below 30% — reactivation window is closing fast.",
            "confidence":  0.82,
        },
        {
            "condition":   lambda r: 0.3 <= float(r.get("p_alive") or 1) < 0.6,
            "action":      "Re-engagement email sequence (3-part)",
            "action_type": "winback",
            "urgency":     "this_week",
            "channel":     "email",
            "lift_factor": 0.35,
            "why":         "Declining purchase rate detected — reactivation still economical.",
            "confidence":  0.71,
        },
        {
            "condition":   lambda r: True,
            "action":      "Soft discount + testimonial email",
            "action_type": "retention",
            "urgency":     "this_month",
            "channel":     "email",
            "lift_factor": 0.20,
            "why":         "Segment CLV at risk — low-cost retention touch maintains relationship.",
            "confidence":  0.64,
        },
    ],
    "high_potential": [
        {
            "condition":   lambda r: float(r.get("frequency") or 0) >= 4,
            "action":      "VIP programme invitation",
            "action_type": "growth",
            "urgency":     "this_week",
            "channel":     "email_or_phone",
            "lift_factor": 0.25,
            "why":         "High purchase frequency signals loyalty readiness for a premium tier.",
            "confidence":  0.78,
        },
        {
            "condition":   lambda r: True,
            "action":      "Upsell to higher-value product tier",
            "action_type": "upsell",
            "urgency":     "this_month",
            "channel":     "email",
            "lift_factor": 0.18,
            "why":         "Top-percentile CLV prediction — upsell conversion rate historically 2×.",
            "confidence":  0.69,
        },
    ],
    "loyal": [
        {
            "condition":   lambda r: True,
            "action":      "Loyalty reward + cross-sell recommendation",
            "action_type": "retention",
            "urgency":     "this_month",
            "channel":     "email",
            "lift_factor": 0.12,
            "why":         "Stable purchase pattern — reward reinforcement increases CLV by ~12%.",
            "confidence":  0.73,
        },
    ],
    "low_value": [
        {
            "condition":   lambda r: float(r.get("frequency") or 0) >= 2,
            "action":      "Category recommendation email",
            "action_type": "nurture",
            "urgency":     "when_capacity_allows",
            "channel":     "email",
            "lift_factor": 0.08,
            "why":         "Repeat purchaser — low-cost nudge can increase order frequency.",
            "confidence":  0.45,
        },
    ],
}


def _nba_for_customer(record: dict, seg_avg_clv: dict) -> list:
    segment = record.get("segment", "low_value")
    clv = float(record.get("predicted_clv") or 0)
    seg_above = {
        "at_risk": "loyal", "low_value": "at_risk",
        "loyal": "high_potential", "high_potential": "high_potential",
    }.get(segment, segment)
    clv_delta = max(float(seg_avg_clv.get(seg_above) or clv) - clv, 0)

    actions = []
    for rule in _NBA_RULES.get(segment, _NBA_RULES["low_value"]):
        if rule["condition"](record):
            base = clv_delta if clv_delta > 0 else clv
            lift = max(round(base * rule["lift_factor"], 0), 10.0)
            actions.append({
                "action":             rule["action"],
                "action_type":        rule["action_type"],
                "urgency":            rule["urgency"],
                "channel":            rule["channel"],
                "estimated_clv_lift": lift,
                "why":                rule["why"],
                "confidence":         rule["confidence"],
            })
            if len(actions) == 2:
                break
    return actions


def _build_intervention_queue(customer_records: list, seg_avg_clv: dict) -> tuple:
    at_risk = sorted(
        [r for r in customer_records if r.get("segment") == "at_risk"],
        key=lambda r: float(r.get("predicted_clv") or 0), reverse=True,
    )
    hp = sorted(
        [r for r in customer_records if r.get("segment") == "high_potential"],
        key=lambda r: float(r.get("predicted_clv") or 0), reverse=True,
    )

    queue, rank = [], 1

    for r in at_risk[:5]:
        clv = float(r.get("predicted_clv") or 0)
        p   = float(r.get("p_alive") or 0.5)
        urgency = "immediate" if p < 0.3 else "this_week"
        queue.append({
            "rank":                rank,
            "intervention_type":   "individual",
            "customer_id":         r.get("id", f"cust_{rank}"),
            "segment":             "at_risk",
            "target_segment":      "loyal",
            "urgency":             urgency,
            "signal_summary":      f"P(alive) {round(p * 100)}% · {int(r.get('frequency') or 1)} purchases · activity declining",
            "recommended_action":  "Personalised win-back email + 10% offer",
            "channel":             "email_or_phone" if urgency == "immediate" else "email",
            "expected_clv_gain":   round(clv * 0.35, 0),
            "urgency_window_days": 7 if urgency == "immediate" else 14,
        })
        rank += 1

    for r in hp[:3]:
        clv  = float(r.get("predicted_clv") or 0)
        freq = int(r.get("frequency") or 1)
        queue.append({
            "rank":                rank,
            "intervention_type":   "individual",
            "customer_id":         r.get("id", f"cust_{rank}"),
            "segment":             "high_potential",
            "target_segment":      "high_potential",
            "urgency":             "this_week",
            "signal_summary":      f"{freq} purchases · strong engagement signals · upsell-ready",
            "recommended_action":  "VIP programme personal invite",
            "channel":             "email_or_phone",
            "expected_clv_gain":   round(clv * 0.22, 0),
            "urgency_window_days": 14,
        })
        rank += 1

    seg_counts: dict = {}
    for r in customer_records:
        s = r.get("segment", "low_value")
        seg_counts[s] = seg_counts.get(s, 0) + 1

    at_risk_n = seg_counts.get("at_risk", 0)
    if at_risk_n > 10:
        queue.append({
            "rank":               rank,
            "intervention_type":  "batch",
            "segment":            "at_risk",
            "target_segment":     "loyal",
            "urgency":            "this_week",
            "cohort_size":        at_risk_n,
            "signal_summary":     f"{at_risk_n:,} at-risk customers · 30-day re-engagement window",
            "recommended_action": "3-email win-back sequence with segment-specific offers",
            "channel":            "email",
            "total_expected_gain": round(float(seg_avg_clv.get("at_risk") or 100) * at_risk_n * 0.15, 0),
        })
        rank += 1

    loyal_n = seg_counts.get("loyal", 0)
    if loyal_n > 10:
        queue.append({
            "rank":               rank,
            "intervention_type":  "batch",
            "segment":            "loyal",
            "target_segment":     "high_potential",
            "urgency":            "this_month",
            "cohort_size":        loyal_n,
            "signal_summary":     f"{loyal_n:,} loyal customers · consistent cadence · upsell-ready",
            "recommended_action": "Cross-sell + loyalty tier upgrade campaign",
            "channel":            "email",
            "total_expected_gain": round(float(seg_avg_clv.get("loyal") or 200) * loyal_n * 0.08, 0),
        })

    summary = {
        "immediate_count":     sum(1 for q in queue if q.get("urgency") == "immediate"),
        "this_week_count":     sum(1 for q in queue if q.get("urgency") == "this_week"),
        "individual_count":    sum(1 for q in queue if q.get("intervention_type") == "individual"),
        "total_expected_gain": sum(
            q.get("expected_clv_gain") or q.get("total_expected_gain") or 0
            for q in queue
        ),
    }
    return queue, summary


def _build_uplift_config(segments: list) -> dict:
    counts      = {s["segment"]: s["count"]   for s in segments}
    seg_avg_clv = {s["segment"]: s["avg_clv"] for s in segments}

    def _delta(from_seg: str, to_seg: str) -> float:
        return round(seg_avg_clv.get(to_seg, 0) - seg_avg_clv.get(from_seg, 0), 0)

    return {
        "movements": [
            {
                "id": "ar_to_loyal", "label": "At Risk → Loyal",
                "from": "at_risk", "to": "loyal",
                "description": "Win-back / retention campaign",
                "n": counts.get("at_risk", 0), "default_rate": 0.15,
                "clv_delta": _delta("at_risk", "loyal"),
            },
            {
                "id": "loyal_to_hp", "label": "Loyal → High Potential",
                "from": "loyal", "to": "high_potential",
                "description": "Upsell / VIP upgrade",
                "n": counts.get("loyal", 0), "default_rate": 0.08,
                "clv_delta": _delta("loyal", "high_potential"),
            },
            {
                "id": "lv_to_ar", "label": "Low Value → At Risk",
                "from": "low_value", "to": "at_risk",
                "description": "Re-engagement campaign",
                "n": counts.get("low_value", 0), "default_rate": 0.10,
                "clv_delta": _delta("low_value", "at_risk"),
            },
        ],
        "segment_avg_clv": seg_avg_clv,
        "segment_counts":  counts,
        "default_cost":    40,
    }


def _build_optimizer_config() -> dict:
    return {
        "default_budget": 30000,
        "budget_range":   [1000, 200000],
        "focus_segments": ["high_potential", "loyal", "at_risk"],
        "channel_caps": {
            "email_owned":        0.25,
            "paid_search":        0.40,
            "paid_social_meta":   0.30,
            "display_dv360":      0.20,
            "paid_social_tiktok": 0.15,
        },
        "default_clv_cac": {
            "email_owned":        45.2,
            "paid_search":        18.7,
            "paid_social_meta":   12.4,
            "display_dv360":       8.1,
            "paid_social_tiktok":  6.3,
        },
    }


def run_clv_pipeline_with_di(
    data_sources: DataSources,
    time_horizon_months: int = 12,
    margin: float = 0.30,
    observation_end: Optional[str] = None,
) -> dict:
    """Full pipeline + Decision Intelligence layer (NBA, intervention queue, simulators)."""
    results = run_clv_pipeline(
        data_sources,
        time_horizon_months=time_horizon_months,
        margin=margin,
        observation_end=observation_end,
    )

    seg_avg_clv = {s["segment"]: s["avg_clv"] for s in results["segments"]}

    records_with_nba = []
    for rec in results["customer_records"]:
        rec = dict(rec)
        rec["avg_aov"] = rec.get("expected_aov")
        rec["revenue"] = rec.get("total_revenue")
        rec["nba_actions"] = _nba_for_customer(rec, seg_avg_clv)
        records_with_nba.append(rec)
    results["customer_records"] = records_with_nba

    queue, queue_summary = _build_intervention_queue(records_with_nba, seg_avg_clv)
    results["intervention_queue"]         = queue
    results["intervention_queue_summary"] = queue_summary
    results["uplift_config"]              = _build_uplift_config(results["segments"])
    results["uplift_default"]             = None
    results["optimizer_config"]           = _build_optimizer_config()

    print("[DI Layer] Done.")
    return results


# ---------------------------------------------------------------------------
# Public entry point — CLV only (no DI)
# ---------------------------------------------------------------------------

def run_clv_pipeline(
    data_sources: DataSources,
    time_horizon_months: int = 12,
    margin: float = 0.30,
    observation_end: Optional[str] = None,
) -> dict:
    """
    Full pipeline from raw data sources → results dict.
    """
    print(f"[CLV Engine] Sources: {data_sources.available_sources()}")

    print("[CLV Engine] Building RFM summary...")
    rfm = build_rfm(data_sources.crm, observation_end=observation_end)
    print(f"  ✓ {len(rfm):,} customers")

    print("[CLV Engine] Fitting BG/NBD + Gamma-Gamma models...")
    rfm = fit_clv_model(rfm, time_horizon_months=time_horizon_months, margin=margin)
    print(f"  ✓ Predicted CLV range: ${rfm['predicted_clv'].min():.0f} – ${rfm['predicted_clv'].max():.0f}")

    if data_sources.ga4 is not None:
        print("[CLV Engine] Enriching with GA4 signals...")
        rfm = enrich_with_ga4(rfm, data_sources.ga4)

    if data_sources.customer_profiles is not None:
        print("[CLV Engine] Merging customer profiles...")
        profiles = data_sources.customer_profiles.set_index("customer_id")
        rfm = rfm.join(profiles[["age_group", "customer_type", "loyalty_tier"]], how="left")

    print("[CLV Engine] Segmenting customers...")
    rfm = segment_customers(rfm)
    seg_summary = rfm["segment"].value_counts().to_dict()
    print(f"  ✓ {seg_summary}")

    print("[CLV Engine] Assembling results...")
    results = build_results(rfm, data_sources, time_horizon_months=time_horizon_months)

    print("[CLV Engine] Done.")
    return results
