/**
 * ChannelMetricsTable.jsx
 *
 * Full channel efficiency table: conversions, CVR, CAC, avg CLV, CLV:CAC, ROAS.
 * Sortable by any column. Color-coded CLV:CAC ratio pills.
 * Falls back to simple CLV-only view when no media_spend data is available.
 *
 * Props:
 *   channelMetrics : results.channel_metrics  (requires media_spend)
 *   channelClv     : results.channel_clv      (fallback if no media_spend)
 */

import { useState } from 'react';

const CHANNEL_DISPLAY = {
  email_owned:         'Email / owned',
  paid_search:         'Paid search',
  search_sa360:        'Search (SA360)',
  display_dv360:       'Display / DV360',
  paid_social_meta:    'Paid social (Meta)',
  paid_social_tiktok:  'Paid social (TikTok)',
  paid_social_snap:    'Paid social (Snap)',
  organic:             'Organic',
  direct:              'Direct',
};

function ratioColor(ratio) {
  if (!ratio || ratio <= 0) return { bg: 'var(--color-background-secondary)', text: 'var(--color-text-secondary)' };
  if (ratio >= 20) return { bg: '#E1F5EE', text: '#085041' };
  if (ratio >= 8)  return { bg: '#E6F1FB', text: '#0C447C' };
  if (ratio >= 3)  return { bg: '#FAEEDA', text: '#633806' };
  return { bg: '#FCEBEB', text: '#791F1F' };
}

function Pill({ value }) {
  const { bg, text } = ratioColor(value);
  return (
    <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 20, background: bg, color: text }}>
      {value != null ? `${value.toFixed(1)}×` : '—'}
    </span>
  );
}

const COLS = [
  { key: 'channel',           label: 'Channel',  align: 'left'  },
  { key: 'total_conversions', label: 'Volume',   align: 'right' },
  { key: 'cvr',               label: 'CVR',      align: 'right' },
  { key: 'cac',               label: 'CAC',      align: 'right' },
  { key: 'avg_clv',           label: 'Avg CLV',  align: 'right' },
  { key: 'clv_cac_ratio',     label: 'CLV:CAC',  align: 'right' },
  { key: 'roas',              label: 'ROAS',     align: 'right' },
];

export default function ChannelMetricsTable({ channelMetrics, channelClv = [] }) {
  const [sortCol, setSortCol] = useState('clv_cac_ratio');
  const [sortDir, setSortDir] = useState('desc');

  if (!channelMetrics || channelMetrics.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 10, padding: '8px 10px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-md)' }}>
          Upload media spend data to see full channel efficiency metrics (CVR, CAC, CLV:CAC, ROAS).
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Channel', 'Avg CLV', 'Customers'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '4px 8px', color: 'var(--color-text-secondary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelClv.map(ch => (
              <tr key={ch.acquisition_channel} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={{ padding: '8px 8px', color: 'var(--color-text-primary)' }}>{CHANNEL_DISPLAY[ch.acquisition_channel] || ch.acquisition_channel}</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 500 }}>${ch.avg_clv.toLocaleString()}</td>
                <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{ch.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('desc'); }
  };

  const sorted = [...channelMetrics].sort((a, b) => {
    const av = a[sortCol] ?? 0, bv = b[sortCol] ?? 0;
    if (sortCol === 'channel') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const maxConv = Math.max(...sorted.map(c => c.total_conversions || 0));

  const thStyle = (key) => ({
    textAlign: COLS.find(c => c.key === key)?.align ?? 'right',
    padding: '4px 8px',
    color: sortCol === key ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '0.5px solid var(--color-border-secondary)',
    cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
    fontWeight: sortCol === key ? 600 : 400,
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {COLS.map(col => (
              <th key={col.key} onClick={() => handleSort(col.key)} style={thStyle(col.key)}>
                {col.label}
                {sortCol === col.key && (
                  <span style={{ marginLeft: 3, opacity: 0.6 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(ch => {
            const convPct = maxConv > 0 ? (ch.total_conversions / maxConv) * 100 : 0;
            return (
              <tr key={ch.channel} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={{ padding: '9px 8px', color: 'var(--color-text-primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {CHANNEL_DISPLAY[ch.channel] || ch.channel}
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                    <div style={{ width: 48, height: 4, background: 'var(--color-background-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${convPct}%`, height: '100%', background: 'var(--color-text-info)', borderRadius: 2 }} />
                    </div>
                    <span>{(ch.total_conversions || 0).toLocaleString()}</span>
                  </div>
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {ch.cvr != null ? `${(ch.cvr * 100).toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {ch.cac != null ? `$${ch.cac.toFixed(0)}` : '—'}
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 500 }}>
                  ${(ch.avg_clv || 0).toLocaleString()}
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right' }}>
                  <Pill value={ch.clv_cac_ratio} />
                </td>
                <td style={{ padding: '9px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                  {ch.roas != null ? `${ch.roas.toFixed(1)}×` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-secondary)' }}>
        CLV:CAC: <span style={{ color: '#085041' }}>≥20× invest</span> ·{' '}
        <span style={{ color: '#0C447C' }}>8–20× maintain</span> ·{' '}
        <span style={{ color: '#633806' }}>3–8× selective</span> ·{' '}
        <span style={{ color: '#791F1F' }}>&lt;3× awareness only</span> · Click column headers to sort
      </div>
    </div>
  );
}
