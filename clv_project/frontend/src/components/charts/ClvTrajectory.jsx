/**
 * ClvTrajectory.jsx — Phase 2B
 *
 * Line chart: avg cumulative revenue per customer at tenure milestones,
 * one line per segment with end-of-line value labels.
 *
 * Insight cards below flag segments whose curve flattens sharply in months
 * 12-24 (intervention window closing).
 *
 * Props:
 *   clvTrajectory : results.clv_trajectory  (list of { segment, trajectory })
 */

import ReactECharts from 'echarts-for-react';

const SEGMENT_LABEL = {
  high_potential: 'High Potential',
  loyal:          'Loyal',
  at_risk:        'At Risk',
  low_value:      'Low Value',
};

const SEGMENT_COLOR = {
  high_potential: '#1D9E75',
  loyal:          '#378ADD',
  at_risk:        '#BA7517',
  low_value:      '#888780',
};

const MILESTONE_LABEL = { m3: '3mo', m6: '6mo', m12: '12mo', m18: '18mo', m24: '24mo' };

export default function ClvTrajectory({ clvTrajectory = [] }) {
  if (!clvTrajectory.length) {
    return <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '20px 0' }}>No trajectory data available.</div>;
  }

  const milestones = Object.keys(clvTrajectory[0]?.trajectory || {});
  const xLabels    = milestones.map(k => MILESTONE_LABEL[k] || k);

  const series = clvTrajectory.map(seg => ({
    name: SEGMENT_LABEL[seg.segment] || seg.segment,
    type: 'line',
    data: milestones.map(k => seg.trajectory[k] ?? null),
    lineStyle: { width: 2.5, color: SEGMENT_COLOR[seg.segment] },
    itemStyle: { color: SEGMENT_COLOR[seg.segment] },
    symbol: 'circle',
    symbolSize: 5,
    endLabel: {
      show: true,
      formatter: p => `$${Math.round(p.value).toLocaleString()}`,
      fontSize: 10,
      color: SEGMENT_COLOR[seg.segment],
      fontWeight: 500,
    },
    connectNulls: true,
  }));

  const option = {
    backgroundColor: 'transparent',
    grid: { left: 60, right: 80, top: 20, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5', fontSize: 12 },
      formatter(params) {
        const header = `<b>${params[0]?.axisValueLabel}</b>`;
        const lines  = params
          .filter(p => p.value != null)
          .map(p => `<span style="color:${p.color}">${p.seriesName}</span>: $${Math.round(p.value).toLocaleString()}`);
        return [header, ...lines].join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: '#737373', fontSize: 11 },
      itemWidth: 14, itemHeight: 3,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLabel: { color: '#737373', fontSize: 11 },
      axisLine: { lineStyle: { color: '#333' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#737373', fontSize: 11,
        formatter: v => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`,
      },
      splitLine: { lineStyle: { color: '#262626' } },
    },
    series,
  };

  // Detect flattening: 12-24mo growth < 50% of 6-12mo growth
  const insights = clvTrajectory.filter(seg => {
    const t = seg.trajectory;
    if (!t.m6 || !t.m12 || !t.m24) return false;
    const early = t.m12 - t.m6;
    const late  = t.m24 - t.m12;
    return early > 0 && late < early * 0.5;
  });

  return (
    <div>
      <ReactECharts option={option} style={{ height: 270 }} />

      {insights.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {insights.map(seg => {
            const t = seg.trajectory;
            return (
              <div key={seg.segment} style={{
                padding: '8px 10px',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-secondary)',
                borderLeft: `3px solid ${SEGMENT_COLOR[seg.segment]}`,
                fontSize: 11,
              }}>
                <span style={{ fontWeight: 500, color: SEGMENT_COLOR[seg.segment] }}>
                  {SEGMENT_LABEL[seg.segment]}
                </span>{' '}
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Curve flattening 12–24mo (${Math.round(t.m12).toLocaleString()} → ${Math.round(t.m24).toLocaleString()}) — intervention window closing
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
