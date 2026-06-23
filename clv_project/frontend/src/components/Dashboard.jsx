import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearToken } from '../api.js';
import ChannelClv from './charts/ChannelClv.jsx';
import ClvCacMatrix from './charts/ClvCacMatrix.jsx';
import ClvHistogram from './charts/ClvHistogram.jsx';
import FeatureImportance from './charts/FeatureImportance.jsx';
import SegmentDonut from './charts/SegmentDonut.jsx';
import CustomerTable from './CustomerTable.jsx';
import RevenueOrdersTrend from './charts/RevenueOrdersTrend.jsx';
import SegmentClvDistribution from './charts/SegmentClvDistribution.jsx';
import TenureClvScatter from './charts/TenureClvScatter.jsx';
import ChannelMetricsTable from './charts/ChannelMetricsTable.jsx';
import ChannelBubbleChart from './charts/ChannelBubbleChart.jsx';
import DecisionIntelligenceSection from './DecisionIntelligenceSection.jsx';
import NBAPanel from './NBAPanel.jsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEGMENT_BADGE = {
  high_potential: 'badge-green',
  loyal:          'badge-blue',
  at_risk:        'badge-amber',
  low_value:      'badge-muted',
};
const SEGMENT_LABEL = {
  high_potential: 'High Potential',
  loyal:          'Loyal',
  at_risk:        'At Risk',
  low_value:      'Low Value',
};

const PAGES = [
  { id: 'overview',     label: 'Overview' },
  { id: 'customers',    label: 'Customers' },
  { id: 'intelligence', label: 'Intelligence' },
];

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

function KpiCard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {sub && <div className="text-neutral-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <section className="card p-6">
      <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-widest mb-2">{title}</h2>
      {description && <p className="text-neutral-500 text-xs mb-5 leading-relaxed max-w-3xl">{description}</p>}
      {!description && <div className="mb-5" />}
      {children}
    </section>
  );
}

