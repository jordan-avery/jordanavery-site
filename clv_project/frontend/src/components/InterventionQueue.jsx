/**
 * InterventionQueue.jsx
 *
 * Renders the ranked intervention work list from the DI pipeline.
 * Two item types:
 *   individual — a single customer worth direct rep attention
 *   batch      — a cohort of similar customers for a campaign
 *
 * Props:
 *   queue   : results.intervention_queue  (array)
 *   summary : results.intervention_queue_summary (object)
 */

import { useState } from "react";

const URGENCY_CONFIG = {
  immediate:             { label: "Immediate",   color: "#E24B4A", bg: "#FCEBEB", text: "#791F1F" },
  this_week:             { label: "This week",   color: "#EF9F27", bg: "#FAEEDA", text: "#633806" },
  this_month:            { label: "This month",  color: "#378ADD", bg: "#E6F1FB", text: "#0C447C" },
  when_capacity_allows:  { label: "When ready",  color: "#888780", bg: "#F1EFE8", text: "#444441" },
};

const SEGMENT_COLOR = {
  high_potential: "#1D9E75",
  loyal:          "#378ADD",
  at_risk:        "#BA7517",
  low_value:      "#888780",
};

const CHANNEL_ICON = {
  email:          "ti-mail",
  phone:          "ti-phone",
  email_or_phone: "ti-device-mobile",
  paid_retarget:  "ti-ad",
  rep_outreach:   "ti-user",
  sms:            "ti-message",
  in_app:         "ti-app-window",
};

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function UrgencyPill({ urgency }) {
  const cfg = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.when_capacity_allows;
  return (
    <span style={{
      fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
      background: cfg.bg, color: cfg.text, whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function SegmentArrow({ from, to }) {
  const fromColor = SEGMENT_COLOR[from] || "#888";
  const toColor   = SEGMENT_COLOR[to]   || "#888";
  const label = (s) => s.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      <span style={{ color: fromColor, fontWeight: 500 }}>{label(from)}</span>
      <i className="ti ti-arrow-right" style={{ fontSize: 12, color: "var(--color-text-tertiary)" }} aria-hidden="true" />
      <span style={{ color: toColor, fontWeight: 500 }}>{label(to)}</span>
    </span>
  );
}

function IndividualItem({ item }) {
  const icon = CHANNEL_ICON[item.channel] || "ti-send";
  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        background: "var(--color-background-secondary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginTop: 1,
      }}>
        {item.rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
            {item.customer_id}
          </span>
          <SegmentArrow from={item.segment} to={item.target_segment} />
          <UrgencyPill urgency={item.urgency} />
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>
          {item.signal_summary}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-primary)" }}>
          <i className={`ti ${icon}`} style={{ fontSize: 13, verticalAlign: -2, marginRight: 5 }} aria-hidden="true" />
          {item.recommended_action}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-success)" }}>
          +{fmt(item.expected_clv_gain)}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
          {item.urgency_window_days}d window
        </div>
      </div>
    </div>
  );
}

function BatchItem({ item }) {
  const icon = CHANNEL_ICON[item.channel] || "ti-send";
  return (
    <div style={{
      display: "flex", gap: 12,
      borderBottom: "0.5px solid var(--color-border-tertiary)",
      background: "var(--color-background-secondary)",
      margin: "0 -18px", padding: "12px 18px",
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
        background: "var(--color-background-primary)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginTop: 1,
        border: "0.5px solid var(--color-border-tertiary)",
      }}>
        {item.rank}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 20,
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            color: "var(--color-text-secondary)",
          }}>
            BATCH · {item.cohort_size.toLocaleString()} customers
          </span>
          <SegmentArrow from={item.segment} to={item.target_segment} />
          <UrgencyPill urgency={item.urgency} />
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>
          {item.signal_summary}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-primary)" }}>
          <i className={`ti ${icon}`} style={{ fontSize: 13, verticalAlign: -2, marginRight: 5 }} aria-hidden="true" />
          {item.recommended_action}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-success)" }}>
          +{fmt(item.total_expected_gain)}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>
          total cohort gain
        </div>
      </div>
    </div>
  );
}

export default function InterventionQueue({ queue = [], summary = {} }) {
  const [filter, setFilter] = useState("all");

  const filtered = queue.filter(item => {
    if (filter === "individual") return item.intervention_type === "individual";
    if (filter === "batch")      return item.intervention_type === "batch";
    if (filter === "immediate")  return item.urgency === "immediate";
    return true;
  });

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "16px 18px",
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 10 }}>
          Intervention priority queue
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Recovery",  value: summary.recovery_count,  color: "#BA7517", sub: "at-risk" },
            { label: "Retention", value: summary.retention_count, color: "#378ADD", sub: "loyal" },
            { label: "Growth",    value: summary.growth_count,    color: "#1D9E75", sub: "high-potential" },
            { label: "Total gain", value: fmt(summary.total_expected_gain || 0), color: "var(--color-text-success)", sub: null },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 500, color }}>{value ?? "—"}</div>
              {sub && <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: 1 }}>{sub}</div>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {["all", "immediate", "individual", "batch"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 11, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                border: filter === f ? "0.5px solid var(--color-border-primary)" : "0.5px solid var(--color-border-tertiary)",
                background: filter === f ? "var(--color-background-secondary)" : "transparent",
                color: "var(--color-text-primary)", fontWeight: filter === f ? 500 : 400,
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-text-secondary)", alignSelf: "center" }}>
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div>
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "20px 0", textAlign: "center" }}>
            No items match this filter.
          </div>
        )}
        {filtered.map(item =>
          item.intervention_type === "batch"
            ? <BatchItem key={`batch-${item.rank}`} item={item} />
            : <IndividualItem key={item.customer_id} item={item} />
        )}
      </div>
    </div>
  );
}
