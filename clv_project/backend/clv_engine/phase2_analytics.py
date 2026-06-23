"""
Phase 2 analytics — cohort retention, CLV trajectory, mobility, channel split, offer playbook.

All functions accept the DataFrames produced by engine.build_rfm / data_sources.crm.
Each function is wrapped in a try/except in engine.build_results so a failure here
degrades gracefully without crashing the pipeline.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# 2A — Cohort retention curves
# ---------------------------------------------------------------------------

def cohort_retention(crm: pd.DataFrame, milestones: list = None) -> dict:
    """
    Quarterly cohort retention: % of cohort customers still purchasing at each
    tenure milestone.

    Returns a dict keyed by cohort label (e.g. '2021Q1') with:
      { cohort, n_customers, rates: { m1, m3, m6, m12, m18, m24 } }
    """
    if milestones is None:
        milestones = [1, 3, 6, 12, 18, 24]

    df = crm.copy()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])

    # First purchase date per customer
    first_txn = df.groupby("customer_id")["transaction_date"].min().rename("first_txn")
    df = df.join(first_txn, on="customer_id")

    # Quarterly cohort from first purchase
    df["cohort"] = df["first_txn"].dt.to_period("Q").astype(str)

    # Tenure in months relative to each customer's first purchase
    df["tenure_months"] = (df["transaction_date"] - df["first_txn"]).dt.days / 30.44

    cohorts: dict = {}
    for cohort_label, group in df.groupby("cohort"):
        customers = group["customer_id"].unique()
        n = len(customers)
        if n < 5:
            continue

        rates = {}
        for m in milestones:
            within = group[group["tenure_months"] <= m]
            active = within["customer_id"].nunique()
            rates[f"m{m}"] = round(active / n, 4)

        cohorts[cohort_label] = {
            "cohort":       cohort_label,
            "n_customers":  int(n),
            "rates":        rates,
        }

    return cohorts


def cohort_retention_summary(cohorts: dict) -> dict:
    """Average retention rates across all cohorts, plus cohort date range."""
    if not cohorts:
        return {}

    cohort_list = list(cohorts.values())
    milestone_keys = list(cohort_list[0]["rates"].keys())

    avg_rates = {}
    for mk in milestone_keys:
        vals = [c["rates"].get(mk, 0) for c in cohort_list]
        avg_rates[mk] = round(float(np.mean(vals)), 4)

    labels = sorted(cohorts.keys())
    return {
        "n_cohorts":        len(cohorts),
        "earliest_cohort":  labels[0],
        "latest_cohort":    labels[-1],
        "avg_rates":        avg_rates,
    }


# ---------------------------------------------------------------------------
# 2B — CLV trajectory
# ---------------------------------------------------------------------------

def clv_trajectory(
    crm: pd.DataFrame,
    rfm: pd.DataFrame,
    milestones: list = None,
) -> list:
    """
    Average cumulative revenue per customer at tenure milestones, by segment.

    Returns a list of dicts:
      { segment, n_customers, trajectory: { m3, m6, m12, m18, m24 } }

    rfm must be indexed by customer_id (as returned by engine.build_rfm).
    """
    if milestones is None:
        milestones = [3, 6, 12, 18, 24]

    df = crm.copy()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])

    if "acquisition_date" in df.columns:
        df["acquisition_date"] = pd.to_datetime(df["acquisition_date"])
    else:
        first_txn = df.groupby("customer_id")["transaction_date"].min().rename("acquisition_date")
        df = df.join(first_txn, on="customer_id")

    df["tenure_months"] = (df["transaction_date"] - df["acquisition_date"]).dt.days / 30.44

    seg_map: dict = rfm["segment"].to_dict()
    df["segment"] = df["customer_id"].map(seg_map)
    df = df.dropna(subset=["segment"])

    result = []
    for seg in ["high_potential", "loyal", "at_risk", "low_value"]:
        seg_df = df[df["segment"] == seg]
        if len(seg_df) == 0:
            continue

        seg_customers = seg_df["customer_id"].unique()
        n = len(seg_customers)
        trajectory = {}

        for m in milestones:
            windowed = seg_df[seg_df["tenure_months"] <= m]
            rev_per_cust = (
                windowed.groupby("customer_id")["order_value"]
                .sum()
                .reindex(seg_customers, fill_value=0)
            )
            trajectory[f"m{m}"] = round(float(rev_per_cust.mean()), 2)

        result.append({
            "segment":     seg,
            "n_customers": int(n),
            "trajectory":  trajectory,
        })

    return result


# ---------------------------------------------------------------------------
# 2C — Mobility score
# ---------------------------------------------------------------------------

def compute_mobility(crm: pd.DataFrame, rfm: pd.DataFrame):
    """
    Classify each customer as ascending / descending / stable / new
    based on the linear slope of their monthly spend.

    Returns (direction_map, score_map), both dicts keyed by customer_id.
    rfm must be indexed by customer_id.
    """
    df = crm.copy()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])
    df["month"] = df["transaction_date"].dt.to_period("M")

    monthly = (
        df.groupby(["customer_id", "month"])["order_value"]
        .sum()
        .reset_index()
        .sort_values(["customer_id", "month"])
    )

    direction_map: dict = {}
    score_map: dict = {}

    for cid, group in monthly.groupby("customer_id"):
        vals = group["order_value"].values
        if len(vals) < 2:
            direction_map[cid] = "new"
            score_map[cid] = 0.0
            continue

        x = np.arange(len(vals), dtype=float)
        slope = float(np.polyfit(x, vals, 1)[0])
        mean_val = float(np.mean(vals))

        if mean_val == 0:
            direction_map[cid] = "stable"
            score_map[cid] = 0.0
            continue

        norm_slope = slope / mean_val

        if norm_slope > 0.05:
            direction_map[cid] = "ascending"
        elif norm_slope < -0.05:
            direction_map[cid] = "descending"
        else:
            direction_map[cid] = "stable"

        score_map[cid] = round(float(norm_slope), 4)

    # Customers with only 1 transaction (not in monthly groups) → "new"
    all_customers = set(rfm.index.tolist())
    for cid in all_customers:
        if cid not in direction_map:
            direction_map[cid] = "new"
            score_map[cid] = 0.0

    return direction_map, score_map


# ---------------------------------------------------------------------------
# 2D — Channel acquisition vs. retention split
# ---------------------------------------------------------------------------

def channel_split_metrics(media_spend: pd.DataFrame, channel_clv: list) -> list:
    """
    Classify each channel as acquisition-focused, retention-focused, or mixed
    based on whether its avg customer CLV is above/below the overall mean.

    channel_clv: list of { acquisition_channel, avg_clv } dicts from build_results.
    """
    if media_spend is None or len(media_spend) == 0:
        return []

    clv_map = {r["acquisition_channel"]: float(r["avg_clv"]) for r in channel_clv}
    overall_avg = float(np.mean(list(clv_map.values()))) if clv_map else 0.0

    channel_agg = (
        media_spend.groupby("channel")
        .agg(
            total_spend=("spend_usd", "sum"),
            total_conversions=("attributed_conversions", "sum"),
        )
        .reset_index()
    )

    result = []
    for _, row in channel_agg.iterrows():
        ch = row["channel"]
        avg_clv = clv_map.get(ch, overall_avg)

        if overall_avg > 0 and avg_clv > overall_avg * 1.15:
            split_type = "acquisition"
            label = "Acquisition-focused"
        elif overall_avg > 0 and avg_clv < overall_avg * 0.85:
            split_type = "retention"
            label = "Retention-focused"
        else:
            split_type = "mixed"
            label = "Mixed"

        result.append({
            "channel":             ch,
            "split_type":          split_type,
            "label":               label,
            "total_spend":         round(float(row["total_spend"]), 2),
            "total_conversions":   int(row["total_conversions"]),
            "avg_clv":             round(float(avg_clv), 0),
        })

    return sorted(result, key=lambda x: x["total_spend"], reverse=True)


# ---------------------------------------------------------------------------
# 2E — Offer playbook
# ---------------------------------------------------------------------------

def offer_playbook(crm: pd.DataFrame, rfm: pd.DataFrame) -> Optional[list]:
    """
    Product category lift vs. baseline for each segment.

    Returns None if product_category column is absent.
    rfm must be indexed by customer_id.
    """
    if "product_category" not in crm.columns:
        return None

    df = crm.copy()
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])

    seg_map: dict = rfm["segment"].to_dict()
    df["segment"] = df["customer_id"].map(seg_map)
    df = df.dropna(subset=["segment"])

    baseline = df["product_category"].value_counts(normalize=True).to_dict()

    result = []
    for seg in ["high_potential", "loyal", "at_risk", "low_value"]:
        seg_df = df[df["segment"] == seg]
        if len(seg_df) == 0:
            continue

        cat_rates = seg_df["product_category"].value_counts(normalize=True).to_dict()
        categories = []
        for cat, rate in cat_rates.items():
            base = baseline.get(cat, 0.001)
            lift = round(rate / base, 3)
            categories.append({
                "category": cat,
                "rate":     round(rate, 4),
                "baseline": round(base, 4),
                "lift":     lift,
            })

        categories = sorted(categories, key=lambda x: x["lift"], reverse=True)[:6]

        result.append({
            "segment":    seg,
            "categories": categories,
        })

    return result
