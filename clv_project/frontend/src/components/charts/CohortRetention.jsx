/**
 * CohortRetention.jsx — Phase 2A
 *
 * Line chart showing % of cohort customers still purchasing at each tenure
 * milestone. One line per quarterly acquisition cohort + bold red average line.
 *
 * Props:
 *   cohortRetention : results.cohort_retention  (dict keyed by cohort label)
 *   summary         : results.cohort_retention_summary
 */

import ReactECharts from 'echarts-for-react';
import { useState } from 'react';

const MILESTONE_LABEL = { m1: '1mo', m3: '3mo', m6: '6mo', m12: '12mo', m18: '18mo', m24: '24mo' };
const MILESTONE_KEYS  = ['m1', 'm3', 'm6', 'm12', 'm18', 'm24'];

const CALLOUT_KEYS = ['m3', 'm12', 'm24'];

// Muted palette for individual cohort lines
const COHORT_COLORS = [
  '#378ADD', '#1D9E75', '#BA7517', '#8B5CF6', '#888780',
  '#3B8FD4', '#2AAF82', '#D49020', '#9B6CF6', '#9A9790',
];

export default function CohortRetention({ cohortRetention = {}, summary = {} }) {
  const [showAll, setShowAll] = useState(false);

  const cohortList = Object.values(cohortRetention).sort((a, b) => a.cohort.localeCompare(b.cohort));
  if (!cohortList.length) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '20px 0' }}>No cohort data available.</div>;
  }

  const recent6   = cohortList.slice(-6);
  const displayed = showAll ? cohortList : recent6;

  const milestones = MILESTONE_KEYS.filter(k => cohortList[0]?.rates?.[k] != null);
  const xLabels    = milestones.map(k => MILESTONE_LABEL[k] || k);

  // Individual cohort series (muted, thin)
  const series = displayed.map((c, i) => ({
    name: c.cohort,
    type: 'line',
    data: milestones.map(k => c.rates[k] != null ? +(c.rates[k] * 100).toFixed(1) : null),
    lineStyle: { width: 1.5, opacity: 0.55, color: COHORT_COLORS[i % COHORT_COLORS.length] },
    itemStyle: { color: COHORT_COLORS[i % COHORT_COLORS.length] },
    symbol: 'circle',
    symbolSize: 3,
    connectNulls: true,
  }));

  // Bold red average line
  if (summary?.avg_rates) {
    series.push({
      name: 'Average',
      type: 'line',
      data: milestones.map(k => summary.avg_rates[k] != null ? +(summary.avg_rates[k] * 100).toFixed(1) : null),
      lineStyle: { width: 3, color: '#E24B4A' },
      itemStyle: { color: '#E24B4A' },
      symbol: 'circle',
      symbolSize: 6,
      z: 10,
    });
  }

  const option = {
    backgroundColor: 'transparent',
    grid: { left: 42, right: 20, top: 20, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5', fontSize: 12 },
      formatter(params) {
        const header = `<b>${params[0]?.axisValueLabel}</b>`;
        const lines  = params
          .filter(p => p.value != null)
          .map(p => `<span style="color:${p.color}">${p.seriesName}</span>: ${p.value}%`);
        return [header, ...lines].join('<br/>');
      },
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLabel: { color: '#737373', fontSize: 11 },
      axisLine: { lineStyle: { color: '#333' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: '#737373', fontSize: 11, formatter: v => `${v}%` },
      splitLine: { lineStyle: { color: '#262626' } },
    },
    series,
  };

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {summary.n_cohorts} cohorts · {summary.earliest_cohort} — {summary.latest_cohort}
          {' · '}
          <span style={{ color: '#E24B4A', fontWeight: 500 }}>red = average</span>
        </span>
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
            border: '0.5px solid var(--color-border-tertiary)',
            background: 'transparent', color: 'var(--color-text-secondary)',
          }}
        >
          {showAll ? 'Show recent 6' : `Show all ${cohortList.length}`}
        </button>
      </div>

      <ReactECharts option={option} style={{ height: 260 }} />

      {/* Callout cards at M3 / M12 / M24 */}
      {summary?.avg_rates && (
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          {CALLOUT_KEYS.filter(k => summary.avg_rates[k] != null).map(k => (
            <div key={k} style={{
              flex: 1, padding: '8px 10px',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-secondary)',
              borderLeft: '3px solid #E24B4A',
            }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                {MILESTONE_LABEL[k]} avg retention
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#E24B4A' }}>
                {Math.round(summary.avg_rates[k] * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
