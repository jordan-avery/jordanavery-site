/**
 * TenureClvScatter.jsx
 *
 * Scatter plot: x = months since first purchase (tenure), y = predicted CLV.
 * Each dot colored by segment. Dot size = purchase frequency.
 *
 * Reveals two actionable clusters:
 *   Short tenure + high CLV = high runway (invest now before they plateau)
 *   Long tenure + high CLV  = saturated (concentrate on retention, not upsell)
 *   Long tenure + low CLV   = stuck customers (may never move up)
 *
 * Props:
 *   scatter : results.tenure_clv_scatter
 *             array of {id, predicted_clv, tenure_months, segment, frequency}
 */

import { useEffect, useRef, useState } from 'react';

const CHART_LIB = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';

function loadECharts() {
  return new Promise((resolve) => {
    if (window.echarts) return resolve(window.echarts);
    const s = document.createElement('script');
    s.src = CHART_LIB;
    s.onload = () => resolve(window.echarts);
    document.head.appendChild(s);
  });
}

const SEGMENTS      = ['high_potential', 'loyal', 'at_risk', 'low_value'];
const SEGMENT_LABEL = { high_potential: 'High Potential', loyal: 'Loyal', at_risk: 'At Risk', low_value: 'Low Value' };
const SEGMENT_COLOR = { high_potential: '#1D9E75', loyal: '#378ADD', at_risk: '#BA7517', low_value: '#888780' };

export default function TenureClvScatter({ scatter = [] }) {
  const ref   = useRef(null);
  const chart = useRef(null);
  const [activeSegs, setActiveSegs] = useState(new Set(SEGMENTS));

  useEffect(() => {
    if (!scatter.length || !ref.current) return;

    loadECharts().then((ec) => {
      if (chart.current) chart.current.dispose();
      chart.current = ec.init(ref.current, null, { renderer: 'svg' });

      const dark = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const textColor    = dark ? '#9c9a92' : '#73726c';
      const gridColor    = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const tooltipBg    = dark ? '#1a1a18' : '#ffffff';
      const tooltipBorder= dark ? '#3a3a38' : '#e0dfd8';

      const series = SEGMENTS.filter(s => activeSegs.has(s)).map(seg => ({
        name: SEGMENT_LABEL[seg],
        type: 'scatter',
        data: scatter
          .filter(d => d.segment === seg)
          .map(d => [d.tenure_months, d.predicted_clv, d.frequency, d.id]),
        symbolSize: (val) => Math.max(4, Math.min(12, val[2] / 4)),
        itemStyle: { color: SEGMENT_COLOR[seg], opacity: 0.65 },
      }));

      chart.current.setOption({
        animation: false,
        grid: { left: 60, right: 24, top: 16, bottom: 48 },
        tooltip: {
          trigger: 'item',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 0.5,
          textStyle: { color: textColor, fontSize: 12 },
          formatter(p) {
            const [tenure, clv, freq, id] = p.value;
            return `<div style="font-weight:500;margin-bottom:4px">${id || ''}</div>` +
              `<div>Tenure: ${tenure}mo</div>` +
              `<div>Predicted CLV: $${Math.round(clv).toLocaleString()}</div>` +
              `<div>Purchases: ${freq}</div>` +
              `<div style="margin-top:4px;opacity:0.7">${p.seriesName}</div>`;
          },
        },
        legend: { show: false },
        xAxis: {
          type: 'value', name: 'Tenure (months)',
          nameLocation: 'middle', nameGap: 28,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        yAxis: {
          type: 'value', name: 'Predicted CLV ($)',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: {
            color: textColor, fontSize: 10,
            formatter: v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`,
          },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        series,
      });

      const ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      return () => { ro.disconnect(); chart.current?.dispose(); };
    });
  }, [scatter, activeSegs]);

  const toggleSeg = (seg) => {
    setActiveSegs(prev => {
      const next = new Set(prev);
      if (next.has(seg)) { if (next.size > 1) next.delete(seg); }
      else next.add(seg);
      return next;
    });
  };

  return (
    <div>
      {/* Segment filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {SEGMENTS.map(seg => {
          const active = activeSegs.has(seg);
          const color  = SEGMENT_COLOR[seg];
          return (
            <button
              key={seg}
              onClick={() => toggleSeg(seg)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: `0.5px solid ${active ? color : 'var(--color-border-tertiary)'}`,
                background: active ? color + '20' : 'transparent',
                color: active ? color : 'var(--color-text-secondary)',
                fontWeight: active ? 500 : 400,
              }}
            >
              {SEGMENT_LABEL[seg]}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-secondary)', alignSelf: 'center' }}>
          Dot size = purchase frequency
        </span>
      </div>

      <div ref={ref} style={{ width: '100%', height: 280 }} />

      {/* Quadrant guide */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        {[
          { label: 'Short tenure · High CLV', sub: 'High runway — invest now',           color: '#1D9E75' },
          { label: 'Long tenure · High CLV',  sub: 'Saturated — focus on retention',     color: '#378ADD' },
          { label: 'Short tenure · Low CLV',  sub: 'Early stage — nurture, watch',       color: '#888780' },
          { label: 'Long tenure · Low CLV',   sub: 'Stuck — low intervention ROI',       color: '#BA7517' },
        ].map(q => (
          <div key={q.label} style={{
            padding: '7px 10px', borderRadius: 'var(--border-radius-md)',
            background: 'var(--color-background-secondary)',
            borderLeft: `3px solid ${q.color}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 1 }}>{q.label}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{q.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
