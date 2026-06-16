/**
 * DecisionIntelligenceSection.jsx
 *
 * Drop-in section that adds the full DI layer below the existing BI dashboard.
 *
 * Props:
 *   results      : full results dict from /api/demo or /api/run
 *   apiBase      : string
 *   sessionToken : string | null
 */

import InterventionQueue from "./InterventionQueue";
import UpliftSimulator   from "./UpliftSimulator";
import BudgetOptimizer   from "./BudgetOptimizer";

function SectionDivider({ title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 16px" }}>
      <div style={{ flex: 1, height: "0.5px", background: "var(--color-border-tertiary)" }} />
      <span style={{
        fontSize: 10, fontWeight: 500, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--color-text-secondary)",
        whiteSpace: "nowrap", padding: "0 4px",
      }}>
        {title}
      </span>
      <div style={{ flex: 1, height: "0.5px", background: "var(--color-border-tertiary)" }} />
    </div>
  );
}

function DiSectionHeader({ title, description }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10, fontWeight: 500, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "var(--color-text-secondary)",
        marginBottom: 6,
      }}>
        {title}
      </div>
      <p style={{
        fontSize: 12, color: "var(--color-text-secondary)",
        lineHeight: 1.6, maxWidth: 720, margin: 0,
      }}>
        {description}
      </p>
    </div>
  );
}

export default function DecisionIntelligenceSection({ results, apiBase, sessionToken }) {
  if (!results) return null;

  const {
    intervention_queue,
    intervention_queue_summary,
    uplift_config,
    uplift_default,
    optimizer_config,
    clv_cac_matrix,
  } = results;

  const hasDI = intervention_queue || uplift_config || optimizer_config;
  if (!hasDI) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionDivider title="Decision Intelligence — what to do next" />

      {intervention_queue && intervention_queue.length > 0 && (
        <div>
          <DiSectionHeader
            title="Intervention Queue"
            description="Customers ranked by urgency and revenue impact. Each row surfaces the highest-priority action for that customer — derived from their segment, predicted survival probability, and CLV. Work top-to-bottom to maximise recovery value per hour of rep time."
          />
          <InterventionQueue
            queue={intervention_queue}
            summary={intervention_queue_summary ?? {}}
          />
        </div>
      )}

      {uplift_config && (
        <div>
          <DiSectionHeader
            title="CLV Uplift Simulator"
            description="Model the revenue impact of moving customers between value tiers through targeted campaigns. Adjust conversion rate assumptions and intervention cost per customer to find the break-even point for each movement. Net gain = (converters × CLV delta) minus (all attempted × cost)."
          />
          <UpliftSimulator
            upliftConfig={uplift_config}
            upliftDefault={uplift_default}
            apiBase={apiBase}
            sessionToken={sessionToken}
          />
        </div>
      )}

      {optimizer_config && (
        <div>
          <DiSectionHeader
            title="Budget Optimizer"
            description="Allocate a marketing budget across channels to maximise total predicted CLV return. Weights are derived from the CLV:CAC matrix above — channels that acquire higher-value customers receive proportionally more spend, subject to concentration caps."
          />
          <BudgetOptimizer
            optimizerConfig={optimizer_config}
            clvCacMatrix={clv_cac_matrix}
            apiBase={apiBase}
            sessionToken={sessionToken}
          />
        </div>
      )}
    </div>
  );
}
