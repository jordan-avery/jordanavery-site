import ReactECharts from 'echarts-for-react';

export default function ClvHistogram({ distribution }) {
  const labels = distribution.map((d) => `$${d.bin_start.toLocaleString()}`);
  const counts = distribution.map((d) => d.count);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter: (params) => {
        const p = params[0];
        return `<b>${p.name}</b><br/>Customers: ${p.value.toLocaleString()}`;
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        color: '#737373',
        fontSize: 11,
        rotate: 35,
        interval: Math.floor(labels.length / 8),
      },
      axisLine: { lineStyle: { color: '#333' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#737373', fontSize: 11 },
      splitLine: { lineStyle: { color: '#262626' } },
    },
    series: [
      {
        type: 'bar',
        data: counts,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#378ADD' },
              { offset: 1, color: '#1e3a5f' },
            ],
          },
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: { itemStyle: { color: '#4fa3f7' } },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 260 }} />;
}
