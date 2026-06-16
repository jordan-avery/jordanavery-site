/**
 * UpliftSimulator.jsx
 *
 * Changes vs original:
 *   1. BUG FIX: localSimulate uses mv.clv_delta directly instead of
 *      re-deriving from segAvgClv lookup.
 *
 *   2. FORMULA FIX: cost is applied to customers *attempted*, gain is on
 *      customers *successfully moved*.
 *      net = (moved × delta) − (attempted × cost)
 *
 *   3. NEW: Per-movement break-even cost shown inline.
 *      Formula: breakeven = clv_delta × conversion_rate
 *
 *   4. NEW: Per-movement cost toggle — each movement can have its own cost.
 *
 * Props:
 *   upliftConfig  : results.uplift_config
 *   upliftDefault : results.uplift_default
 *   apiBase       : string
 *   sessionToken  : string | null
 */

import { useState, useCallback } from "react";

function fmt(n, prefix = "$") {
  if (n == null || isNaN(n)) return "—";
  return prefix + Math.round(Math.abs(n)).toLocaleString("en-US");
}

function fmtSigned(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.round(Math.abs(n)).toLocaleString("en-US");
  return n >= 0 ? `+$${abs}` : `-$${abs}`;
}

/**
 * Core simulation — fixed formula.
 *
 * For each movement:
 *   gross_gain    = moved × clv_delta          (CLV uplift from converters)
 *   campaign_cost = n × cost_per_customer      (you reach the full pool)
 *   net           = gross_gain - campaign_cost
 *
 * Cost against full pool because you send the email / make the call to everyone
 * before knowing who will convert. The break-even shows the max cost/customer
 * where a movement stays profitable.
 */
