import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearToken } from '../api.js';
import ChannelClv from './charts/ChannelClv.jsx';
import ClvCacMatrix from './charts/ClvCacMatrix.jsx';
import ClvHistogram from './charts/ClvHistogram.jsx';
import FeatureImportance from './charts/FeatureImportance.jsx';
import SegmentDonut from './charts/SegmentDonut.jsx';
import CustomerTable from './CustomerTable.jsx';
import DecisionIntelligenceSection from './DecisionIntelligenceSection.jsx';
import NBAPanel from './NBAPanel.jsx';

const SEGMENT_BADGE = {
  high_potential: 'badge-green',
  loyal:          'badge-blue',
  at_risk:        'badge-amber',
  low_value:      'badge-muted',
};
const SEGMENT_LABEL = {
  high_potential: 'High Potential',
  loyal: 'Loyal',
  at_risk: 'At Risk',
  low_value: 'Low Value',
};

function KpiCard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="text-neutral-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="card p-6">
      <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-5">{title}</h2>
      {children}
    </section>
  );
}

export default function Dashboard({ resultsOverride }) {
  const navigate   = useNavigate();
  const dashRef    = useRef(null);
  const [results, setResults] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const sessionToken = localStorage.getItem('clv_token');

  useEffect(() => {
    if (resultsOverride) {
      setResults(resultsOverride);
      return;
    }
    const stored = sessionStorage.getItem('clv_results');
    if (stored) {
      setResults(JSON.parse(stored));
    } else {
      navigate('/upload');
    }
  }, [resultsOverride, navigate]);

  async function handleExport() {
    setExporting(true);
    const { default: html2canvas } = await import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.esm.js');
    const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');

    const canvas = await html2canvas(dashRef.current, { backgroundColor: '#0a0a0a', scale: 1.5 });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 1.5, canvas.height / 1.5] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width / 1.5, canvas.height / 1.5);
    pdf.save('clv-intelligence-report.pdf');
    setExporting(false);
  }

  if (!results) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-neutral-500 text-sm">Loading results…</div>
      </div>
    );
  }

  const { kpis, segments, clv_distribution, channel_clv, feature_importance, customer_records, clv_cac_matrix } = results;

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Nav */}
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between no-print">
        <div className="flex items-center gap-4">
          <a href="/" className="text-neutral-400 hover:text-white text-sm transition-colors">← Demo</a>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-300 text-sm font-medium">Your analysis</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleExport} disabled={exporting} className="btn-secondary text-xs">
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
          <button onClick={() => { clearToken(); navigate('/access'); }} className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors">
            Sign out
          </button>
        </div>
      </nav>

      <main ref={dashRef} className="flex-1 max-w-7xl mx-auto w-full px-4 py-10 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-white">CLV Analysis</h1>
          <p className="text-neutral-500 text-sm mt-1">
            {kpis.time_horizon_months}-month horizon ·{' '}
            Sources: {kpis.data_sources_used.join(', ')} ·{' '}
            {kpis.total_customers.toLocaleString()} customers
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Avg predicted CLV" value={`$${kpis.avg_predicted_clv.toLocaleString()}`} sub={`Median $${kpis.median_predicted_clv.toLocaleString()}`} />
          <KpiCard label="High-potential customers" value={kpis.high_potential_count.toLocaleString()} sub={`${kpis.high_potential_pct}% of base`} />
          <KpiCard label="At-risk revenue" value={`$${kpis.at_risk_revenue.toLocaleString()}`} sub="Predicted CLV at risk" />
          <KpiCard label="Total customers" value={kpis.total_customers.toLocaleString()} sub={`${kpis.data_sources_used.length} source${kpis.data_sources_used.length > 1 ? 's' : ''} used`} />
        </div>

        {/* Segments + Donut */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="Customer segments">
            <SegmentDonut segments={segments} />
          </Section>
          <Section title="Segment detail">
            <div className="space-y-3">
              {segments.map((seg) => (
                <div key={seg.segment} className="flex items-start gap-3 p-3 rounded-lg bg-neutral-800/40">
                  <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: seg.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white text-sm">{SEGMENT_LABEL[seg.segment]}</span>
                      <span className={SEGMENT_BADGE[seg.segment]}>
                        {seg.count.toLocaleString()} · {seg.pct_of_base}%
                      </span>
                    </div>
                    <p className="text-neutral-400 text-xs">Avg CLV ${seg.avg_clv.toLocaleString()} · Avg AOV ${seg.avg_aov.toLocaleString()} · P(alive) {(seg.avg_p_alive * 100).toFixed(0)}%</p>
                    <p className="text-neutral-500 text-xs mt-1">{seg.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Distribution + Feature importance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="CLV distribution">
            <ClvHistogram distribution={clv_distribution} />
          </Section>
          <Section title="Feature importance">
            <FeatureImportance features={feature_importance} />
          </Section>
        </div>

        {/* Channel CLV */}
        <Section title="Avg predicted CLV by acquisition channel">
          <ChannelClv channelClv={channel_clv} />
        </Section>

        {/* CLV:CAC matrix — only shown when media_spend was uploaded */}
        {clv_cac_matrix && (
          <Section title="CLV:CAC ratio by segment × channel">
            <p className="text-neutral-500 text-xs mb-4">
              Ratio &gt; 3× is healthy. &lt; 1× means you're acquiring at a loss relative to predicted value.
            </p>
            <ClvCacMatrix matrix={clv_cac_matrix} />
          </Section>
        )}

        {/* Customer table — click a row to open the NBA panel */}
        <Section title="Customer records (top 500 by CLV)">
          <div style={{ position: 'relative' }}>
            <CustomerTable customers={customer_records} onRowClick={setSelectedCustomer} />
            {selectedCustomer && (
              <NBAPanel customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
            )}
          </div>
        </Section>

        {/* Decision Intelligence layer */}
        <DecisionIntelligenceSection
          results={results}
          apiBase=""
          sessionToken={sessionToken}
        />
      </main>
    </div>
  );
}
