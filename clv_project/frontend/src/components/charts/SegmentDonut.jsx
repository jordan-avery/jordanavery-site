import ReactECharts from 'echarts-for-react';

const SEGMENT_META = {
  high_potential: { label: 'High Potential', color: '#1D9E75' },
  loyal:          { label: 'Loyal',          color: '#378ADD' },
  at_risk:        { label: 'At Risk',        color: '#BA7517' },
  low_value:      { label: 'Low Value',      color: '#888780' },
};

export default function SegmentDonut({ segments }) {
  const data = segments.map((s) => ({
    name:  SEGMENT_META[s.segment]?.label ?? s.segment,
    value: s.count,
    itemStyle: { color: SEGMENT_META[s.segment]?.color ?? '#888' },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter: (p) =>
        `<b>${p.name}</b><br/>Count: ${p.value.toLocaleString()}<br/>${p.percent.toFixed(1)}%`,
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: { color: '#a3a3a3', fontSize: 12 },
      formatter: (name) => {
        const seg = segments.find(
          (s) => (SEGMENT_META[s.segment]?.label ?? s.segment) === name
        );
        return seg
          ? `${name}  ${seg.count.toLocaleString()}  (avg $${seg.avg_clv.toLocaleString()})`
          : name;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['50%', '75%'],
        center: ['35%', '50%'],
        data,
        label: { show: false },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.4)' },
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 280 }} />;
}
