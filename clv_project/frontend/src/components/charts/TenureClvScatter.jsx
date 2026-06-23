/**
 * TenureClvScatter.jsx
 *
 * Scatter: x = tenure months, y = predicted CLV, size = frequency, color = segment.
 *
 * Toggle fix: two-effect pattern separates chart init (on scatter change) from
 * series updates (on activeSegs change). A chartReady flag gates effect 2 so it
 * never fires before the async init in effect 1 completes.
 *
 * Toggle behaviour: clicking the sole remaining active segment resets all to active
 * rather than silently ignoring the click.
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

function buildSeries(scatter, activeSegs) {
  return SEGMENTS.filter(s => activeSegs.has(s)).map(seg => ({
    name: SEGMENT_LABEL[seg],
    type: 'scatter',
    data: scatter
      .filter(d => d.segment === seg)
      .map(d => [d.tenure_months, d.predicted_clv, d.frequency, d.id]),
    symbolSize: (val) => Math.max(4, Math.min(12, val[2] / 4)),
    itemStyle: { color: SEGMENT_COLOR[seg], opacity: 0.65 },
  }));
}

export default function TenureClvScatter({ scatter = [] }) {
  const ref   = useRef(null);
  const chart = useRef(null);
  const roRef = useRef(null);
  const [activeSegs, setActiveSegs]   = useState(new Set(SEGMENTS));
  const [chartReady, setChartReady]   = useState(false);

  // Effect 1: Initialize chart when scatter data arrives or changes.
  // Does NOT depend on activeSegs — keeps init separate from filter updates.
  useEffect(() => {
    if (!scatter.length || !ref.current) return;
    let cancelled = false;

    loadECharts().then((ec) => {
      if (cancelled || !ref.current) return;

      if (chart.current) chart.current.dispose();
      if (roRef.current) roRef.current.disconnect();

      chart.current = ec.init(ref.current, null, { renderer: 'svg' });

      const dark = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const textColor     = dark ? '#9c9a92' : '#73726c';
      const gridColor     = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const tooltipBg     = dark ? '#1a1a18' : '#ffffff';
      const tooltipBorder = dark ? '#3a3a38' : '#e0dfd8';

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
        series: [],
      });

      roRef.current = new ResizeObserver(() => chart.current?.resize());
      roRef.current.observe(ref.current);
      setChartReady(true);
    });

    return () => {
      cancelled = true;
      setChartReady(false);
      roRef.current?.disconnect();
      roRef.current = null;
      chart.current?.dispose();
      chart.current = null;
    };
  }, [scatter]);

  // Effect 2: Update series when activeSegs changes OR after chart becomes ready.
  // chartReady in deps ensures this runs once after the async init above completes.
  useEffect(() => {
    if (!chartReady || !chart.current) return;
    chart.current.setOption(
      { series: buildSeries(scatter, activeSegs) },
      { replaceMerge: ['series'] },
    );
  }, [chartReady, activeSegs, scatter]);

  const toggleSeg = (seg) => {
    setActiveSegs(prev => {
      const next = new Set(prev);
      if (next.has(seg)) {
        if (next.size > 1) {
          next.delete(seg);
        } else {
          // Clicking the only remaining active segment resets to all segments
          SEGMENTS.forEach(s => next.add(s));
        }
      } else {
        next.add(seg);
      }
      return next;
    });
  };

  return (
    <div>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        {[
          { label: 'Short tenure · High CLV', sub: 'High runway — invest now',         color: '#1D9E75' },
          { label: 'Long tenure · High CLV',  sub: 'Saturated — focus on retention',   color: '#378ADD' },
          { label: 'Short tenure · Low CLV',  sub: 'Early stage — nurture, watch',     color: '#888780' },
          { label: 'Long tenure · Low CLV',   sub: 'Stuck — low intervention ROI',     color: '#BA7517' },
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
