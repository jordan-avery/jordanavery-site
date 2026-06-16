/**
 * BudgetOptimizer.jsx
 *
 * Allocates a total marketing budget across channels to maximise CLV return,
 * using the CLV:CAC ratios from the pipeline's clv_cac_matrix.
 *
 * On budget or focus-segment change: calls POST /api/di/optimise-budget.
 * Falls back to local weighted allocation when API is unavailable.
 *
 * Props:
 *   optimizerConfig : results.optimizer_config
 *   clvCacMatrix    : results.clv_cac_matrix  (may be null if no media data)
 *   apiBase         : string
 *   sessionToken    : string | null
 */

import { useState, useCallback, useRef, useEffect } from "react";

function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

const RECOMMENDATION_CONFIG = {
  invest:         { label: "Invest",         bg: "#E1F5EE", text: "#085041" },
  maintain:       { label: "Maintain",       bg: "#E6F1FB", text: "#0C447C" },
  selective:      { label: "Selective",      bg: "#FAEEDA", text: "#633806" },
  awareness_only: { label: "Awareness only", bg: "#F1EFE8", text: "#444441" },
};

const CHANNEL_DISPLAY = {
  email_owned:         "Email / owned",
  paid_search:         "Paid search",
  search_sa360:        "Search (SA360)",
  display_dv360:       "Display / DV360",
  paid_social_meta:    "Paid social (Meta)",
  paid_social_tiktok:  "Paid social (TikTok)",
  paid_social_snap:    "Paid social (Snap)",
};

function localAllocate(budget, ratios, caps) {
  if (!ratios || Object.keys(ratios).length === 0) return [];

  const FLOOR = 500;
  const totalWeight = Object.values(ratios).reduce((s, v) => s + v, 0);

  let allocs = {};
  let overflow = 0;
  for (const [ch, ratio] of Object.entries(ratios)) {
    const raw = (ratio / totalWeight) * budget;
    const cap = (caps?.[ch] ?? 0.5) * budget;
    if (raw > cap) { allocs[ch] = cap; overflow += raw - cap; }
    else            { allocs[ch] = raw; }
  }

  if (overflow > 0) {
    const uncapped = Object.entries(allocs).filter(([ch, amt]) => amt < (caps?.[ch] ?? 0.5) * budget);
    const uw = uncapped.reduce((s, [ch]) => s + ratios[ch], 0);
    for (const [ch] of uncapped) allocs[ch] += (ratios[ch] / uw) * overflow;
  }

  let zeroed = 0;
  for (const ch of Object.keys(allocs)) {
    if (allocs[ch] < FLOOR) { zeroed += allocs[ch]; delete allocs[ch]; }
  }
  if (zeroed > 0 && Object.keys(allocs).length > 0) {
    const top = Object.entries(allocs).sort((a, b) => (ratios[b[0]] ?? 0) - (ratios[a[0]] ?? 0))[0][0];
    allocs[top] += zeroed;
  }

  const label = r => r >= 30 ? "invest" : r >= 10 ? "maintain" : r >= 3 ? "selective" : "awareness_only";
  return Object.entries(allocs)
    .sort((a, b) => (ratios[b[0]] ?? 0) - (ratios[a[0]] ?? 0))
    .map(([ch, spend]) => ({
      channel:              ch,
      spend_usd:            spend,
      clv_cac_ratio:        ratios[ch] ?? 0,
      projected_clv_return: spend * (ratios[ch] ?? 1),
      pct_of_budget:        spend / budget,
      recommendation:       label(ratios[ch] ?? 0),
    }));
}

function localSummary(channels, budget) {
  const totalReturn = channels.reduce((s, c) => s + c.projected_clv_return, 0);
  const blended = budget > 0
    ? channels.reduce((s, c) => s + c.clv_cac_ratio * (c.spend_usd / budget), 0)
    : 0;
  return { total_projected_return: totalReturn, blended_clv_cac: blended };
}

function ChannelRow({ ch, maxRatio }) {
  const cfg      = RECOMMENDATION_CONFIG[ch.recommendation] || RECOMMENDATION_CONFIG.awareness_only;
  const barPct   = maxRatio > 0 ? Math.round((ch.clv_cac_ratio / maxRatio) * 100) : 0;
  const barColor = ch.clv_cac_ratio >= 30 ? "#1D9E75" : ch.clv_cac_ratio >= 10 ? "#378ADD" : ch.clv_cac_ratio >= 3 ? "#BA7517" : "#888780";

  return (
    <div style={{ padding: "10px 0", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {CHANNEL_DISPLAY[ch.channel] || ch.channel}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {fmt(ch.spend_usd)}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 20,
          background: cfg.bg, color: cfg.text, minWidth: 76, textAlign: "center",
        }}>
          {cfg.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 4, background: "var(--color-background-secondary)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: `${barPct}%`, height: "100%", background: barColor, borderRadius: 2, transition: "width 0.3s ease" }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 48, textAlign: "right" }}>
          {ch.clv_cac_ratio?.toFixed(1)}× ratio
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-success)", minWidth: 80, textAlign: "right" }}>
          → {fmt(ch.projected_clv_return)}
        </span>
      </div>
    </div>
  );
}

