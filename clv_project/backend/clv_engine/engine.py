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

    # Core RFM aggregation
    agg = (
        crm.groupby("customer_id")
        .agg(
            first_purchase  = ("transaction_date", "min"),
            last_purchase   = ("transaction_date", "max"),
            n_transactions  = ("transaction_date", "count"),
            total_revenue   = ("order_value",       "sum"),
            mean_order_value= ("order_value",       "mean"),
            acquisition_channel = ("acquisition_channel", "first"),
            acquisition_date    = ("acquisition_date",    "first"),
            customer_region     = ("customer_region",     "first"),
        )
        .reset_index()
    )

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
    Ranks features by Pearson r² with predicted CLV.
    """
    feature_map = {
        "frequency":       "Purchase frequency",
        "monetary_value":  "Avg order value",
        "recency":         "Recency (weeks)",
        "T":               "Customer tenure",
        "p_alive":         "P(still active)",
        "engagement_score":"Engagement score",
        "n_transactions":  "Total transactions",
    }

    results = []
    target = rfm["predicted_clv"].dropna()

    for col, label in feature_map.items():
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
            "importance": round(abs(corr ** 2), 4),
            "direction":  "positive" if corr > 0 else "negative",
            "raw_corr":   round(corr, 4),
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

    # Drop NaN/Inf before building the histogram — percentile on NaN produces NaN
    # edges, which Python 3.14's strict JSON encoder rejects.
    clv_valid = rfm["predicted_clv"].replace([np.inf, -np.inf], np.nan).dropna()
    bins = np.unique(np.percentile(clv_valid, np.linspace(0, 100, 21)))
    if len(bins) > 1:
        hist, edges = np.histogram(clv_valid, bins=bins)
        clv_distribution = [
            {"bin_start": round(float(edges[i]), 0), "count": int(hist[i])}
            for i in range(len(hist))
        ]
    else:
        clv_distribution = []

    channel_clv = (
        rfm.groupby("acquisition_channel")
        .agg(avg_clv=("predicted_clv", "mean"), count=("predicted_clv", "count"))
        .round({"avg_clv": 0})
        .reset_index()
        .sort_values("avg_clv", ascending=False)
        .to_dict(orient="records")
    )

    result = {
        "kpis":               kpis,
        "segments":           segments,
        "clv_distribution":   clv_distribution,
        "channel_clv":        channel_clv,
        "feature_importance": compute_feature_importance(rfm),
        "customer_records":   customer_records,
        "clv_cac_matrix":     None,
    }

    if data_sources.media_spend is not None:
        result["clv_cac_matrix"] = compute_clv_cac_matrix(rfm, data_sources.media_spend)

    return result


# ---------------------------------------------------------------------------
# Public entry point
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
