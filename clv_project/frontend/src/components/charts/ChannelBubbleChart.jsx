/**
 * ChannelBubbleChart.jsx
 *
 * Bubble chart: x = CLV:CAC ratio, y = conversion volume, bubble size = total spend.
 * Shows efficiency vs. scale simultaneously — a channel can be efficient but not
 * scalable (top-left), or scalable but inefficient (bottom-right).
 *
 * Quadrants (split at median ratio and median volume):
 *   High ratio + High volume = Scale this (top right)
 *   High ratio + Low volume  = Explore scaling (top left)
 *   Low ratio  + High volume = Optimise or cut (bottom right)
 *   Low ratio  + Low volume  = Deprioritise (bottom left)
 *
 * Props:
 *   channelMetrics : results.channel_metrics (requires media_spend)
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

const CHANNEL_DISPLAY = {
  email_owned:         'Email',
  paid_search:         'Paid search',
  search_sa360:        'SA360',
  display_dv360:       'DV360',
  paid_social_meta:    'Meta',
  paid_social_tiktok:  'TikTok',
  paid_social_snap:    'Snap',
};

const CHANNEL_COLORS = [
  '#1D9E75', '#378ADD', '#BA7517', '#888780', '#E24B4A', '#8B5CF6', '#EC4899',
];

export default function ChannelBubbleChart({ channelMetrics }) {
  const ref   = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    if (!channelMetrics?.length || !ref.current) return;

    loadECharts().then((ec) => {
      if (chart.current) chart.current.dispose();
      chart.current = ec.init(ref.current, null, { renderer: 'svg' });

      const dark = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const textColor    = dark ? '#9c9a92' : '#73726c';
      const gridColor    = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const tooltipBg    = dark ? '#1a1a18' : '#ffffff';
      const tooltipBorder= dark ? '#3a3a38' : '#e0dfd8';

      const maxSpend = Math.max(...channelMetrics.map(c => c.total_spend || 0));

      const series = channelMetrics.map((ch, i) => ({
        name: CHANNEL_DISPLAY[ch.channel] || ch.channel,
        type: 'scatter',
        data: [[
          ch.clv_cac_ratio || 0,
          ch.total_conversions || 0,
          ch.total_spend || 0,
        ]],
        symbolSize: (val) => {
          const pct = maxSpend > 0 ? val[2] / maxSpend : 0;
          return Math.max(12, Math.min(48, pct * 48 + 8));
        },
        itemStyle: { color: CHANNEL_COLORS[i % CHANNEL_COLORS.length], opacity: 0.8 },
        label: {
          show: true,
          formatter: CHANNEL_DISPLAY[ch.channel] || ch.channel,
          position: 'top',
          fontSize: 10,
          color: textColor,
        },
      }));

      const medRatio = channelMetrics.reduce((s, c) => s + (c.clv_cac_ratio || 0), 0) / channelMetrics.length;
      const medVol   = channelMetrics.reduce((s, c) => s + (c.total_conversions || 0), 0) / channelMetrics.length;

      chart.current.setOption({
        animation: true,
        grid: { left: 60, right: 24, top: 40, bottom: 48 },
        tooltip: {
          trigger: 'item',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 0.5,
          textStyle: { color: textColor, fontSize: 12 },
          formatter(p) {
            const ch = channelMetrics.find(c =>
              (CHANNEL_DISPLAY[c.channel] || c.channel) === p.seriesName
            );
            if (!ch) return '';
            return `<div style="font-weight:500;margin-bottom:6px">${p.seriesName}</div>` +
              `<div>CLV:CAC: ${(ch.clv_cac_ratio || 0).toFixed(1)}×</div>` +
              `<div>Conversions: ${(ch.total_conversions || 0).toLocaleString()}</div>` +
              `<div>Total spend: $${Math.round(ch.total_spend || 0).toLocaleString()}</div>` +
              `<div>CAC: $${(ch.cac || 0).toFixed(0)}</div>` +
              `<div>CVR: ${((ch.cvr || 0) * 100).toFixed(1)}%</div>`;
          },
        },
        xAxis: {
          type: 'value', name: 'CLV:CAC ratio',
          nameLocation: 'middle', nameGap: 28,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10, formatter: v => `${v}×` },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        yAxis: {
          type: 'value', name: 'Conversion volume',
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
        },
        series: [
          ...series,
          {
            type: 'scatter', data: [], silent: true,
            markLine: {
              silent: true, symbol: 'none',
              lineStyle: { color: gridColor, type: 'dashed', width: 1 },
              data: [
                { xAxis: medRatio, label: { show: false } },
                { yAxis: medVol,   label: { show: false } },
              ],
            },
            markArea: {
              silent: true,
              data: [
                [{ xAxis: medRatio, yAxis: medVol, itemStyle: { color: '#1D9E7508' } },
                 { xAxis: 99999, yAxis: 99999 }],
              ],
            },
          },
        ],
      });

      const ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      return () => { ro.disconnect(); chart.current?.dispose(); };
    });
  }, [channelMetrics]);

  if (!channelMetrics?.length) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '16px 0', textAlign: 'center' }}>
        Upload media spend data to see the channel efficiency chart.
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} style={{ width: '100%', height: 300 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
        {[
          { label: 'High CLV:CAC · High volume', sub: 'Scale this channel',              color: '#1D9E75' },
          { label: 'High CLV:CAC · Low volume',  sub: 'Test scaling — room to grow',     color: '#378ADD' },
          { label: 'Low CLV:CAC · High volume',  sub: 'Optimise or reallocate budget',   color: '#BA7517' },
          { label: 'Low CLV:CAC · Low volume',   sub: 'Deprioritise',                    color: '#888780' },
        ].map(q => (
          <div key={q.label} style={{
            padding: '6px 8px', borderRadius: 'var(--border-radius-md)',
            background: 'var(--color-background-secondary)',
            borderLeft: `3px solid ${q.color}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-primary)' }}>{q.label}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{q.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-text-secondary)' }}>
        Bubble size = total spend · Dashed lines = median ratio and volume
      </div>
    </div>
  );
}
