"""
Synthetic data generator for the CLV Intelligence demo.

Produces four datasets that mirror what a real user would upload:
  - crm.csv          Core transaction history (required — RFM foundation)
  - ga4.csv          Web behavioral signals (optional)
  - media_spend.csv  Aggregated channel spend + conversions (optional)
  - customers.csv    Customer profile table (optional — enriches scoring)
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import random

RNG_SEED = 42


def _rng(seed=RNG_SEED):
    np.random.seed(seed)
    random.seed(seed)


CHANNELS = [
    "paid_search",
    "paid_social_meta",
    "paid_social_tiktok",
    "paid_social_snap",
    "display_dv360",
    "search_sa360",
    "email_owned",
    "organic",
    "direct",
]

CHANNEL_WEIGHTS = [0.18, 0.16, 0.08, 0.05, 0.10, 0.12, 0.13, 0.10, 0.08]

CHANNEL_CAC = {
    "paid_search":      (42, 12),
    "paid_social_meta": (58, 18),
    "paid_social_tiktok": (72, 22),
    "paid_social_snap": (80, 25),
    "display_dv360":    (35, 10),
    "search_sa360":     (40, 11),
    "email_owned":      (6,  2),
    "organic":          (0,  0),
    "direct":           (0,  0),
}


def generate_crm(
    n_customers: int = 6_538,
    start_date: str = "2021-01-01",
    end_date: str = "2024-06-30",
    seed: int = RNG_SEED,
) -> pd.DataFrame:
    """Returns a transaction-level dataframe."""
    _rng(seed)
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end   = datetime.strptime(end_date,   "%Y-%m-%d")
    span  = (end - start).days

    group_probs         = [0.15, 0.30, 0.30, 0.25]
    group_freq_mu       = [8.0,  4.0,  1.8,  0.7]
    group_aov_mu        = [280,  160,  140,  90]
    group_aov_std       = [80,   50,   45,   30]
    # Mean customer lifetime in years per group (exponential distribution).
    # High-value customers stay much longer; low-value churn quickly.
    # This gives the BG/NBD model real dropout signal so p_alive varies by segment.
    group_lifetime_mean = [6.0,  3.5,  1.6,  0.9]

    rows = []
    cid_pad = len(str(n_customers))

    for i in range(n_customers):
        cid   = f"C{str(i+1).zfill(cid_pad)}"
        group = np.random.choice([0, 1, 2, 3], p=group_probs)

        acq_offset = int(np.random.beta(1.5, 2.0) * span)
        acq_date   = start + timedelta(days=acq_offset)

        channel = np.random.choice(CHANNELS, p=CHANNEL_WEIGHTS)
        region  = np.random.choice(
            ["northeast", "southeast", "midwest", "west", "southwest"],
            p=[0.25, 0.20, 0.20, 0.25, 0.10]
        )

        # Customer lifetime — how long they remain an active buyer.
        # Transactions are generated only within [acq_date, churn_date ∩ end_date].
        lifetime_days = int(np.random.exponential(group_lifetime_mean[group] * 365))
        churn_date    = acq_date + timedelta(days=max(1, lifetime_days))
        active_end    = min(end, churn_date)

        years_active = max((active_end - acq_date).days / 365, 0.05)
        lam = group_freq_mu[group] * years_active
        n_txns = max(1, np.random.poisson(lam))

        txn_offsets = sorted(
            np.random.uniform(0, (active_end - acq_date).days, n_txns).astype(int)
        )

        for offset in txn_offsets:
            txn_date = acq_date + timedelta(days=int(offset))
            if txn_date > end:
                continue
            aov = max(
                5.0,
                np.random.normal(group_aov_mu[group], group_aov_std[group])
            )
            tenure_factor = 1 + 0.04 * (offset / max(span, 1))
            aov *= tenure_factor

            rows.append({
                "customer_id":        cid,
                "transaction_date":   txn_date.strftime("%Y-%m-%d"),
                "order_value":        round(aov, 2),
                "product_category":   np.random.choice(
                    ["core", "premium", "add_on", "renewal"],
                    p=[0.45, 0.25, 0.20, 0.10]
                ),
                "acquisition_channel": channel,
                "acquisition_date":    acq_date.strftime("%Y-%m-%d"),
                "customer_region":     region,
            })

    df = pd.DataFrame(rows)
    df["transaction_date"] = pd.to_datetime(df["transaction_date"])
    df["acquisition_date"] = pd.to_datetime(df["acquisition_date"])
    return df.sort_values(["customer_id", "transaction_date"]).reset_index(drop=True)


def generate_ga4(crm_df: pd.DataFrame, seed: int = RNG_SEED) -> pd.DataFrame:
    """Returns one row per customer with aggregated GA4 behavioural metrics."""
    _rng(seed)

    spend_map = crm_df.groupby("customer_id")["order_value"].sum()
    spend_pct  = spend_map.rank(pct=True)

    rows = []
    for cid, pct in spend_pct.items():
        n_sessions = int(np.random.negative_binomial(
            n=max(1, int(pct * 12 + 2)), p=0.4
        ))
        pages = round(max(1.0, np.random.normal(2 + pct * 6, 1.2)), 1)
        duration = round(max(30, np.random.normal(90 + pct * 300, 60)), 0)
        key_events = int(np.random.poisson(max(0.1, pct * 4)))
        returning_sessions = int(n_sessions * np.random.beta(
            max(0.5, pct * 3), max(0.5, (1 - pct) * 3)
        ))

        rows.append({
            "customer_id":         cid,
            "total_sessions":      n_sessions,
            "avg_pages_per_session": pages,
            "avg_session_duration_s": int(duration),
            "total_key_events":    key_events,
            "returning_sessions":  returning_sessions,
            "bounce_rate":         round(max(0.0, min(1.0, np.random.normal(0.6 - pct * 0.35, 0.1))), 3),
        })

    return pd.DataFrame(rows)


def generate_media_spend(crm_df: pd.DataFrame, seed: int = RNG_SEED) -> pd.DataFrame:
    """Monthly channel-level spend + attributed conversions."""
    _rng(seed)

    min_date = crm_df["acquisition_date"].min()
    max_date  = crm_df["transaction_date"].max()
    months = pd.date_range(
        start=min_date.to_period("M").to_timestamp(),
        end=max_date.to_period("M").to_timestamp(),
        freq="MS"
    )

    paid_channels = [c for c in CHANNELS if c not in ("organic", "direct")]
    rows = []

    for month in months:
        for ch in paid_channels:
            cac_mu, cac_std = CHANNEL_CAC[ch]
            if cac_mu == 0:
                continue
            base_conv = np.random.poisson(30 + (month.year - min_date.year) * 8)
            q4_mult   = 1.35 if month.month in (10, 11, 12) else 1.0
            conversions = int(base_conv * q4_mult)

            cac = max(1.0, np.random.normal(cac_mu, cac_std))
            spend = round(conversions * cac, 2)
            clicks = int(spend / max(0.5, np.random.normal(1.8, 0.4)))
            impressions = int(clicks * np.random.uniform(40, 120))

            avg_aov = 160
            attr_rev = round(conversions * avg_aov * np.random.normal(1.0, 0.1), 2)

            rows.append({
                "month":                  month.strftime("%Y-%m"),
                "channel":                ch,
                "impressions":            impressions,
                "clicks":                 clicks,
                "spend_usd":              spend,
                "attributed_conversions": conversions,
                "attributed_revenue":     attr_rev,
            })

    return pd.DataFrame(rows)


def generate_customer_profiles(crm_df: pd.DataFrame, seed: int = RNG_SEED) -> pd.DataFrame:
    """One row per customer with demographic/firmographic fields."""
    _rng(seed)
    customers = crm_df[["customer_id", "acquisition_channel", "acquisition_date",
                          "customer_region"]].drop_duplicates("customer_id")

    age_groups  = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
    age_weights = [0.10,    0.28,    0.25,    0.18,    0.12,    0.07]

    customers = customers.copy()
    customers["age_group"]    = np.random.choice(age_groups,  len(customers), p=age_weights)
    customers["customer_type"]= np.random.choice(
        ["individual", "small_business", "enterprise"],
        len(customers), p=[0.60, 0.30, 0.10]
    )
    customers["email_opt_in"] = np.random.choice([True, False], len(customers), p=[0.72, 0.28])
    customers["loyalty_tier"] = np.random.choice(
        ["none", "bronze", "silver", "gold", "platinum"],
        len(customers), p=[0.35, 0.30, 0.20, 0.10, 0.05]
    )
    return customers.reset_index(drop=True)


def generate_all(output_dir: str = "data/synthetic", seed: int = RNG_SEED):
    import os
    os.makedirs(output_dir, exist_ok=True)

    print("Generating CRM transactions...")
    crm = generate_crm(seed=seed)
    crm.to_csv(f"{output_dir}/crm.csv", index=False)
    print(f"  ✓ {len(crm):,} transactions, {crm['customer_id'].nunique():,} customers")

    print("Generating GA4 behavioural data...")
    ga4 = generate_ga4(crm, seed=seed)
    ga4.to_csv(f"{output_dir}/ga4.csv", index=False)
    print(f"  ✓ {len(ga4):,} customer rows")

    print("Generating media spend data...")
    media = generate_media_spend(crm, seed=seed)
    media.to_csv(f"{output_dir}/media_spend.csv", index=False)
    print(f"  ✓ {len(media):,} channel-month rows")

    print("Generating customer profiles...")
    profiles = generate_customer_profiles(crm, seed=seed)
    profiles.to_csv(f"{output_dir}/customer_profiles.csv", index=False)
    print(f"  ✓ {len(profiles):,} customer profiles")

    print(f"\nAll files written to {output_dir}/")
    return crm, ga4, media, profiles


if __name__ == "__main__":
    generate_all()
