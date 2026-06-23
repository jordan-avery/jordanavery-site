import ReactECharts from 'echarts-for-react';

const DIR_COLOR = {
  positive:    '#1D9E75',
  negative:    '#BA7517',
  categorical: '#8B5CF6',
};

export default function FeatureImportance({ features }) {
  const sorted = [...features].sort((a, b) => a.importance - b.importance);
  const names  = sorted.map(f => f.feature);
  const values = sorted.map(f => f.importance);
  const colors = sorted.map(f => DIR_COLOR[f.direction] ?? DIR_COLOR.negative);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1a1a1a',
      borderColor: '#333',
      textStyle: { color: '#e5e5e5' },
      formatter(params) {
        const p    = params[0];
        const feat = features.find(f => f.feature === p.name);
        const metric = feat?.direction === 'categorical' ? 'η²' : 'R²';
        const dirLabel = feat?.direction === 'categorical'
          ? 'categorical (η²)'
          : feat?.direction === 'positive' ? 'positive' : 'negative';
        return `<b>${p.name}</b><br/>${metric}: ${p.value.toFixed(4)}<br/>Direction: ${dirLabel}`;
      },
    },
    grid: { left: 160, right: 30, top: 10, bottom: 20 },
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

  return (
    <div>
      <ReactECharts option={option} style={{ height: Math.max(200, features.length * 38) }} />
      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        {[
          { color: '#1D9E75', label: 'Positive correlation (R²)' },
          { color: '#BA7517', label: 'Negative correlation (R²)' },
          { color: '#8B5CF6', label: 'Categorical (η² — variance explained)' },
        ].map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--color-text-secondary)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, display: 'inline-block' }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