export default function BudgetOptimizer({ optimizerConfig, clvCacMatrix, apiBase, sessionToken }) {
  if (!optimizerConfig) return null;

  const { default_budget, budget_range, focus_segments, channel_caps, default_clv_cac } = optimizerConfig;

  const [budget,   setBudget]   = useState(default_budget ?? 30000);
  const [focusSeg, setFocusSeg] = useState(focus_segments?.[0] ?? "high_potential");
  const [channels, setChannels] = useState([]);
  const [summary,  setSummary]  = useState({});
  const [loading,  setLoading]  = useState(false);
  const debounceRef = useRef(null);

  const getRatios = useCallback((seg) => {
    if (clvCacMatrix?.[seg]) {
      return Object.fromEntries(
        Object.entries(clvCacMatrix[seg]).filter(([, v]) => v != null && v > 0)
      );
    }
    return default_clv_cac ?? {};
  }, [clvCacMatrix, default_clv_cac]);

  const runOptimize = useCallback(async (newBudget, newSeg) => {
    const ratios = getRatios(newSeg);
    const local  = localAllocate(newBudget, ratios, channel_caps);
    setChannels(local);
    setSummary(localSummary(local, newBudget));

    if (!apiBase) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const headers = { "Content-Type": "application/json" };
        if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
        const res = await fetch(`${apiBase}/api/di/optimise-budget`, {
          method: "POST", headers,
          body: JSON.stringify({ total_budget: newBudget, focus_segment: newSeg }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.channels) {
            setChannels(data.channels);
            setSummary({ total_projected_return: data.total_projected_return, blended_clv_cac: data.blended_clv_cac });
          }
        }
      } catch (_) { /* silent */ }
      finally { setLoading(false); }
    }, 400);
  }, [getRatios, channel_caps, apiBase, sessionToken]);

  useEffect(() => { runOptimize(budget, focusSeg); }, []);

  const handleBudget = (v) => { setBudget(v); runOptimize(v, focusSeg); };
  const handleSeg    = (v) => { setFocusSeg(v); runOptimize(budget, v); };

  const maxRatio    = Math.max(...channels.map(c => c.clv_cac_ratio ?? 0), 1);
  const blended     = summary.blended_clv_cac ?? 0;
  const blendedColor = blended >= 30 ? "#1D9E75" : blended >= 10 ? "#378ADD" : "#BA7517";

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "16px 18px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 14 }}>
        Channel budget optimizer — allocate spend to maximise CLV return
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 5 }}>
            Monthly budget: <strong style={{ color: "var(--color-text-primary)" }}>{fmt(budget)}</strong>
          </div>
          <input
            type="range"
            min={budget_range?.[0] ?? 1000}
            max={budget_range?.[1] ?? 200000}
            step={1000}
            value={budget}
            onChange={e => handleBudget(parseInt(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>
            <span>{fmt(budget_range?.[0] ?? 1000)}</span>
            <span>{fmt(budget_range?.[1] ?? 200000)}</span>
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 5 }}>Optimise for segment</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(focus_segments ?? ["high_potential", "loyal", "at_risk"]).map(seg => {
              const label = seg.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
              return (
                <button
                  key={seg}
                  onClick={() => handleSeg(seg)}
                  style={{
                    fontSize: 11, padding: "5px 10px", borderRadius: "var(--border-radius-md)",
                    cursor: "pointer",
                    border: focusSeg === seg
                      ? "0.5px solid var(--color-border-primary)"
                      : "0.5px solid var(--color-border-tertiary)",
                    background: focusSeg === seg ? "var(--color-background-secondary)" : "transparent",
                    fontWeight: focusSeg === seg ? 500 : 400,
                    color: "var(--color-text-primary)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 2 }}>Projected CLV return</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-success)" }}>
            {fmt(summary.total_projected_return)}
          </div>
        </div>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 2 }}>Blended CLV:CAC</div>
          <div style={{ fontSize: 18, fontWeight: 500, color: blendedColor }}>
            {blended > 0 ? `${blended.toFixed(1)}×` : "—"}
          </div>
        </div>
        <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 2 }}>Channels active</div>
          <div style={{ fontSize: 18, fontWeight: 500 }}>{channels.length}</div>
        </div>
      </div>

      <div>
        <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 0 6px", borderBottom: "0.5px solid var(--color-border-secondary)" }}>
          <span style={{ flex: 1 }}>Channel</span>
          <span>Allocation</span>
          <span style={{ width: 76, textAlign: "center" }}>Signal</span>
        </div>
        {channels.map(ch => (
          <ChannelRow key={ch.channel} ch={ch} maxRatio={maxRatio} />
        ))}
      </div>

      {clvCacMatrix == null && (
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--color-text-secondary)", padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
          <i className="ti ti-info-circle" style={{ fontSize: 13, verticalAlign: -2, marginRight: 4 }} aria-hidden="true" />
          Upload media spend data to use your actual CLV:CAC ratios. Showing model defaults.
        </div>
      )}

      {loading && (
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8, textAlign: "right" }}>
          Recalculating...
        </div>
      )}
    </div>
  );
}
