import { useMemo, useState } from 'react';

const SEGMENT_BADGE = {
  high_potential: 'badge-green',
  loyal:          'badge-blue',
  at_risk:        'badge-amber',
  low_value:      'badge-muted',
};

const SEGMENT_LABEL = {
  high_potential: 'High Potential',
  loyal:          'Loyal',
  at_risk:        'At Risk',
  low_value:      'Low Value',
};

const PAGE_SIZE = 25;

export default function CustomerTable({ customers, onRowClick }) {
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(0);

  const filtered = useMemo(() => {
    let rows = customers;
    if (filter !== 'all') rows = rows.filter((r) => r.segment === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.id?.toLowerCase().includes(q) ||
          r.acquisition_channel?.toLowerCase().includes(q) ||
          r.customer_region?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [customers, filter, search]);

  const pages     = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleFilter(val) {
    setFilter(val);
    setPage(0);
  }
  function handleSearch(val) {
    setSearch(val);
    setPage(0);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search by ID, channel, region…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="input max-w-xs"
        />
        <div className="flex gap-2">
          {['all', 'high_potential', 'loyal', 'at_risk', 'low_value'].map((seg) => (
            <button
              key={seg}
              onClick={() => handleFilter(seg)}
              className={`btn text-xs py-1.5 ${filter === seg ? 'btn-primary' : 'btn-secondary'}`}
            >
              {seg === 'all' ? 'All' : SEGMENT_LABEL[seg]}
            </button>
          ))}
        </div>
        <span className="text-neutral-500 text-sm ml-auto">
          {filtered.length.toLocaleString()} customers
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              {['ID', 'Segment', 'Predicted CLV', 'Frequency', 'Avg AOV', 'P(Alive)', 'Revenue', 'Channel', 'Region'].map((h) => (
                <th key={h} className="text-left py-2 px-3 text-neutral-500 font-medium text-xs uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={row.id ?? i}
                onClick={() => onRowClick?.(row)}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                className="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors"
              >
                <td className="py-2 px-3 font-mono text-neutral-400 text-xs">{row.id}</td>
                <td className="py-2 px-3">
                  <span className={SEGMENT_BADGE[row.segment] ?? 'badge-muted'}>
                    {SEGMENT_LABEL[row.segment] ?? row.segment}
                  </span>
                </td>
                <td className="py-2 px-3 font-semibold text-white">${Number(row.predicted_clv).toLocaleString()}</td>
                <td className="py-2 px-3 text-neutral-300">{row.frequency}</td>
                <td className="py-2 px-3 text-neutral-300">${Number(row.expected_aov).toLocaleString()}</td>
                <td className="py-2 px-3 text-neutral-300">{(Number(row.p_alive) * 100).toFixed(1)}%</td>
                <td className="py-2 px-3 text-neutral-300">${Number(row.total_revenue).toLocaleString()}</td>
                <td className="py-2 px-3 text-neutral-400 text-xs">{row.acquisition_channel?.replace(/_/g, ' ')}</td>
                <td className="py-2 px-3 text-neutral-400 text-xs">{row.customer_region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="btn-secondary text-xs py-1 px-3"
          >
            ← Prev
          </button>
          <span className="text-neutral-400 text-sm">
            {page + 1} / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page === pages - 1}
            className="btn-secondary text-xs py-1 px-3"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
