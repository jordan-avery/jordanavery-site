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
        <InterventionQueue
          queue={intervention_queue}
          summary={intervention_queue_summary ?? {}}
        />
      )}

      {uplift_config && (
        <UpliftSimulator
          upliftConfig={uplift_config}
          upliftDefault={uplift_default}
          apiBase={apiBase}
          sessionToken={sessionToken}
        />
      )}

      {optimizer_config && (
        <BudgetOptimizer
          optimizerConfig={optimizer_config}
          clvCacMatrix={clv_cac_matrix}
          apiBase={apiBase}
          sessionToken={sessionToken}
        />
      )}
    </div>
  );
}
