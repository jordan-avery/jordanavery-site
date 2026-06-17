/**
 * SegmentClvDistribution.jsx — fixed
 *
 * Fix: ECharts 5 horizontal boxplot requires one series per data point
 * when you want per-row coloring. The single-series + encode approach
 * renders the axis labels but not the boxes. Split into one series per
 * segment so each gets its own itemStyle color.
 */

import { useEffect, useRef } from 'react';

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

// Order top-to-bottom in the chart (yAxis category order reversed so High Potential is on top)
const ORDER = ['low_value', 'at_risk', 'loyal', 'high_potential'];

export default function SegmentClvDistribution({ segmentClvDistribution = [], segments = [] }) {
  const ref   = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    if (!segmentClvDistribution.length || !ref.current) return;

    loadECharts().then((ec) => {
      if (chart.current) chart.current.dispose();
      chart.current = ec.init(ref.current, null, { renderer: 'svg' });

      const dark = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const textColor    = dark ? '#9c9a92' : '#73726c';
      const gridColor    = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const tooltipBg    = dark ? '#1a1a18' : '#ffffff';
      const tooltipBorder= dark ? '#3a3a38' : '#e0dfd8';

      const data = ORDER
        .map(seg => segmentClvDistribution.find(d => d.segment === seg))
        .filter(Boolean);

      const categoryNames = data.map(d => SEGMENT_LABEL[d.segment]);
      const countMap = Object.fromEntries((segments || []).map(s => [s.segment, s.count]));

      // One boxplot series per segment for independent coloring.
      // ECharts horizontal boxplot: xAxis = value, yAxis = category.
      // Each series has a single data point at the correct y-category index.
      const boxSeries = data.map((d) => ({
        name: SEGMENT_LABEL[d.segment],
        type: 'boxplot',
        data: [
          {
            value: [d.min, d.p25, d.median, d.p75, d.max],
            name: SEGMENT_LABEL[d.segment],
          }
        ],
        itemStyle: {
          color: SEGMENT_COLOR[d.segment] + '30',
          borderColor: SEGMENT_COLOR[d.segment],
          borderWidth: 2,
        },
        boxWidth: ['30%', '45%'],
        tooltip: {
          formatter() {
            const n = countMap[d.segment] || 0;
            return `<div style="font-weight:500;margin-bottom:6px">${SEGMENT_LABEL[d.segment]}</div>` +
              `<div>${n.toLocaleString()} customers</div>` +
              `<div style="margin-top:4px">Min: $${d.min.toLocaleString()}</div>` +
              `<div>25th pct: $${d.p25.toLocaleString()}</div>` +
              `<div>Median: $${d.median.toLocaleString()}</div>` +
              `<div>75th pct: $${d.p75.toLocaleString()}</div>` +
              `<div>Max: $${d.max.toLocaleString()}</div>` +
              `<div style="margin-top:4px;opacity:0.75">Mean: $${d.mean.toLocaleString()}</div>`;
          },
        },
      }));

      // Mean dots as scatter — one series per segment
      const meanSeries = data.map((d) => ({
        name: `${SEGMENT_LABEL[d.segment]} mean`,
        type: 'scatter',
        data: [[d.mean, SEGMENT_LABEL[d.segment]]],
        symbolSize: 9,
        itemStyle: { color: SEGMENT_COLOR[d.segment] },
        tooltip: {
          formatter: () => `Mean CLV: $${d.mean.toLocaleString()}`,
        },
      }));

      chart.current.setOption({
        animation: true,
        grid: { left: 110, right: 30, top: 10, bottom: 44 },
        tooltip: { trigger: 'item', backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 0.5, textStyle: { color: textColor, fontSize: 12 } },
        legend: { show: false },
        xAxis: {
          type: 'value',
          name: 'Predicted CLV ($)',
          nameLocation: 'middle',
          nameGap: 28,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: {
            color: textColor, fontSize: 10,
            formatter: v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`,
          },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        yAxis: {
          type: 'category',
          data: categoryNames,
          axisLabel: { color: textColor, fontSize: 12 },
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
        },
        series: [...boxSeries, ...meanSeries],
      });

      const ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      return () => { ro.disconnect(); chart.current?.dispose(); };
    });
  }, [segmentClvDistribution, segments]);

  const hp = segmentClvDistribution.find(d => d.segment === 'high_potential');

  return (
    <div>
      <div ref={ref} style={{ width: '100%', height: 230 }} />
      {hp && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['high_potential', 'loyal', 'at_risk', 'low_value'].map(segKey => {
            const d = segmentClvDistribution.find(x => x.segment === segKey);
            if (!d) return null;
            const spread = d.max - d.min;
            const runway = spread > 0 ? Math.round(((d.max - d.median) / spread) * 100) : 0;
            const color  = SEGMENT_COLOR[segKey];
            return (
              <div key={segKey} style={{
                flex: '1 1 140px', padding: '8px 10px',
                background: 'var(--color-background-secondary)',
                borderRadius: 'var(--border-radius-md)',
                borderLeft: `3px solid ${color}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 500, color, marginBottom: 3 }}>
                  {SEGMENT_LABEL[segKey]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  Median ${d.median.toLocaleString()} · Max ${d.max.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  {runway}% of range above median — runway remaining
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
