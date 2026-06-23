"""
Diversity-constrained intervention queue v2.

Guarantees minimum lane representation across three action categories:
  recovery  (40%) — at-risk customers; win-back before P(alive) drops too far
  retention (25%) — loyal customers; protect and upsell
  growth    (20%) — high-potential customers; VIP / premium-tier conversion
  flex      (15%) — remaining slots filled by highest predicted CLV gain

Entry point: build_intervention_queue(rfm, top_n=25)
Summary:     summarise_queue(queue) — includes recovery/retention/growth counts
"""

from __future__ import annotations

import math
from typing import Any

LANE_MINIMUMS: dict[str, float] = {
    "recovery":  0.40,
    "retention": 0.25,
    "growth":    0.20,
}

_LANE_TO_SEGMENT: dict[str, str] = {
    "recovery":  "at_risk",
    "retention": "loyal",
    "growth":    "high_potential",
}

_TARGET_SEGMENT: dict[str, str] = {
    "at_risk":        "loyal",
    "loyal":          "high_potential",
    "high_potential": "high_potential",
    "low_value":      "at_risk",
}

_URGENCY_DAYS: dict[str, int] = {
    "immediate":  7,
    "this_week":  14,
    "this_month": 30,
}


def _signal(row: Any, seg: str) -> str:
    p    = float(row.get("p_alive", 0.5))
    freq = int(row.get("frequency", 1))
    if seg == "at_risk":
        return f"P(alive) {round(p * 100)}% · {freq} purchases · activity declining"
    if seg == "high_potential":
        return f"{freq} purchases · strong engagement signals · upsell-ready"
    if seg == "loyal":
        return f"{freq} purchases · consistent cadence · retention candidate"
    return f"{freq} purchases"


def build_intervention_queue(rfm, top_n: int = 25, include_batches: bool = True) -> list:
    """
    Build a diversity-constrained intervention queue from the RFM DataFrame.

    rfm must be indexed by customer_id (as returned by engine.build_rfm),
    and must include 'segment', 'predicted_clv', 'p_alive', 'frequency' columns.
    """
    recovery_slots  = math.ceil(top_n * LANE_MINIMUMS["recovery"])
    retention_slots = math.ceil(top_n * LANE_MINIMUMS["retention"])
    growth_slots    = math.ceil(top_n * LANE_MINIMUMS["growth"])

    queue: list[dict] = []
    rank = 1

    def _add_individual(cid: str, row: Any, lane: str, urgency: str,
                        action: str, channel: str, gain_factor: float) -> None:
        nonlocal rank
        clv = float(row.get("predicted_clv") or 0)
        seg = str(row.get("segment") or lane)
        queue.append({
            "rank":               rank,
            "intervention_type":  "individual",
            "customer_id":        cid,
            "segment":            seg,
            "lane":               lane,
            "target_segment":     _TARGET_SEGMENT.get(seg, seg),
            "urgency":            urgency,
            "signal_summary":     _signal(row, seg),
            "recommended_action": action,
            "channel":            channel,
            "expected_clv_gain":  round(clv * gain_factor, 0),
            "urgency_window_days": _URGENCY_DAYS.get(urgency, 14),
        })
        rank += 1

    # ---- Recovery lane (at-risk) ----
    at_risk = rfm[rfm["segment"] == "at_risk"].sort_values("predicted_clv", ascending=False)
    for cid, row in at_risk.head(recovery_slots).iterrows():
        p = float(row.get("p_alive") or 0.5)
        urgency = "immediate" if p < 0.3 else "this_week"
        _add_individual(
            str(cid), row, "recovery", urgency,
            "Personalised win-back offer + 10% discount",
            "email_or_phone" if p < 0.3 else "email",
            0.35,
        )

    # ---- Retention lane (loyal) ----
    loyal = rfm[rfm["segment"] == "loyal"].sort_values("predicted_clv", ascending=False)
    for cid, row in loyal.head(retention_slots).iterrows():
        _add_individual(
            str(cid), row, "retention", "this_month",
            "Loyalty reward + cross-sell recommendation",
            "email",
            0.12,
        )

    # ---- Growth lane (high-potential) ----
    hp = rfm[rfm["segment"] == "high_potential"].sort_values("predicted_clv", ascending=False)
    for cid, row in hp.head(growth_slots).iterrows():
        _add_individual(
            str(cid), row, "growth", "this_week",
            "VIP programme invitation or premium-tier upsell",
            "email_or_phone",
            0.22,
        )

    # ---- Batch items ----
    if include_batches:
        at_risk_n = int(len(at_risk))
        loyal_n   = int(len(loyal))

        if at_risk_n > 10:
            at_risk_avg = float(at_risk["predicted_clv"].mean())
            queue.append({
                "rank":               rank,
                "intervention_type":  "batch",
                "lane":               "recovery",
                "segment":            "at_risk",
                "target_segment":     "loyal",
                "urgency":            "this_week",
                "cohort_size":        at_risk_n,
                "signal_summary":     f"{at_risk_n:,} at-risk customers · 30-day re-engagement window",
                "recommended_action": "3-email win-back sequence with segment-specific offers",
                "channel":            "email",
                "total_expected_gain": round(at_risk_avg * at_risk_n * 0.15, 0),
            })
            rank += 1

        if loyal_n > 10:
            loyal_avg = float(loyal["predicted_clv"].mean())
            queue.append({
                "rank":               rank,
                "intervention_type":  "batch",
                "lane":               "retention",
                "segment":            "loyal",
                "target_segment":     "high_potential",
                "urgency":            "this_month",
                "cohort_size":        loyal_n,
                "signal_summary":     f"{loyal_n:,} loyal customers · consistent cadence · upsell-ready",
                "recommended_action": "Cross-sell + loyalty tier upgrade campaign",
                "channel":            "email",
                "total_expected_gain": round(loyal_avg * loyal_n * 0.08, 0),
            })
            rank += 1

    return queue


def summarise_queue(queue: list) -> dict:
    """Return headline stats for the InterventionQueue component."""
    individual = [q for q in queue if q.get("intervention_type") == "individual"]
    return {
        "immediate_count":     sum(1 for q in queue if q.get("urgency") == "immediate"),
        "this_week_count":     sum(1 for q in queue if q.get("urgency") == "this_week"),
        "individual_count":    len(individual),
        "recovery_count":      sum(1 for q in individual if q.get("lane") == "recovery"),
        "retention_count":     sum(1 for q in individual if q.get("lane") == "retention"),
        "growth_count":        sum(1 for q in individual if q.get("lane") == "growth"),
        "total_expected_gain": round(sum(
            q.get("expected_clv_gain") or q.get("total_expected_gain") or 0
            for q in queue
        ), 0),
    }
