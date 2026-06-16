import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDemo, isAuthenticated } from '../api.js';
import Dashboard from './Dashboard.jsx';

export default function Demo() {
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    getDemo()
      .then(setResults)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
        <p className="text-neutral-400 text-sm">Fitting BG/NBD model on synthetic data…</p>
        <p className="text-neutral-600 text-xs max-w-xs text-center">
          This takes ~30 seconds on first load while the server warms up.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-400 text-sm mb-4">Failed to load demo: {error}</p>
          <button onClick={() => window.location.reload()} className="btn-secondary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Demo banner */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-2.5 flex items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="badge bg-amber-900/50 text-amber-400">Demo mode</span>
          <span className="text-neutral-400 text-xs hidden sm:block">
            Synthetic data · 6,538 customers · 3.5 years of transactions
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated() ? (
            <button onClick={() => navigate('/upload')} className="btn-primary text-xs py-1.5">
              Upload your data →
            </button>
          ) : (
            <button onClick={() => navigate('/access')} className="btn-primary text-xs py-1.5">
              Upload your data →
            </button>
          )}
        </div>
      </div>

      {/* Full dashboard with demo results */}
      <Dashboard resultsOverride={results} />

      {/* CTA section */}
      <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-16 text-center">
        <h2 className="text-xl font-semibold text-white mb-3">Run this on your data</h2>
        <p className="text-neutral-400 text-sm max-w-md mx-auto mb-8">
          Upload your CRM transactions and optionally GA4 and media spend data.
          The model fits in under a minute — you'll get the same dashboard with
          your segments, CLV scores, and channel recommendations.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <button onClick={() => navigate('/access')} className="btn-primary px-6 py-2.5">
            Request access
          </button>
          <a
            href="https://github.com/jordanavery/jordanavery-site"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary px-6 py-2.5"
          >
            View source ↗
          </a>
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl mx-auto text-left">
          {[
            {
              title: 'BG/NBD model',
              body: 'Models the latent "alive/churned" state per customer — not just historic spend.',
            },
            {
              title: 'Gamma-Gamma AOV',
              body: 'Predicts expected order value from the distribution of each customer\'s transactions.',
            },
            {
              title: 'Percentile segmentation',
              body: 'Four operational tiers with channel spend guides — not k-means clusters.',
            },
          ].map((card) => (
            <div key={card.title} className="card p-5">
              <h3 className="text-white text-sm font-medium mb-2">{card.title}</h3>
              <p className="text-neutral-400 text-xs leading-relaxed">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
