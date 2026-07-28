'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

type SearchJob = {
  id: string;
  status: string;
  inputValue: string;
  rawSourceUrl?: string | null;
  finalSourceUrl?: string | null;
  offerCount: number;
  identificationConfidence?: number | null;
  identificationMethod?: string | null;
  resolveStatus?: string | null;
  summaryJson?: {
    summary?: string;
    manufacturer?: string;
    mpn?: string;
    confidence?: number;
    resolveFailed?: boolean;
    reason?: string;
  } | null;
  part?: {
    rawMpn: string;
    originalMpn?: string | null;
    normalizedMpn: string;
    manufacturer?: string | null;
    brand?: string | null;
    descriptionClean?: string | null;
    title?: string | null;
  } | null;
  errorMessage?: string | null;
};

type OfferRow = {
  id: string;
  mpn: string;
  manufacturer: string | null;
  supplierPartNumber: string | null;
  productUrl: string;
  price: string | null;
  currency: string | null;
  priceUsd: string | null;
  stockQuantity: number | null;
  availability: string | null;
  leadTime: string | null;
  moq: number | null;
  extractedAt: string;
  riskFlags: string[];
  matchConfidence: number;
  reliabilityScore: number | null;
  supplier: {
    name: string | null;
    domain: string;
    country: string | null;
    website: string | null;
  };
};

type JobEvent = {
  id: string;
  message: string;
  stage: string | null;
  createdAt: string;
};

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

function statusPercent(status: string): number {
  const stages: Record<string, number> = {
    pending: 10,
    queued: 20,
    fetching: 30,
    resolving: 50,
    searching: 70,
    completed: 100,
    completed_with_errors: 100,
    failed: 100,
    cancelled: 100,
  };
  return stages[status] ?? 10;
}

