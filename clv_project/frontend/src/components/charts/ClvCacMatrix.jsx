import ReactECharts from 'echarts-for-react';

const SEGMENT_ORDER = ['high_potential', 'loyal', 'at_risk', 'low_value'];
const SEGMENT_LABELS = {
  high_potential: 'High Potential',
  loyal:          'Loyal',
  at_risk:        'At Risk',
  low_value:      'Low Value',
};

export default function ClvCacMatrix({ matrix }) {
  if (!matrix) return null;

  const segments = SEGMENT_ORDER.filter((s) => matrix[s]);
  const channels = Object.keys(Object.values(matrix)[0] || {}).filter(
    (ch) => Object.values(matrix).some((segs) => segs[ch] !== null)
  );

  const data = [];
  let maxVal = 0;
  segments.forEach((seg, si) => {
    channels.forEach((ch, ci) => {
      const val = matrix[seg]?.[ch];
      if (val !== null && val !== undefined) {
        data.push([ci, si, val]);
        if (val > maxVal) maxVal = val;
      }
    });
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter: (p) => {
        const [ci, si, val] = p.data;
        return (
          `<b>${channels[ci].replace(/_/g, ' ')}</b><br/>` +
          `Segment: ${SEGMENT_LABELS[segments[si]]}<br/>` +
          `CLV:CAC ratio: <b>${val}×</b>`
        );
      },
    },
    grid: { left: 120, right: 80, top: 20, bottom: 80 },
    xAxis: {
      type: 'category',
      data: channels.map((c) => c.replace(/_/g, ' ')),
      axisLabel: { color: '#737373', fontSize: 11, rotate: 30 },
      axisLine: { lineStyle: { color: '#333' } },
      splitArea: { show: true, areaStyle: { color: ['#141414', '#191919'] } },
    },
    yAxis: {
      type: 'category',
      data: segments.map((s) => SEGMENT_LABELS[s]),
      axisLabel: { color: '#a3a3a3', fontSize: 12 },
      axisLine: { lineStyle: { color: '#333' } },
      splitArea: { show: true, areaStyle: { color: ['#141414', '#191919'] } },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: '#737373' },
      inRange: {
        color: ['#1a1a1a', '#1e3a5f', '#378ADD', '#1D9E75'],
      },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          formatter: (p) => `${p.data[2]}×`,
          color: '#e5e5e5',
          fontSize: 11,
        },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: Math.max(220, segments.length * 70 + 100) }} />;
}