function PageNav({ page, setPage }) {
  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {PAGES.map(p => (
        <button
          key={p.id}
          onClick={() => setPage(p.id)}
          style={{
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: page === p.id ? 500 : 400,
            color: page === p.id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            borderBottom: page === p.id
              ? '2px solid var(--color-text-primary)'
              : '2px solid transparent',
            background: 'transparent',
            cursor: 'pointer',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { if (page !== p.id) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
          onMouseLeave={e => { if (page !== p.id) e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard({ resultsOverride }) {
  const navigate   = useNavigate();
  const dashRef    = useRef(null);
  const [results, setResults]             = useState(null);
  const [page, setPage]                   = useState('overview');
  const [exporting, setExporting]         = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const sessionToken = localStorage.getItem('clv_token');

  useEffect(() => {
    if (resultsOverride) { setResults(resultsOverride); return; }
    const stored = sessionStorage.getItem('clv_results');
    if (stored) { setResults(JSON.parse(stored)); }
    else { navigate('/upload'); }
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

  const {
    kpis, segments, clv_distribution, channel_clv, feature_importance,
    customer_records, clv_cac_matrix, monthly_trend, segment_clv_distribution,
    tenure_clv_scatter, channel_metrics,
  } = results;

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Top nav */}
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

      {/* Page tab navigation */}
      <div className="border-b border-neutral-800 px-6 no-print">
        <PageNav page={page} setPage={setPage} />
      </div>

      <main ref={dashRef} className="flex-1 max-w-7xl mx-auto w-full px-4 py-8 space-y-6">

        {/* Shared header */}
        <div>
          <h1 className="text-2xl font-semibold text-white">CLV Analysis</h1>
          <p className="text-neutral-500 text-sm mt-1">
            {kpis.time_horizon_months}-month horizon ·{' '}
            Sources: {kpis.data_sources_used.join(', ')} ·{' '}
            {kpis.total_customers.toLocaleString()} customers
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* PAGE 1 — Overview                                                */}
        {/* ---------------------------------------------------------------- */}
        {page === 'overview' && (
          <>
            {/* Revenue trend */}
            {monthly_trend?.length > 0 && (
              <Section
                title="Revenue & order trends"
                description="Monthly revenue (bars), order volume (solid line), and average order value (dashed). AOV uses a 3-month rolling average to smooth noise. Review before interpreting CLV scores — a declining revenue trend makes at-risk recovery more urgent."
              >
                <RevenueOrdersTrend monthlyTrend={monthly_trend} />
              </Section>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard
                label="Avg predicted CLV"
                value={`$${kpis.avg_predicted_clv.toLocaleString()}`}
                sub={`Median $${kpis.median_predicted_clv.toLocaleString()}`}
              />
              <KpiCard
                label="High-potential customers"
                value={kpis.high_potential_count.toLocaleString()}
                sub={`${kpis.high_potential_pct}% of base`}
              />
              <KpiCard
                label="At-risk revenue"
                value={`$${kpis.at_risk_revenue.toLocaleString()}`}
                sub="Predicted CLV at risk"
              />
              <KpiCard
                label="Total customers"
                value={kpis.total_customers.toLocaleString()}
                sub={`${kpis.data_sources_used.length} source${kpis.data_sources_used.length > 1 ? 's' : ''} used`}
              />
              {kpis.top_50_clv_pct != null && (
                <KpiCard
                  label="CLV concentration — top 50"
                  value={`${kpis.top_50_clv_pct}%`}
                  sub={`Top 100 = ${kpis.top_100_clv_pct}% of total predicted CLV`}
                />
              )}
              {kpis.low_activity_count != null && kpis.low_activity_count > 0 && (
                <KpiCard
                  label="Low-activity customers"
                  value={kpis.low_activity_count.toLocaleString()}
                  sub={`${kpis.low_activity_pct}% likely churned — excluded from CLV histogram`}
                />
              )}
            </div>

            {/* Segments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section
                title="Customer segments"
                description="Customers scored using BG/NBD + Gamma-Gamma, placed into four tiers by predicted 12-month CLV."
              >
                <SegmentDonut segments={segments} />
              </Section>
              <Section
                title="Segment detail"
                description="Each tier has a distinct recommended response. High Potential warrants proactive high-touch investment. At Risk needs a win-back before P(alive) drops too far."
              >
                <div className="space-y-3">
                  {segments.map(seg => (
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

            {/* CLV within segments + tenure scatter */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {segment_clv_distribution?.length > 0 && (
                <Section
                  title="CLV distribution within segments"
                  description="Spread of predicted CLV inside each segment — not just the average. Box = 25th–75th pct; dot = mean; whiskers = min/max."
                >
                  <SegmentClvDistribution
                    segmentClvDistribution={segment_clv_distribution}
                    segments={segments}
                  />
                </Section>
              )}
              {tenure_clv_scatter?.length > 0 && (
                <Section
                  title="Tenure vs. predicted CLV"
                  description="Each dot is a customer. Short tenure + high CLV = high runway, invest now. Long tenure + high CLV = likely saturated, focus on retention."
                >
                  <TenureClvScatter scatter={tenure_clv_scatter} />
                </Section>
              )}
            </div>

            {/* CLV histogram + feature importance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section
                title="CLV distribution"
                description="Distribution of predicted CLV among active customers (predicted future purchases ≥ 0.1). Customers the model identifies as churned are counted in the low-activity KPI above."
              >
                <ClvHistogram distribution={clv_distribution} />
              </Section>
              <Section
                title="Feature importance"
                description="Which signals most strongly predict CLV. Numeric features use Pearson r². Categorical features (gender, channel, region) use η² — the share of CLV variance explained by group membership."
              >
                <FeatureImportance features={feature_importance} />
              </Section>
            </div>

            {/* Channel CLV */}
            <Section
              title="Avg predicted CLV by acquisition channel"
              description="Compares quality of customers by acquisition channel, not just volume. A high-CAC channel can still be worth it if its customers have significantly higher lifetime value."
            >
              <ChannelClv channelClv={channel_clv} />
            </Section>

            {clv_cac_matrix && (
              <Section
                title="CLV:CAC ratio by segment × channel"
                description="Each segment's avg predicted CLV divided by the channel's cost-per-acquisition. Ratio above 3× is worth scaling. Below 1× means acquisition cost exceeds predicted return."
              >
                <ClvCacMatrix matrix={clv_cac_matrix} />
              </Section>
            )}

            {channel_metrics?.length > 0 && (
              <Section
                title="Channel efficiency — full breakdown"
                description="Every channel scored on CVR, CAC, avg CLV, CLV:CAC, and ROAS. Sort any column. High CLV:CAC + low volume = efficient but unscaled opportunity."
              >
                <ChannelMetricsTable channelMetrics={channel_metrics} channelClv={channel_clv} />
              </Section>
            )}

            {channel_metrics?.length > 0 && (
              <Section
                title="Channel efficiency vs. scale"
                description="X = CLV:CAC ratio (efficiency). Y = conversion volume (scale). Bubble size = total spend. Top-right = scale this channel."
              >
                <ChannelBubbleChart channelMetrics={channel_metrics} />
              </Section>
            )}
          </>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* PAGE 2 — Customers                                               */}
        {/* ---------------------------------------------------------------- */}
        {page === 'customers' && (
          <Section
            title="Customer records (top 500 by CLV)"
            description="Your highest-value customers ranked by predicted CLV. Click any row to open a panel with that customer's next best actions — specific, prioritised recommendations based on their individual signal combination."
          >
            <div style={{ position: 'relative' }}>
              <CustomerTable customers={customer_records} onRowClick={setSelectedCustomer} />
              {selectedCustomer && (
                <NBAPanel customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
              )}
            </div>
          </Section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* PAGE 3 — Decision Intelligence                                   */}
        {/* ---------------------------------------------------------------- */}
        {page === 'intelligence' && (
          <DecisionIntelligenceSection
            results={results}
            apiBase=""
            sessionToken={sessionToken}
          />
        )}

      </main>
    </div>
  );
}
