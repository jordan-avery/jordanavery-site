/**
 * RevenueOrdersTrend.jsx
 *
 * Monthly revenue (bars), order count (line), and AOV (line) over time.
 * Dual Y-axis: left = revenue, right = order count / AOV.
 * AOV shown as a smoothed secondary line using a 3-month rolling average.
 *
 * Props:
 *   monthlyTrend : results.monthly_trend  (array of {month, revenue, orders, avg_order_value})
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

function fmt(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function RevenueOrdersTrend({ monthlyTrend = [] }) {
  const ref   = useRef(null);
  const chart = useRef(null);

  useEffect(() => {
    if (!monthlyTrend.length || !ref.current) return;

    loadECharts().then((ec) => {
      if (chart.current) chart.current.dispose();
      chart.current = ec.init(ref.current, null, { renderer: 'svg' });

      const months  = monthlyTrend.map(d => d.month);
      const revenue = monthlyTrend.map(d => d.revenue);
      const orders  = monthlyTrend.map(d => d.orders);
      const aov     = monthlyTrend.map(d => d.avg_order_value);

      // Rolling 3-month avg for AOV to smooth noise
      const aovSmooth = aov.map((_, i) => {
        const slice = aov.slice(Math.max(0, i - 2), i + 1);
        return parseFloat((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
      });

      const dark = document.documentElement.classList.contains('dark') ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const textColor    = dark ? '#9c9a92' : '#73726c';
      const gridColor    = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const barColor     = dark ? '#185FA5' : '#378ADD';
      const lineColor    = dark ? '#1D9E75' : '#0F6E56';
      const aovColor     = dark ? '#EF9F27' : '#BA7517';
      const tooltipBg    = dark ? '#1a1a18' : '#ffffff';
      const tooltipBorder= dark ? '#3a3a38' : '#e0dfd8';

      chart.current.setOption({
        animation: true,
        grid: { left: 60, right: 70, top: 30, bottom: 40 },
        tooltip: {
          trigger: 'axis',
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 0.5,
          textStyle: { color: textColor, fontSize: 12 },
          formatter(params) {
            const month = params[0]?.axisValue;
            const rev   = params.find(p => p.seriesName === 'Revenue');
            const ord   = params.find(p => p.seriesName === 'Orders');
            const a     = params.find(p => p.seriesName === 'Avg order value');
            return `<div style="font-weight:500;margin-bottom:6px">${month}</div>` +
              (rev ? `<div>Revenue: ${fmt(rev.value)}</div>` : '') +
              (ord ? `<div>Orders: ${ord.value.toLocaleString()}</div>` : '') +
              (a   ? `<div>AOV (3mo avg): $${a.value}</div>` : '');
          },
        },
        legend: {
          top: 0, right: 0,
          data: ['Revenue', 'Orders', 'Avg order value'],
          textStyle: { color: textColor, fontSize: 11 },
          itemWidth: 12, itemHeight: 8,
        },
        xAxis: {
          type: 'category', data: months,
          axisLabel: {
            color: textColor, fontSize: 10,
            formatter: v => v.slice(0, 7),
            interval: Math.floor(months.length / 8),
          },
          axisLine: { lineStyle: { color: gridColor } },
          axisTick: { show: false },
        },
        yAxis: [
          {
            type: 'value', name: 'Revenue',
            nameTextStyle: { color: textColor, fontSize: 10 },
            axisLabel: { color: textColor, fontSize: 10, formatter: v => fmt(v) },
            splitLine: { lineStyle: { color: gridColor, width: 0.5 } },
          },
          {
            type: 'value', name: 'Orders / AOV',
            nameTextStyle: { color: textColor, fontSize: 10 },
            axisLabel: { color: textColor, fontSize: 10 },
            splitLine: { show: false },
          },
        ],
        series: [
          {
            name: 'Revenue', type: 'bar', yAxisIndex: 0, data: revenue,
            itemStyle: { color: barColor, opacity: 0.85 },
            barMaxWidth: 18,
          },
          {
            name: 'Orders', type: 'line', yAxisIndex: 1, data: orders,
            lineStyle: { color: lineColor, width: 1.5 },
            itemStyle: { color: lineColor },
            symbol: 'none', smooth: 0.3,
          },
          {
            name: 'Avg order value', type: 'line', yAxisIndex: 1, data: aovSmooth,
            lineStyle: { color: aovColor, width: 1.5, type: 'dashed' },
            itemStyle: { color: aovColor },
            symbol: 'none', smooth: 0.3,
          },
        ],
      });

      const ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      return () => { ro.disconnect(); chart.current?.dispose(); };
    });
  }, [monthlyTrend]);

  return <div ref={ref} style={{ width: '100%', height: 260 }} />;
}