export function Dashboard() {
  const [url, setUrl] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authed, setAuthed] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [ownerCodeInput, setOwnerCodeInput] = useState('');
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [verificationSent, setVerificationSent] = useState(false);
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const status = await fetch('/api/auth/status').then((r) => r.json());
        if (cancelled) return;
        setAuthRequired(Boolean(status.authRequired));
        if (!status.authRequired) {
          setAuthed(true);
          setSignedInEmail(null);
          return;
        }
        if (status.signedIn && status.email) {
          setAuthed(true);
          setSignedInEmail(status.email);
          return;
        }
        setAuthed(false);
        setSignedInEmail(null);
      } catch {
        if (!cancelled) setAuthed(true);
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerificationSent(false);
    setDevVerifyUrl(null);
    setSendingLink(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: emailInput.trim(),
          ownerCode: ownerCodeInput.trim() || undefined,
        }),
      });
      let data: {
        error?: string;
        message?: string;
        signedIn?: boolean;
        email?: string;
        verifyUrl?: string;
        devVerifyUrl?: string;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setError(`Sign-in failed (HTTP ${res.status}). Check server logs.`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'Sign-in failed');
        return;
      }
      if (data.signedIn) {
        setAuthed(true);
        setSignedInEmail(data.email ?? emailInput.trim().toLowerCase());
        return;
      }
      setVerificationSent(true);
      const link = data.verifyUrl ?? data.devVerifyUrl;
      if (typeof link === 'string') {
        setDevVerifyUrl(link);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send verification email');
    } finally {
      setSendingLink(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
    setSignedInEmail(null);
    setVerificationSent(false);
    setDevVerifyUrl(null);
    setJob(null);
    setOffers([]);
    setEvents([]);
  }

  async function startSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setOffers([]);
    setEvents([]);
    try {
      const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start search');
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob() {
    if (!job?.id || TERMINAL.has(job.status)) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/searches/${job.id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Cancel failed');
      setJob(data.job ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;

    async function poll() {
      const [jobRes, eventsRes, offersRes] = await Promise.all([
        fetch(`/api/searches/${job!.id}`),
        fetch(`/api/searches/${job!.id}/events`),
        fetch(
          `/api/searches/${job!.id}/results?q=${encodeURIComponent(query)}&sort=priceUsd&order=asc`,
        ),
      ]);
      if (cancelled) return;
      if (jobRes.ok) setJob(await jobRes.json());
      if (eventsRes.ok) {
        const payload = await eventsRes.json();
        setEvents(payload.events ?? []);
      }
      if (offersRes.ok) {
        const payload = await offersRes.json();
        setOffers(payload.offers ?? []);
      }
    }

    void poll();
    if (job && TERMINAL.has(job.status)) {
      return () => {
        cancelled = true;
      };
    }
    const handle = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [job?.id, job?.status, query]);

  const progressLabel = useMemo(() => {
    if (!job) return 'Idle';
    return job.status.replaceAll('_', ' ');
  }, [job]);

  const identifiedMpn = job?.part?.originalMpn || job?.part?.rawMpn || job?.summaryJson?.mpn;
  const identifiedMfr = job?.part?.manufacturer || job?.summaryJson?.manufacturer;
  const isRunning = Boolean(job && !TERMINAL.has(job.status));

  if (authChecking) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4">
        <p className="text-dex-muted">Loading…</p>
      </main>
    );
  }

  if (authRequired && !authed) {
    return (
      <main className="flex min-h-screen w-full flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
        <div className="w-full max-w-md space-y-8">
          {/* Logo & Heading */}
          <div className="space-y-3 text-center">
            <div className="flex justify-center">
              <div className="rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 p-3">
                <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <h1 className="text-4xl font-bold text-white">DEX</h1>
            <p className="text-sm tracking-widest text-slate-400 uppercase">Global Sourcing</p>
          </div>

          {/* Auth Form */}
          {verificationSent ? (
            <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-800/50 backdrop-blur p-6">
              <div className="space-y-2 text-center">
                <p className="text-lg font-semibold text-white">
                  {devVerifyUrl ? '✓ Sign-in link ready' : 'Check your email'}
                </p>
                <p className="text-sm text-slate-400">
                  {devVerifyUrl
                    ? 'Click the link below to continue.'
                    : `A sign-in link is on its way to ${emailInput}`}
                </p>
              </div>
              {devVerifyUrl && (
                <a
                  href={devVerifyUrl}
                  className="block w-full rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 py-2.5 text-center font-semibold text-white transition hover:shadow-lg hover:shadow-blue-500/50"
                >
                  Continue signing in →
                </a>
              )}
              <button
                type="button"
                className="w-full text-sm font-medium text-slate-400 hover:text-white"
                onClick={() => {
                  setVerificationSent(false);
                  setDevVerifyUrl(null);
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void signIn(e)} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-slate-300">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="code" className="text-sm font-medium text-slate-300">
                  Owner code <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  id="code"
                  type="password"
                  value={ownerCodeInput}
                  onChange={(e) => setOwnerCodeInput(e.target.value)}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={sendingLink || !emailInput.trim()}
                className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 py-2.5 font-semibold text-white transition hover:shadow-lg hover:shadow-blue-500/50 disabled:opacity-60"
              >
                {sendingLink ? 'Sending link…' : 'Continue'}
              </button>
            </form>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-xs text-slate-500">
            Secure, passwordless access powered by magic links
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-800 backdrop-blur-xl sticky top-0 z-50">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 p-2.5">
              <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">DEX</h1>
              <p className="text-xs text-slate-400 tracking-wide uppercase">Global Sourcing</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {signedInEmail && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-slate-400">Signed in</p>
                  <p className="font-medium text-white text-sm">{signedInEmail}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="text-xs font-medium text-slate-400 hover:text-slate-200 transition"
                >
                  Sign out
                </button>
              </div>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-6 py-12 space-y-8">
        {/* Search Input Section */}
        <section className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-white">Find Global Suppliers</h2>
            <p className="text-slate-400">
              Paste a product page URL. We'll identify the part number and discover worldwide suppliers.
            </p>
          </div>

          <form onSubmit={startSearch} className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.sparkfun.com/products/..."
                className="flex-1 rounded-lg border border-slate-600 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                required
                type="url"
                autoComplete="url"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={submitting || !url.trim() || isRunning}
                className="rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 px-8 py-3 font-semibold text-white transition hover:shadow-lg hover:shadow-blue-500/50 disabled:opacity-60 whitespace-nowrap"
              >
                {submitting ? 'Starting…' : isRunning ? 'Working…' : 'Find Suppliers'}
              </button>
              {isRunning && (
                <button
                  type="button"
                  onClick={() => void cancelJob()}
                  disabled={cancelling}
                  className="rounded-lg border border-slate-600 px-5 py-3 font-medium text-slate-300 hover:bg-slate-800 transition disabled:opacity-60"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer hover:text-slate-200">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                className="rounded accent-blue-500"
              />
              Force refresh (bypass cache)
            </label>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
          </form>
        </section>

        {/* Progress Section */}
        {job && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 rounded-xl border border-slate-700 bg-slate-800/50 backdrop-blur p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Progress</h3>
                <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-400 bg-slate-700/50">
                  {progressLabel}
                </span>
              </div>

              {identifiedMpn && job.resolveStatus === 'identified' && (
                <div className="rounded-lg border border-slate-600 bg-slate-700/30 p-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-medium">Identified part</p>
                  <p className="text-2xl font-bold text-blue-400">
                    {identifiedMfr ? `${identifiedMfr} · ` : ''}
                    {identifiedMpn}
                  </p>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-400">
                    <span>Confidence: {typeof job.identificationConfidence === 'number' ? job.identificationConfidence.toFixed(2) : '—'}</span>
                    {job.finalSourceUrl || job.rawSourceUrl && (
                      <a
                        href={job.finalSourceUrl || job.rawSourceUrl || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Original source →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {job.summaryJson?.summary && (
                <p className="text-slate-300">{job.summaryJson.summary}</p>
              )}

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Processing</span>
                  <span>{statusPercent(job.status)}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-500"
                    style={{ width: `${statusPercent(job.status)}%` }}
                  />
                </div>
              </div>

              {job.errorMessage && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {job.errorMessage}
                </div>
              )}
            </div>

            {/* Events */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 backdrop-blur p-6 space-y-4">
              <h3 className="font-semibold text-white">Live events</h3>
              <div className="space-y-3 max-h-64 overflow-auto">
                {events.length === 0 ? (
                  <p className="text-sm text-slate-500">Waiting for updates…</p>
                ) : (
                  events.map((event) => (
                    <div key={event.id} className="border-b border-slate-700 pb-3 last:border-0">
                      <p className="text-xs text-slate-500">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </p>
                      <p className="text-sm text-slate-300 mt-1">{event.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Results Table */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 backdrop-blur p-6 space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Supplier Results</h3>
              <p className="text-sm text-slate-400 mt-1">
                {offers.length} suppliers found · sorted by USD price
                {job?.status === 'completed_with_errors' ? ' · best-effort results' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              {job && TERMINAL.has(job.status) && offers.length > 0 && (
                <>
                  <a
                    href={`/api/searches/${job.id}/export?format=csv`}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition"
                  >
                    CSV
                  </a>
                  <a
                    href={`/api/searches/${job.id}/export?format=xlsx`}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition"
                  >
                    Excel
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Supplier</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Country</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">MPN</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Price (USD)</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Stock</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Match</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-400 text-xs uppercase">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {offers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      {!job
                        ? 'Enter a product URL to discover suppliers'
                        : isRunning
                          ? 'Searching for suppliers…'
                          : 'No suppliers found'}
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-slate-700/30 transition">
                      <td className="px-3 py-3 text-slate-300 font-medium">
                        {offer.supplier.name || offer.supplier.domain}
                      </td>
                      <td className="px-3 py-3 text-slate-400">{offer.supplier.country || '—'}</td>
                      <td className="px-3 py-3 font-mono text-slate-300">{offer.mpn}</td>
                      <td className="px-3 py-3 text-slate-300">{offer.priceUsd || 'N/A'}</td>
                      <td className="px-3 py-3 text-slate-400">
                        {offer.stockQuantity ?? offer.availability ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-400">{offer.matchConfidence.toFixed(0)}%</td>
                      <td className="px-3 py-3">
                        <a
                          href={offer.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition font-medium"
                        >
                          Visit →
                        </a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

