"""
Schema validation and column mapping for user-uploaded data.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import pandas as pd


@dataclass
class ColumnSpec:
    name: str
    dtype: str          # "date", "numeric", "string", "boolean"
    required: bool
    aliases: list[str] = None
    description: str = ""

    def __post_init__(self):
        if self.aliases is None:
            self.aliases = []


CRM_SCHEMA: list[ColumnSpec] = [
    ColumnSpec("customer_id",        "string",  True,  ["user_id", "client_id", "cust_id", "contact_id"],
               "Unique customer identifier"),
    ColumnSpec("transaction_date",   "date",    True,  ["order_date", "purchase_date", "date", "created_at"],
               "Date of each transaction"),
    ColumnSpec("order_value",        "numeric", True,  ["revenue", "amount", "total", "order_total", "gmv", "sales"],
               "Revenue per transaction"),
    ColumnSpec("acquisition_channel","string",  False, ["channel", "source", "utm_source", "acq_channel"],
               "Marketing channel that acquired the customer"),
    ColumnSpec("acquisition_date",   "date",    False, ["first_seen", "signup_date", "join_date"],
               "Date customer was first acquired"),
    ColumnSpec("customer_region",    "string",  False, ["region", "state", "geo", "territory"],
               "Geographic region"),
    ColumnSpec("product_category",   "string",  False, ["category", "product_type", "sku_category"],
               "Product or service category"),
]

GA4_SCHEMA: list[ColumnSpec] = [
    ColumnSpec("customer_id",            "string",  True,  ["user_id", "client_id"],
               "Must match CRM customer_id"),
    ColumnSpec("total_sessions",         "numeric", False, ["sessions", "session_count", "visits"],
               "Total sessions in the period"),
    ColumnSpec("avg_pages_per_session",  "numeric", False, ["pages_per_session", "pageviews_per_session"],
               "Average pages viewed per session"),
    ColumnSpec("avg_session_duration_s", "numeric", False, ["avg_session_duration", "session_duration"],
               "Average session duration in seconds"),
    ColumnSpec("total_key_events",       "numeric", False, ["key_events", "conversions", "goal_completions"],
               "Total key events (add-to-cart, form fills, etc.)"),
    ColumnSpec("returning_sessions",     "numeric", False, ["returning_users", "return_visits"],
               "Sessions from returning users"),
    ColumnSpec("bounce_rate",            "numeric", False, ["bounces", "bounce_pct"],
               "Bounce rate 0–1 (or 0–100, will be normalised)"),
]

MEDIA_SPEND_SCHEMA: list[ColumnSpec] = [
    ColumnSpec("channel",                 "string",  True,  ["source", "platform", "media_channel", "campaign_source"],
               "Advertising channel name"),
    ColumnSpec("spend_usd",               "numeric", True,  ["spend", "cost", "media_spend", "ad_spend", "investment"],
               "Total spend in USD"),
    ColumnSpec("attributed_conversions",  "numeric", True,  ["conversions", "conv", "orders", "purchases"],
               "Attributed conversions"),
    ColumnSpec("month",                   "string",  False, ["date", "period", "month_year", "report_month"],
               "Reporting month (YYYY-MM)"),
    ColumnSpec("impressions",             "numeric", False, ["impr", "views"],
               "Total impressions"),
    ColumnSpec("clicks",                  "numeric", False, ["click", "link_clicks"],
               "Total clicks"),
    ColumnSpec("attributed_revenue",      "numeric", False, ["revenue", "attributed_sales", "conv_value"],
               "Attributed revenue (optional — used for ROAS calc)"),
]

CUSTOMER_PROFILES_SCHEMA: list[ColumnSpec] = [
    ColumnSpec("customer_id",   "string",  True,  ["user_id", "client_id"],
               "Must match CRM customer_id"),
    ColumnSpec("age_group",     "string",  False, ["age", "age_range", "age_band"],
               "Age group (e.g. 25-34)"),
    ColumnSpec("customer_type", "string",  False, ["type", "segment_type", "account_type"],
               "Individual / SMB / Enterprise"),
    ColumnSpec("email_opt_in",  "boolean", False, ["opted_in", "email_consent", "marketing_opt_in"],
               "Email marketing consent flag"),
    ColumnSpec("loyalty_tier",  "string",  False, ["tier", "loyalty_level", "membership"],
               "Loyalty programme tier"),
]

SCHEMA_MAP = {
    "crm":               CRM_SCHEMA,
    "ga4":               GA4_SCHEMA,
    "media_spend":       MEDIA_SPEND_SCHEMA,
    "customer_profiles": CUSTOMER_PROFILES_SCHEMA,
}


class ValidationError(Exception):
    def __init__(self, message: str, missing_required: list[str] = None):
        super().__init__(message)
        self.missing_required = missing_required or []


def _build_alias_map(schema: list[ColumnSpec]) -> dict[str, str]:
    m = {}
    for spec in schema:
        m[spec.name.lower()] = spec.name
        for alias in spec.aliases:
            m[alias.lower()] = spec.name
    return m


def _coerce_dtype(series: pd.Series, dtype: str, col_name: str) -> pd.Series:
    if dtype == "date":
        try:
            return pd.to_datetime(series)
        except Exception:
            raise ValidationError(f"Column '{col_name}' could not be parsed as dates. "
                                   f"Sample values: {series.dropna().head(3).tolist()}")
    elif dtype == "numeric":
        series = series.astype(str).str.replace(r"[\$,€£%]", "", regex=True).str.strip()
        coerced = pd.to_numeric(series, errors="coerce")
        if col_name == "bounce_rate" and coerced.dropna().mean() > 1.0:
            coerced = coerced / 100
        return coerced
    elif dtype == "boolean":
        bool_map = {"true": True, "yes": True, "1": True, "y": True,
                    "false": False, "no": False, "0": False, "n": False}
        return series.astype(str).str.lower().map(bool_map)
    return series


def validate_and_clean(
    df: pd.DataFrame,
    source_name: str,
    strict: bool = False,
) -> pd.DataFrame:
    """
    Validates a user-uploaded DataFrame against the named source schema.
    Returns cleaned DataFrame with canonical column names.
    Raises ValidationError with human-readable message on failure.
    """
    schema = SCHEMA_MAP.get(source_name)
    if schema is None:
        raise ValidationError(f"Unknown data source: {source_name}")

    df = df.copy()
    df.columns = [str(c).lower().strip().replace(" ", "_") for c in df.columns]

    alias_map = _build_alias_map(schema)
    df.rename(columns={c: alias_map[c] for c in df.columns if c in alias_map}, inplace=True)

    required = [s.name for s in schema if s.required]
    missing  = [r for r in required if r not in df.columns]
    if missing:
        hint_rows = []
        for m in missing:
            spec = next(s for s in schema if s.name == m)
            hint_rows.append(f"  '{m}' (also accepted: {', '.join(spec.aliases) or 'no aliases'})")
        raise ValidationError(
            f"Missing required columns for '{source_name}':\n" + "\n".join(hint_rows),
            missing_required=missing,
        )

    for spec in schema:
        if spec.name in df.columns:
            df[spec.name] = _coerce_dtype(df[spec.name], spec.dtype, spec.name)

    for spec in schema:
        if not spec.required and spec.name not in df.columns:
            df[spec.name] = None

    if strict:
        known = {s.name for s in schema}
        df = df[[c for c in df.columns if c in known]]

    return df


def get_schema_info(source_name: str) -> list[dict]:
    """Returns the schema spec as a list of dicts for the frontend column-mapping wizard."""
    schema = SCHEMA_MAP.get(source_name, [])
    return [
        {
            "name":        s.name,
            "required":    s.required,
            "dtype":       s.dtype,
            "aliases":     s.aliases,
            "description": s.description,
        }
        for s in schema
    ]