function localSimulate(movements, rates, costs) {
  let totalAttempted = 0, totalMoved = 0, totalGross = 0, totalCost = 0;

  const mvResults = movements.map(mv => {
    const rate        = rates[mv.id]  ?? mv.default_rate;
    const costPerCust = costs[mv.id]  ?? 40;
    const attempted   = mv.n;
    const moved       = Math.round(mv.n * rate);
    const delta       = Number(mv.clv_delta) || 0;
    const gross       = moved * delta;
    const mvCost      = attempted * costPerCust;
    const net         = gross - mvCost;
    const roi         = mvCost > 0 ? gross / mvCost : 0;
    const breakevenCost = rate * delta;

    totalAttempted += attempted;
    totalMoved     += moved;
    totalGross     += gross;
    totalCost      += mvCost;

    return { ...mv, rate, costPerCust, attempted, moved, delta, gross, mvCost, net, roi, breakevenCost };
  });

  const net     = totalGross - totalCost;
  const roi     = totalCost > 0 ? totalGross / totalCost : 0;
  const payback = totalGross > 0 ? (totalCost / (totalGross / 12)) : 999;

  return { movements: mvResults, totalAttempted, totalMoved, totalGross, totalCost, net, roi, payback };
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

function MovementRow({ mvResult }) {
  const roiColor   = mvResult.roi >= 3 ? "#1D9E75" : mvResult.roi >= 1 ? "#BA7517" : "#E24B4A";
  const netColor   = mvResult.net >= 0 ? "var(--color-text-success)" : "var(--color-text-danger, #E24B4A)";
  const overBudget = mvResult.costPerCust > mvResult.breakevenCost && mvResult.breakevenCost > 0;

  return (
    <div style={{ padding: "8px 0", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 168, color: "var(--color-text-secondary)", flexShrink: 0 }}>{mvResult.label}</span>
        <span style={{ width: 44, textAlign: "right", fontWeight: 500 }}>{Math.round(mvResult.rate * 100)}%</span>
        <span style={{ width: 64, textAlign: "right", color: "var(--color-text-secondary)" }}>{mvResult.moved.toLocaleString()}</span>
        <span style={{ flex: 1, textAlign: "right", color: "var(--color-text-success)", fontWeight: 500 }}>+{fmt(mvResult.gross)}</span>
        <span style={{ width: 72, textAlign: "right", color: netColor, fontWeight: 500 }}>{fmtSigned(mvResult.net)}</span>
        <span style={{ width: 44, textAlign: "right", color: roiColor, fontWeight: 500 }}>{mvResult.roi.toFixed(1)}×</span>
      </div>
      <div style={{ marginTop: 3, fontSize: 10, color: overBudget ? "#E24B4A" : "var(--color-text-secondary)" }}>
        Break-even cost: ${mvResult.breakevenCost.toFixed(2)}/customer
        {overBudget && (
          <span style={{ marginLeft: 6, fontWeight: 500 }}>
            → you're spending ${mvResult.costPerCust} (${(mvResult.costPerCust - mvResult.breakevenCost).toFixed(2)} over)
          </span>
        )}
      </div>
    </div>
  );
}

export default function UpliftSimulator({ upliftConfig, upliftDefault, apiBase, sessionToken }) {
  if (!upliftConfig) return null;

  const { movements, default_cost } = upliftConfig;

  const [rates, setRates] = useState(
    Object.fromEntries(movements.map(mv => [mv.id, mv.default_rate]))
  );
  const [costs, setCosts] = useState(
    Object.fromEntries(movements.map(mv => [mv.id, default_cost ?? 40]))
  );
  const [usePerMovementCost, setUsePerMovementCost] = useState(false);
  const [globalCost, setGlobalCost] = useState(default_cost ?? 40);

  const effectiveCosts = usePerMovementCost
    ? costs
    : Object.fromEntries(movements.map(mv => [mv.id, globalCost]));

  const [result, setResult] = useState(() =>
    localSimulate(
      movements,
      Object.fromEntries(movements.map(mv => [mv.id, mv.default_rate])),
      Object.fromEntries(movements.map(mv => [mv.id, default_cost ?? 40]))
    )
  );

  const run = useCallback((newRates, newCosts) => {
    setResult(localSimulate(movements, newRates, newCosts));
  }, [movements]);

  const handleRate = (id, val) => {
    const r = { ...rates, [id]: val };
    setRates(r);
    run(r, effectiveCosts);
  };

  const handleGlobalCost = (val) => {
    setGlobalCost(val);
    run(rates, Object.fromEntries(movements.map(mv => [mv.id, val])));
  };

  const handleMovementCost = (id, val) => {
    const c = { ...costs, [id]: val };
    setCosts(c);
    run(rates, usePerMovementCost ? c : Object.fromEntries(movements.map(mv => [mv.id, globalCost])));
  };

  const togglePerMovement = () => {
    const next = !usePerMovementCost;
    setUsePerMovementCost(next);
    run(rates, next ? costs : Object.fromEntries(movements.map(mv => [mv.id, globalCost])));
  };

  const netColor   = result.net >= 0 ? "var(--color-text-success)" : "#E24B4A";
  const roiColor   = result.roi >= 3 ? "#1D9E75" : result.roi >= 1 ? "#BA7517" : "#E24B4A";
  const paybackStr = result.payback < 100 ? `${result.payback.toFixed(1)}mo` : ">12mo";

  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      padding: "16px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
          CLV uplift simulator — what if you move customers between tiers?
        </div>
        <button
          onClick={togglePerMovement}
          style={{
            fontSize: 11, padding: "4px 10px", borderRadius: "var(--border-radius-md)", cursor: "pointer",
            border: "0.5px solid var(--color-border-secondary)", background: "transparent",
            color: "var(--color-text-secondary)",
          }}
        >
          {usePerMovementCost ? "Use single cost" : "Set cost per movement"}
        </button>
      </div>

      {/* Rate sliders */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        {movements.map(mv => {
          const rate       = rates[mv.id] ?? mv.default_rate;
          const pctVal     = Math.round(rate * 100);
          const mvCost     = effectiveCosts[mv.id] ?? globalCost;
          const breakeven  = rate * Number(mv.clv_delta || 0);
          const overBudget = mvCost > breakeven && breakeven > 0;

          return (
            <div key={mv.id} style={{ paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)", width: 168, flexShrink: 0 }}>
                  {mv.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{mv.description}</span>
                <span style={{
                  marginLeft: "auto", fontSize: 10, whiteSpace: "nowrap",
                  color: overBudget ? "#E24B4A" : "var(--color-text-secondary)",
                }}>
                  Max affordable: ${breakeven.toFixed(0)}/cust
                  {overBudget && " →"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", width: 168, flexShrink: 0 }}>
                  Conversion rate
                </span>
                <input
                  type="range" min={0} max={60} step={1} value={pctVal}
                  onChange={e => handleRate(mv.id, parseInt(e.target.value) / 100)}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, fontWeight: 500, minWidth: 36, textAlign: "right" }}>{pctVal}%</span>
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)", minWidth: 64, textAlign: "right" }}>
                  {Math.round(mv.n * rate).toLocaleString()} conv.
                </span>
              </div>

              {usePerMovementCost && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: "var(--color-text-secondary)", width: 168, flexShrink: 0 }}>
                    Cost / customer attempted
                  </span>
                  <input
                    type="range" min={0} max={300} step={5} value={mvCost}
                    onChange={e => handleMovementCost(mv.id, parseInt(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 500, color: overBudget ? "#E24B4A" : "var(--color-text-primary)", minWidth: 36, textAlign: "right" }}>
                    ${mvCost}
                  </span>
                  <span style={{ minWidth: 64 }} />
                </div>
              )}
            </div>
          );
        })}

        {!usePerMovementCost && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 168, flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-primary)" }}>
                Intervention cost / customer
              </div>
              <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>email, offers, rep time</div>
            </div>
            <input
              type="range" min={0} max={300} step={5} value={globalCost}
              onChange={e => handleGlobalCost(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 12, fontWeight: 500, minWidth: 36, textAlign: "right" }}>${globalCost}</span>
            <span style={{ minWidth: 64 }} />
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginBottom: 14 }}>
        <KpiCard label="Net CLV uplift"    value={fmtSigned(result.net)}  color={netColor} />
        <KpiCard label="Customers touched" value={result.totalAttempted?.toLocaleString() ?? "—"} sub={`${result.totalMoved?.toLocaleString()} expected converters`} />
        <KpiCard label="ROI on spend"      value={`${result.roi?.toFixed(1) ?? "—"}×`} color={roiColor} />
        <KpiCard label="Payback period"    value={paybackStr} sub="to recover campaign cost" />
      </div>

      {/* Per-movement table */}
      <div>
        <div style={{ display: "flex", gap: 12, padding: "4px 0 6px", borderBottom: "0.5px solid var(--color-border-secondary)", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <span style={{ width: 168 }}>Movement</span>
          <span style={{ width: 44, textAlign: "right" }}>Rate</span>
          <span style={{ width: 64, textAlign: "right" }}>Conv.</span>
          <span style={{ flex: 1, textAlign: "right" }}>Gross gain</span>
          <span style={{ width: 72, textAlign: "right" }}>Net</span>
          <span style={{ width: 44, textAlign: "right" }}>ROI</span>
        </div>
        {result.movements?.map(mv => (
          <MovementRow key={mv.id} mvResult={mv} />
        ))}
        <div style={{ display: "flex", gap: 12, padding: "8px 0 0", fontSize: 12, fontWeight: 500 }}>
          <span style={{ width: 168 }}>Total</span>
          <span style={{ width: 44 }} />
          <span style={{ width: 64, textAlign: "right" }}>{result.totalMoved?.toLocaleString()}</span>
          <span style={{ flex: 1, textAlign: "right", color: "var(--color-text-success)" }}>+{fmt(result.totalGross)}</span>
          <span style={{ width: 72, textAlign: "right", color: netColor }}>{fmtSigned(result.net)}</span>
          <span style={{ width: 44, textAlign: "right", color: roiColor }}>{result.roi?.toFixed(1)}×</span>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--color-text-secondary)", padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", lineHeight: 1.5 }}>
        <strong style={{ color: "var(--color-text-primary)" }}>How this works:</strong> Cost is applied to everyone you attempt to reach (you don't know who converts before you try). Gain is credited only to customers who successfully move tiers. "Max affordable" = the highest cost-per-customer where this movement stays profitable at the current conversion rate.
      </div>
    </div>
  );
}
