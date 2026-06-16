import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestAccess, verifyOtp } from '../api.js';

export default function AccessGate() {
  const navigate = useNavigate();
  const [view, setView]       = useState('request'); // 'request' | 'verify' | 'requested'
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [reqForm, setReqForm] = useState({ name: '', email: '', company: '' });
  const [otpForm, setOtpForm] = useState({ email: '', code: '' });

  async function handleRequest(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await requestAccess(reqForm);
      setView('requested');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await verifyOtp(otpForm);
      navigate('/upload');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Nav */}
      <nav className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <a href="/" className="text-neutral-400 hover:text-white text-sm transition-colors">
          ← Back to demo
        </a>
        <span className="text-neutral-500 font-mono text-xs">CLV Intelligence</span>
      </nav>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">

          {/* Request access form */}
          {view === 'request' && (
            <div>
              <h1 className="text-2xl font-semibold text-white mb-2">Request access</h1>
              <p className="text-neutral-400 text-sm mb-8">
                Upload your own CRM, GA4, and media data for a personalised CLV analysis.
                Fill in your details and I'll send you an access code.
              </p>

              <form onSubmit={handleRequest} className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1.5">First name</label>
                  <input
                    required
                    type="text"
                    placeholder="Jane"
                    value={reqForm.name}
                    onChange={(e) => setReqForm((f) => ({ ...f, name: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1.5">Work email</label>
                  <input
                    required
                    type="email"
                    placeholder="jane@company.com"
                    value={reqForm.email}
                    onChange={(e) => setReqForm((f) => ({ ...f, email: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1.5">Company</label>
                  <input
                    required
                    type="text"
                    placeholder="Acme Corp"
                    value={reqForm.company}
                    onChange={(e) => setReqForm((f) => ({ ...f, company: e.target.value }))}
                    className="input"
                  />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                  {loading ? 'Sending…' : 'Request access'}
                </button>
              </form>

              <p className="text-center text-neutral-500 text-sm mt-6">
                Already have a code?{' '}
                <button onClick={() => setView('verify')} className="text-brand-green hover:underline">
                  Enter it here
                </button>
              </p>
            </div>
          )}

          {/* Requested confirmation */}
          {view === 'requested' && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-900/30 flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-brand-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-white mb-3">Request received</h1>
              <p className="text-neutral-400 text-sm mb-8 max-w-sm mx-auto">
                I'll review your request and send your access code shortly.
                Check your email — then come back and enter it below.
              </p>
              <button onClick={() => setView('verify')} className="btn-primary">
                Enter my code
              </button>
            </div>
          )}

          {/* OTP verify form */}
          {view === 'verify' && (
            <div>
              <h1 className="text-2xl font-semibold text-white mb-2">Enter your code</h1>
              <p className="text-neutral-400 text-sm mb-8">
                Paste the access code from your email to unlock the upload dashboard.
              </p>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <label className="block text-xs text-neutral-500 mb-1.5">Email address</label>
                  <input
                    required
                    type="email"
                    placeholder="jane@company.com"
                    value={otpForm.email}
                    onChange={(e) => setOtpForm((f) => ({ ...f, email: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 mb-1.5">Access code</label>
                  <input
                    required
                    type="text"
                    placeholder="ABC123"
                    value={otpForm.code}
                    onChange={(e) => setOtpForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="input font-mono tracking-widest"
                    autoComplete="off"
                  />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                  {loading ? 'Verifying…' : 'Unlock dashboard'}
                </button>
              </form>

              <p className="text-center text-neutral-500 text-sm mt-6">
                Don't have a code yet?{' '}
                <button onClick={() => setView('request')} className="text-brand-green hover:underline">
                  Request access
                </button>
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
