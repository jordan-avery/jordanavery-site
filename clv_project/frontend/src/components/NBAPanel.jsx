/**
 * NBAPanel.jsx
 *
 * Slide-in panel showing the Next Best Actions for a selected customer.
 * Triggered when the user clicks a row in the customer records table.
 *
 * Props:
 *   customer  : a customer record object from results.customer_records
 *               (must include nba_actions array)
 *   onClose   : () => void
 */

const URGENCY_CONFIG = {
  immediate:             { label: "Immediate",   bg: "#FCEBEB", text: "#791F1F", border: "#F09595" },
  this_week:             { label: "This week",   bg: "#FAEEDA", text: "#633806", border: "#EF9F27" },
  this_month:            { label: "This month",  bg: "#E6F1FB", text: "#0C447C", border: "#85B7EB" },
  low:                   { label: "Low",         bg: "#F1EFE8", text: "#444441", border: "#B4B2A9" },
  when_capacity_allows:  { label: "When ready",  bg: "#F1EFE8", text: "#444441", border: "#B4B2A9" },
};

const ACTION_TYPE_ICON = {
  retention: "ti-heart",
  upsell:    "ti-trending-up",
  winback:   "ti-refresh",
  nurture:   "ti-plant",
  channel:   "ti-antenna",
  growth:    "ti-users",
};

const CHANNEL_LABEL = {
  email:          "Email",
  phone:          "Phone call",
  email_or_phone: "Email or phone",
  paid_retarget:  "Paid retargeting",
  rep_outreach:   "Rep outreach",
  sms:            "SMS",
  in_app:         "In-app message",
};

const SEGMENT_COLOR = {
  high_potential: "#1D9E75",
  loyal:          "#378ADD",
  at_risk:        "#BA7517",
  low_value:      "#888780",
};

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function ConfidenceBar({ value }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "#1D9E75" : pct >= 45 ? "#378ADD" : "#888780";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "var(--color-background-secondary)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 28 }}>{pct}%</span>
    </div>
  );
}

function ActionCard({ action }) {
  const urgCfg   = URGENCY_CONFIG[action.urgency] || URGENCY_CONFIG.low;
  const typeIcon = ACTION_TYPE_ICON[action.action_type] || "ti-bolt";
  const channelLabel = CHANNEL_LABEL[action.channel] || action.channel;

  return (
    <div style={{
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-md)",
      padding: "12px 14px",
      marginBottom: 10,
      borderLeft: `3px solid ${urgCfg.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "var(--border-radius-md)",
            background: urgCfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <i className={`ti ${typeIcon}`} style={{ fontSize: 14, color: urgCfg.text }} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", lineHeight: 1.3 }}>
              {action.action}
            </div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}>
              <span style={{ padding: "1px 6px", borderRadius: 10, fontSize: 10, background: urgCfg.bg, color: urgCfg.text }}>
                {urgCfg.label}
              </span>
              {" · "}
              <i className="ti ti-send" style={{ fontSize: 11, verticalAlign: -1 }} aria-hidden="true" />
              {" "}{channelLabel}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-success)" }}>
            +{fmt(action.estimated_clv_lift)}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>est. CLV lift</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8, lineHeight: 1.5 }}>
        {action.why}
      </div>
      <div>
        <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 3 }}>Model confidence</div>
        <ConfidenceBar value={action.confidence} />
      </div>
    </div>
  );
}

export default function NBAPanel({ customer, onClose }) {
  if (!customer) return null;

  const segColor = SEGMENT_COLOR[customer.segment] || "#888";
  const segLabel = (customer.segment || "").replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  const actions  = customer.nba_actions || [];
  const totalLift = actions.reduce((sum, a) => sum + (a.estimated_clv_lift || 0), 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.25)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, height: "100%", overflowY: "auto",
          background: "var(--color-background-primary)",
          borderLeft: "0.5px solid var(--color-border-tertiary)",
          padding: "20px 18px",
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>
              {customer.id}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "2px 8px", borderRadius: 20,
                background: `${segColor}20`, color: segColor,
              }}>
                {segLabel}
              </span>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
                Predicted CLV {fmt(customer.predicted_clv)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: 4 }}
          >
            <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Frequency", value: customer.frequency ?? "—" },
            { label: "Avg AOV",   value: fmt(customer.avg_aov ?? customer.expected_aov ?? 0) },
            { label: "P(alive)",  value: `${Math.round((customer.p_alive ?? 1) * 100)}%` },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
              Next best actions
            </div>
            {actions.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--color-text-success)" }}>
                Up to +{fmt(totalLift)} total lift
              </span>
            )}
          </div>

          {actions.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "16px 0", textAlign: "center" }}>
              No actions recommended for this customer profile.
            </div>
          ) : (
            actions.map((action, i) => (
              <ActionCard key={i} action={action} />
            ))
          )}
        </div>

        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 8 }}>
            Profile
          </div>
          {[
            { label: "Acquisition channel", value: customer.acquisition_channel },
            { label: "Region",              value: customer.customer_region },
            { label: "Revenue to date",     value: fmt(customer.revenue ?? customer.total_revenue ?? 0) },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>{label}</span>
              <span style={{ fontWeight: 500 }}>{value ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
