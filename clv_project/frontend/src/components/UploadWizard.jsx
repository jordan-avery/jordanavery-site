import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearToken, runAnalysis, uploadSource } from '../api.js';

const SOURCES = [
  {
    key: 'crm',
    label: 'CRM Transactions',
    required: true,
    description: 'Transaction-level history — customer ID, date, order value.',
    requiredCols: ['customer_id', 'transaction_date', 'order_value'],
    aliases: 'Also accepts: user_id, order_date, revenue, amount…',
  },
  {
    key: 'ga4',
    label: 'GA4 Behaviour',
    required: false,
    description: 'Aggregated web signals per customer — sessions, pages, key events.',
    requiredCols: ['customer_id'],
    aliases: 'Also accepts: user_id, sessions, pages_per_session…',
  },
  {
    key: 'media_spend',
    label: 'Media Spend',
    required: false,
    description: 'Monthly channel-level spend + conversions — unlocks the CLV:CAC matrix.',
    requiredCols: ['channel', 'spend_usd', 'attributed_conversions'],
    aliases: 'Also accepts: source, spend, cost, conversions…',
  },
  {
    key: 'customer_profiles',
    label: 'Customer Profiles',
    required: false,
    description: 'Demographic or firmographic data — age group, type, loyalty tier.',
    requiredCols: ['customer_id'],
    aliases: 'Also accepts: user_id, age, tier, account_type…',
  },
];

function DropZone({ source, onUpload }) {
  const [state, setState]     = useState('idle'); // idle | loading | success | error
  const [result, setResult]   = useState(null);
  const [errMsg, setErrMsg]   = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  async function processFile(file) {
    if (!file) return;
    setState('loading');
    setErrMsg('');
    try {
      const data = await uploadSource(source.key, file);
      setResult(data);
      setState('success');
      onUpload(source.key, true);
    } catch (err) {
      setErrMsg(err.message);
      setState('error');
      onUpload(source.key, false);
    }
  }

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [source.key]);

  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop,
  };

  return (
    <div className={`card p-5 space-y-3 transition-colors ${dragging ? 'border-brand-green' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-white text-sm">{source.label}</span>
            {source.required
              ? <span className="badge bg-red-900/40 text-red-400">Required</span>
              : <span className="badge-muted">Optional</span>
            }
          </div>
          <p className="text-neutral-400 text-xs">{source.description}</p>
          <p className="text-neutral-600 text-xs mt-1 font-mono">{source.aliases}</p>
        </div>
        {state === 'success' && (
          <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-900/50 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-brand-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {state !== 'success' && (
        <div
          {...dropProps}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${dragging ? 'border-brand-green bg-emerald-900/10' : 'border-neutral-700 hover:border-neutral-500'}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => processFile(e.target.files[0])}
          />
          {state === 'loading' ? (
            <p className="text-neutral-400 text-sm">Uploading…</p>
          ) : (
            <>
              <p className="text-neutral-400 text-sm">Drop a CSV here or <span className="text-brand-green">browse</span></p>
              <p className="text-neutral-600 text-xs mt-1">Required columns: {source.requiredCols.join(', ')}</p>
            </>
          )}
        </div>
      )}

      {state === 'error' && (
        <p className="text-red-400 text-xs bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">
          {errMsg}
        </p>
      )}

      {state === 'success' && result && (
        <div className="space-y-2">
          <p className="text-emerald-400 text-xs">
            ✓ {result.rows.toLocaleString()} rows loaded · {result.columns.length} columns recognised
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  {result.columns.slice(0, 6).map((col) => (
                    <th key={col} className="text-left py-1 px-2 text-neutral-500 font-medium border-b border-neutral-800">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.preview.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-b border-neutral-800/50">
                    {result.columns.slice(0, 6).map((col) => (
                      <td key={col} className="py-1 px-2 text-neutral-400 font-mono truncate max-w-[120px]">
                        {String(row[col] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() => { setState('idle'); setResult(null); onUpload(source.key, false); }}
            className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors"
          >
            Replace file
          </button>
        </div>
      )}
    </div>
  );
}

export default function UploadWizard() {
  const navigate = useNavigate();
  const [uploaded, setUploaded] = useState({});
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState('');

  const crmReady = uploaded['crm'] === true;

  function handleUpload(key, success) {
    setUploaded((prev) => ({ ...prev, [key]: success }));
  }

  async function handleRun() {
    setRunning(true);
    setError('');
    try {
      const results = await runAnalysis();
      sessionStorage.setItem('clv_results', JSON.stringify(results));
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Nav */}
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-neutral-400 hover:text-white text-sm transition-colors">
            ← Demo
          </a>
          <span className="text-neutral-700">·</span>
          <span className="text-neutral-300 text-sm font-medium">Upload data</span>
        </div>
        <button
          onClick={() => { clearToken(); navigate('/access'); }}
          className="text-neutral-500 hover:text-neutral-300 text-xs transition-colors"
        >
          Sign out
        </button>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-12">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold text-white mb-2">Upload your data</h1>
          <p className="text-neutral-400 text-sm">
            Start with CRM transactions — everything else is optional but enriches the model.
            Common column name variants are automatically detected.
          </p>
        </div>

        <div className="space-y-4">
          {SOURCES.map((source) => (
            <DropZone key={source.key} source={source} onUpload={handleUpload} />
          ))}
        </div>

        {error && (
          <p className="mt-6 text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={handleRun}
            disabled={!crmReady || running}
            className="btn-primary px-6 py-2.5"
          >
            {running ? 'Running analysis…' : 'Run CLV analysis'}
          </button>
          {!crmReady && (
            <span className="text-neutral-500 text-sm">CRM data required to continue</span>
          )}
        </div>
      </main>
    </div>
  );
}
