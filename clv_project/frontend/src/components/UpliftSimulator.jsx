/**
 * UpliftSimulator.jsx
 *
 * Interactive simulator: user adjusts conversion rates and intervention cost,
 * sees net CLV gain, ROI, payback period, and per-movement breakdown update live.
 *
 * On slider change: calls POST /api/di/simulate-uplift with scenario params.
 * Falls back to local calculation when API is unavailable (demo mode).
 *
 * Props:
 *   upliftConfig  : results.uplift_config
 *   upliftDefault : results.uplift_default
 *   apiBase       : string  (e.g. "https://clv-intelligence.onrender.com")
 *   sessionToken  : string | null
 */

import { useState, useCallback, useRef } from "react";

function fmt(n, prefix = "$") {
  if (n == null || isNaN(n)) return "—";
  return prefix + Math.round(n).toLocaleString("en-US");
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function localSimulate(movements, rates, cost, segAvgClv) {
  let totalTouched = 0, totalGross = 0, totalCost = 0;
  const results = movements.map(mv => {
    const rate   = rates[mv.id] ?? mv.default_rate;
    const moved  = Math.round(mv.n * rate);
    const delta  = (segAvgClv[mv.to] ?? 0) - (segAvgClv[mv.from] ?? 0);
    const gross  = moved * delta;
    const mvCost = moved * cost;
    const net    = gross - mvCost;
    const roi    = mvCost > 0 ? gross / mvCost : 0;
    totalTouched += moved;
    totalGross   += gross;
    totalCost    += mvCost;
    return { ...mv, moved, delta, gross, mvCost, net, roi, rate };
  });
  const net     = totalGross - totalCost;
  const roi     = totalCost > 0 ? totalGross / totalCost : 0;
  const payback = totalGross > 0 ? (totalCost / (totalGross / 12)) : 999;
  return { movements: results, totalTouched, totalGross, totalCost, net, roi, payback };
}

function KpiCard({ label, value, color = "var(--color-text-primary)", sub }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 14px" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MovementRow({ mv, result }) {
  const pctRate = Math.round((result?.rate ?? mv.default_rate) * 100);
  const moved   = result?.moved ?? 0;
  const gross   = result?.gross ?? 0;
  const roi     = result?.roi   ?? 0;
  const roiColor = roi >= 5 ? "#1D9E75" : roi >= 2 ? "#378ADD" : roi >= 1 ? "#BA7517" : "#E24B4A";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
      borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 12,
    }}>
      <span style={{ width: 160, color: "var(--color-text-secondary)", flexShrink: 0 }}>{mv.label}</span>
      <span style={{ width: 48, textAlign: "right", color: "var(--color-text-primary)", fontWeight: 500 }}>
        {pctRate}%
      </span>
      <span style={{ width: 60, textAlign: "right", color: "var(--color-text-secondary)" }}>
        {moved.toLocaleString()}
      </span>
      <span style={{ flex: 1, textAlign: "right", color: "var(--color-text-success)", fontWeight: 500 }}>
        +{fmt(gross)}
      </span>
      <span style={{ width: 44, textAlign: "right", color: roiColor, fontWeight: 500 }}>
        {roi.toFixed(1)}×
      </span>
    </div>
  );
}

