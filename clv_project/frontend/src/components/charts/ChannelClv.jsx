import ReactECharts from 'echarts-for-react';

export default function ChannelClv({ channelClv }) {
  const sorted = [...channelClv].sort((a, b) => b.avg_clv - a.avg_clv);
  const channels = sorted.map((c) => c.acquisition_channel);
  const values   = sorted.map((c) => c.avg_clv);
  const counts   = sorted.map((c) => c.count);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter: (params) => {
        const idx = params[0].dataIndex;
        return (
          `<b>${channels[idx]}</b><br/>` +
          `Avg CLV: $${values[idx].toLocaleString()}<br/>` +
          `Customers: ${counts[idx].toLocaleString()}`
        );
      },
    },
    grid: { left: 140, right: 30, top: 10, bottom: 20 },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: '#737373',
        fontSize: 11,
        formatter: (v) => `$${v.toLocaleString()}`,
      },
      splitLine: { lineStyle: { color: '#262626' } },
    },
    yAxis: {
      type: 'category',
      data: channels.map((c) => c.replace(/_/g, ' ')),
      axisLabel: { color: '#a3a3a3', fontSize: 12 },
      axisLine: { lineStyle: { color: '#333' } },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 0,
              colorStops: [
                { offset: 0, color: '#1e3a5f' },
                { offset: 1, color: '#378ADD' },
              ],
            },
            borderRadius: [0, 3, 3, 0],
          },
        })),
        emphasis: { itemStyle: { opacity: 0.8 } },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: Math.max(200, channelClv.length * 40) }} />;
}
