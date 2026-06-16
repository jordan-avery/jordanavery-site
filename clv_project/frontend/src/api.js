/**
 * API client — all calls use relative URLs so they work both locally
 * (proxied by Vite to :8000) and in production (same origin).
 */

const BASE = '/api';

function getToken() {
  return localStorage.getItem('clv_token');
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export function isAuthenticated() {
  return Boolean(getToken());
}

export function clearToken() {
  localStorage.removeItem('clv_token');
}

export async function getDemo() {
  const res = await fetch(`${BASE}/demo`);
  return handleResponse(res);
}

export async function requestAccess({ name, email, company }) {
  const res = await fetch(`${BASE}/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, company }),
  });
  return handleResponse(res);
}

export async function verifyOtp({ email, code }) {
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await handleResponse(res);
  localStorage.setItem('clv_token', data.token);
  return data;
}

export async function getSchema(source) {
  const res = await fetch(`${BASE}/schema/${source}`, {
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function uploadSource(source, file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/upload/${source}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return handleResponse(res);
}

export async function runAnalysis() {
  const res = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return handleResponse(res);
}
