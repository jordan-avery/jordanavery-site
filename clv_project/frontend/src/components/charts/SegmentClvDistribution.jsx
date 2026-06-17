/**
 * SegmentClvDistribution.jsx
 *
 * Shows the CLV spread WITHIN each segment — answering "how many customers
 * in this segment are near the ceiling vs. just getting started?"
 *
 * Renders as a horizontal box plot per segment:
 *   whisker = min/max, box = p25–p75, center line = median, dot = mean
 *
 * Props:
 *   segmentClvDistribution : results.segment_clv_distribution
 *   segments               : results.segments  (for colors + counts)
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

      const order = ['high_potential', 'loyal', 'at_risk', 'low_value'];
      const data  = order
        .map(seg => segmentClvDistribution.find(d => d.segment === seg))
        .filter(Boolean);

      const names  = data.map(d => SEGMENT_LABEL[d.segment]);
      const colors = data.map(d => SEGMENT_COLOR[d.segment]);

      // ECharts boxplot format: [min, p25, median, p75, max]
      const boxData  = data.map(d => [d.min, d.p25, d.median, d.p75, d.max]);
      const meanData = data.map((d, i) => [i, d.mean]);

      const countMap = Object.fromEntries((segments || []).map(s => [s.segment, s.count]));

      chart.current.setOption({
        animation: true,
        grid: { left: 110, right: 30, top: 16, bottom: 40 },
        tooltip: {
          trigger: 'item',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 0.5,
          textStyle: { color: textColor, fontSize: 12 },
          formatter(params) {
            if (params.seriesName === 'CLV range') {
              const d = data[params.dataIndex];
              const n = countMap[d.segment] || 0;
              return `<div style="font-weight:500;margin-bottom:6px">${SEGMENT_LABEL[d.segment]}</div>` +
                `<div>${n.toLocaleString()} customers</div>` +
                `<div style="margin-top:4px">Min: $${d.min.toLocaleString()}</div>` +
                `<div>25th pct: $${d.p25.toLocaleString()}</div>` +
                `<div>Median: $${d.median.toLocaleString()}</div>` +
                `<div>75th pct: $${d.p75.toLocaleString()}</div>` +
                `<div>Max: $${d.max.toLocaleString()}</div>` +
                `<div style="margin-top:4px;opacity:0.7">Avg: $${d.mean.toLocaleString()}</div>`;
            }
            if (params.seriesName === 'Mean') {
              const d = data[params.dataIndex[0]];
              return `Mean CLV: $${d.mean.toLocaleString()}`;
            }
            return '';
          },
        },
        xAxis: {
          type: 'value', name: 'Predicted CLV ($)',
          nameLocation: 'middle', nameGap: 28,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: {
            color: textColor, fontSize: 10,
            formatter: v => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`,
          },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        yAxis: {
          type: 'category', data: names,
          axisLabel: { color: textColor, fontSize: 12 },
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
        },
        series: [
          {
            name: 'CLV range',
            type: 'boxplot',
            data: boxData,
            itemStyle: {
              color: (params) => colors[params.dataIndex] + '30',
              borderColor: (params) => colors[params.dataIndex],
              borderWidth: 1.5,
            },
            boxWidth: ['30%', '40%'],
            encode: { x: [0, 1, 2, 3, 4], y: 0, tooltip: [0, 1, 2, 3, 4] },
          },
          {
            name: 'Mean',
            type: 'scatter',
            data: meanData,
            symbolSize: 8,
            itemStyle: {
              color: (params) => colors[params.dataIndex[0]],
            },
            tooltip: { show: true },
          },
        ],
      });

      const ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      return () => { ro.disconnect(); chart.current?.dispose(); };
    });
  }, [segmentClvDistribution, segments]);

  return (
    <div>
      <div ref={ref} style={{ width: '100%', height: 220 }} />
      {segmentClvDistribution.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {segmentClvDistribution.map(d => {
            const spread = d.max - d.min;
            const runway = spread > 0 ? Math.round(((d.max - d.median) / spread) * 100) : 0;
            const color  = SEGMENT_COLOR[d.segment];
            return (
              <div key={d.segment} style={{
                flex: '1 1 160px', padding: '8px 10px',
                background: 'var(--color-background-secondary)',
                borderRadius: 'var(--border-radius-md)',
                borderLeft: `3px solid ${color}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 500, color, marginBottom: 3 }}>
                  {SEGMENT_LABEL[d.segment]}
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
