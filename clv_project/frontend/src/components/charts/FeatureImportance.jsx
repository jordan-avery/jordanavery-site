import ReactECharts from 'echarts-for-react';

export default function FeatureImportance({ features }) {
  const sorted = [...features].sort((a, b) => a.importance - b.importance);
  const names  = sorted.map((f) => f.feature);
  const values = sorted.map((f) => f.importance);
  const colors = sorted.map((f) => (f.direction === 'positive' ? '#1D9E75' : '#BA7517'));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter: (params) => {
        const p = params[0];
        const feat = features.find((f) => f.feature === p.name);
        return `<b>${p.name}</b><br/>R²: ${p.value.toFixed(4)}<br/>Direction: ${feat?.direction}`;
      },
    },
    grid: { left: 140, right: 30, top: 10, bottom: 20 },
    xAxis: {
      type: 'value',
      max: 1,
      axisLabel: { color: '#737373', fontSize: 11 },
      splitLine: { lineStyle: { color: '#262626' } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { color: '#a3a3a3', fontSize: 12 },
      axisLine: { lineStyle: { color: '#333' } },
    },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i], borderRadius: [0, 3, 3, 0] },
        })),
        emphasis: { itemStyle: { opacity: 0.8 } },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: Math.max(200, features.length * 38) }} />;
}