export default function UpliftSimulator({ upliftConfig, upliftDefault, apiBase, sessionToken }) {
  if (!upliftConfig) return null;

  const { movements, segment_avg_clv: segAvgClv, default_cost } = upliftConfig;

  const [rates, setRates] = useState(
    Object.fromEntries(movements.map(mv => [mv.id, mv.default_rate]))
  );
  const [cost, setCost]     = useState(default_cost ?? 40);
  const [result, setResult] = useState(() =>
    localSimulate(movements, Object.fromEntries(movements.map(mv => [mv.id, mv.default_rate])), default_cost ?? 40, segAvgClv)
  );
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const runSimulation = useCallback(async (newRates, newCost) => {
    const local = localSimulate(movements, newRates, newCost, segAvgClv);
    setResult(local);

    if (!apiBase) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const headers = { "Content-Type": "application/json" };
        if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
        const res = await fetch(`${apiBase}/api/di/simulate-uplift`, {
          method: "POST", headers,
          body: JSON.stringify({
            n_at_risk:        upliftConfig.segment_counts?.at_risk        ?? 0,
            n_loyal:          upliftConfig.segment_counts?.loyal           ?? 0,
            n_low_value:      upliftConfig.segment_counts?.low_value       ?? 0,
            n_high_potential: upliftConfig.segment_counts?.high_potential  ?? 0,
            ar_to_loyal_rate:  newRates.ar_to_loyal  ?? movements[0]?.default_rate,
            loyal_to_hp_rate:  newRates.loyal_to_hp  ?? movements[1]?.default_rate,
            lv_to_ar_rate:     newRates.lv_to_ar     ?? movements[2]?.default_rate,
            cost_per_customer: newCost,
          }),
        });
        if (!res.ok) return;
        // API validates — local calc already shown, no further update needed
      } catch (_) {
        // silent — local calc is already displayed
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [movements, segAvgClv, apiBase, sessionToken, upliftConfig]);

  const handleRate = (id, val) => {
    const newRates = { ...rates, [id]: val };
    setRates(newRates);
    runSimulation(newRates, cost);
  };

  const handleCost = (val) => {
    setCost(val);
    runSimulation(rates, val);
  };

  const roiColor = result.roi >= 5 ? "#1D9E75" : result.roi >= 2 ? "#378ADD" : result.roi >= 1 ? "#BA7517" : "#E24B4A";

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "16px 18px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 14 }}>
        CLV uplift simulator — what if you move customers between tiers?
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {movements.map(mv => {
          const rate   = rates[mv.id] ?? mv.default_rate;
          const pctVal = Math.round(rate * 100);
          return (
            <div key={mv.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 180, flexShrink: 0 }}>
                {mv.label}
                <span style={{ display: "block", fontSize: 10, color: "var(--color-text-tertiary)" }}>{mv.description}</span>
              </label>
              <input
                type="range" min={0} max={60} step={1} value={pctVal}
                onChange={e => handleRate(mv.id, parseInt(e.target.value) / 100)}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", minWidth: 36, textAlign: "right" }}>
                {pctVal}%
              </span>
              <span style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 60, textAlign: "right" }}>
                {Math.round(mv.n * rate).toLocaleString()} cust.
              </span>
            </div>
          );
        })}

        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 6, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <label style={{ fontSize: 12, color: "var(--color-text-secondary)", width: 180, flexShrink: 0 }}>
            Intervention cost / customer
            <span style={{ display: "block", fontSize: 10, color: "var(--color-text-tertiary)" }}>email, offers, rep time</span>
          </label>
          <input
            type="range" min={0} max={300} step={5} value={cost}
            onChange={e => handleCost(parseInt(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", minWidth: 36, textAlign: "right" }}>
            ${cost}
          </span>
          <span style={{ minWidth: 60 }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 14 }}>
        <KpiCard label="Net CLV uplift"    value={fmt(result.net)}                    color="var(--color-text-success)" />
        <KpiCard label="Customers touched" value={result.totalTouched?.toLocaleString() ?? "—"} />
        <KpiCard label="ROI on spend"      value={`${result.roi?.toFixed(1) ?? "—"}×`} color={roiColor} />
        <KpiCard label="Payback period"    value={result.payback < 100 ? `${result.payback?.toFixed(1)}mo` : ">12mo"} sub="to recover intervention cost" />
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0 6px", borderBottom: "0.5px solid var(--color-border-secondary)", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <span style={{ width: 160 }}>Movement</span>
          <span style={{ width: 48, textAlign: "right" }}>Rate</span>
          <span style={{ width: 60, textAlign: "right" }}>Customers</span>
          <span style={{ flex: 1, textAlign: "right" }}>Gross gain</span>
          <span style={{ width: 44, textAlign: "right" }}>ROI</span>
        </div>
        {movements.map((mv, i) => (
          <MovementRow key={mv.id} mv={mv} result={result.movements?.[i]} />
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 0", fontSize: 12, fontWeight: 500 }}>
          <span style={{ width: 160 }}>Total</span>
          <span style={{ width: 48 }} />
          <span style={{ width: 60, textAlign: "right" }}>{result.totalTouched?.toLocaleString()}</span>
          <span style={{ flex: 1, textAlign: "right", color: "var(--color-text-success)" }}>+{fmt(result.totalGross)}</span>
          <span style={{ width: 44, textAlign: "right", color: roiColor }}>{result.roi?.toFixed(1)}×</span>
        </div>
      </div>

      {loading && (
        <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 8, textAlign: "right" }}>
          Syncing with server...
        </div>
      )}
    </div>
  );
}
