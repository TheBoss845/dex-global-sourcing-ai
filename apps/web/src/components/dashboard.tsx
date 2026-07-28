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
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

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
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Sign-in failed');
      return;
    }
    setAuthed(true);
    setSignedInEmail(data.email ?? emailInput.trim().toLowerCase());
    setEmailInput('');
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
    setSignedInEmail(null);
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
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4">
        <p className="font-display text-sm tracking-[0.22em] text-dex-muted uppercase">DEX</p>
        <h1 className="font-display mt-2 text-3xl font-semibold text-dex-brand">
          Global Sourcing Assistant
        </h1>
        <p className="mt-3 text-sm text-dex-muted">
          Sign in with your work email address to continue.
        </p>
        <form onSubmit={(e) => void signIn(e)} className="mt-6 space-y-3">
          <label className="block text-sm font-medium" htmlFor="work-email">
            Work email
          </label>
          <input
            id="work-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className="w-full rounded-lg border border-dex-border bg-transparent px-3 py-2.5"
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
          <button type="submit" className="rounded-lg bg-dex-accent px-5 py-2.5 font-medium text-white">
            Sign in
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-8 md:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-dex-border pb-6">
        <div>
          <p className="font-display text-sm tracking-[0.22em] text-dex-muted uppercase">DEX</p>
          <h1 className="font-display mt-2 text-4xl font-semibold tracking-tight text-dex-brand md:text-5xl">
            Global Sourcing Assistant
          </h1>
          <p className="mt-3 max-w-2xl text-dex-muted">
            Paste a product-page link. We identify the manufacturer part number and run best-effort
            worldwide supplier discovery — about 10 useful options when available.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {signedInEmail ? (
            <div className="text-right text-sm">
              <p className="text-dex-muted">Signed in</p>
              <p className="font-medium text-dex-fg">{signedInEmail}</p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="mt-1 text-dex-accent underline"
              >
                Sign out
              </button>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      <form
        onSubmit={startSearch}
        className="mb-6 rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4 shadow-sm backdrop-blur md:p-5"
      >
        <label className="mb-2 block text-sm font-medium text-dex-fg" htmlFor="product-url">
          Product page URL
        </label>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            id="product-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.sparkfun.com/products/127"
            className="w-full rounded-lg border border-dex-border bg-transparent px-3 py-2.5 text-dex-fg outline-none ring-dex-accent focus:ring-2"
            required
            type="url"
            autoComplete="url"
            spellCheck={false}
          />
          <button
            type="submit"
            disabled={submitting || !url.trim() || isRunning}
            className="rounded-lg bg-dex-accent px-5 py-2.5 font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : isRunning ? 'Working…' : 'Find Suppliers'}
          </button>
          {isRunning ? (
            <button
              type="button"
              onClick={() => void cancelJob()}
              disabled={cancelling}
              className="rounded-lg border border-dex-border px-4 py-2.5 text-sm font-medium text-dex-fg transition hover:bg-dex-bg disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-dex-muted">
          Works best on public product pages that show a manufacturer part number (MPN). Bot-walled
          distributor pages may need a different source URL.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-dex-muted">
          <input
            type="checkbox"
            checked={forceRefresh}
            onChange={(e) => setForceRefresh(e.target.checked)}
          />
          Force refresh (ignore MPN cache)
        </label>
        {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      </form>

      {job ? (
        <section className="mb-6 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium">Progress</h2>
              <span className="rounded-full border border-dex-border px-3 py-1 text-xs uppercase tracking-wide text-dex-muted">
                {progressLabel}
              </span>
            </div>

            {(identifiedMpn || identifiedMfr) && job.resolveStatus === 'identified' ? (
              <div className="mt-4 rounded-lg border border-dex-border/80 bg-dex-bg/40 p-3">
                <p className="text-xs uppercase tracking-wide text-dex-muted">Identified part</p>
                <p className="mt-1 text-xl font-semibold text-dex-brand">
                  {identifiedMfr ? `${identifiedMfr} · ` : ''}
                  {identifiedMpn}
                </p>
                <p className="mt-1 text-sm text-dex-muted">
                  Confidence{' '}
                  {typeof job.identificationConfidence === 'number'
                    ? job.identificationConfidence.toFixed(2)
                    : '—'}
                  {job.finalSourceUrl || job.rawSourceUrl ? (
                    <>
                      {' '}
                      ·{' '}
                      <a
                        className="text-dex-accent underline"
                        href={job.finalSourceUrl || job.rawSourceUrl || undefined}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Original source
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            ) : isRunning ? (
              <p className="mt-4 text-sm text-dex-muted">
                Reading the product page and identifying the manufacturer part number…
              </p>
            ) : null}

            {job.summaryJson?.summary ? (
              <p className="mt-3 text-sm text-dex-fg">{job.summaryJson.summary}</p>
            ) : null}
            {job.errorMessage ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{job.errorMessage}</p>
            ) : null}

            <div className="mt-4 h-2 overflow-hidden rounded bg-dex-border/60">
              <div
                className="h-full bg-dex-accent transition-all duration-500"
                style={{ width: `${statusPercent(job.status)}%` }}
              />
            </div>
          </div>

          <div className="max-h-56 overflow-auto rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4">
            <h3 className="mb-2 text-sm font-medium text-dex-muted">Live events</h3>
            <ul className="space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="border-b border-dex-border/50 pb-2 last:border-0">
                  <span className="text-dex-muted">
                    {new Date(event.createdAt).toLocaleTimeString()} · {event.stage ?? '—'}
                  </span>
                  <div>{event.message}</div>
                </li>
              ))}
              {events.length === 0 ? (
                <li className="text-dex-muted">Waiting for worker events…</li>
              ) : null}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-medium">Supplier results</h2>
            <p className="text-sm text-dex-muted">
              {offers.length} shown · sorted by USD price (unpriced last)
              {job?.status === 'completed_with_errors'
                ? ' · some candidates failed (best-effort)'
                : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter table…"
              className="rounded-md border border-dex-border bg-transparent px-3 py-1.5 text-sm"
              aria-label="Filter supplier results"
            />
            {job && TERMINAL.has(job.status) && offers.length > 0 ? (
              <>
                <a
                  className="rounded-md border border-dex-border px-3 py-1.5 text-sm hover:bg-dex-bg"
                  href={`/api/searches/${job.id}/export?format=csv`}
                >
                  Export CSV
                </a>
                <a
                  className="rounded-md border border-dex-border px-3 py-1.5 text-sm hover:bg-dex-bg"
                  href={`/api/searches/${job.id}/export?format=xlsx`}
                >
                  Export Excel
                </a>
              </>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-dex-border text-dex-muted">
              <tr>
                <th className="px-2 py-2">Supplier</th>
                <th className="px-2 py-2">Country</th>
                <th className="px-2 py-2">Manufacturer</th>
                <th className="px-2 py-2">MPN</th>
                <th className="px-2 py-2">Supplier P/N</th>
                <th className="px-2 py-2">Price</th>
                <th className="px-2 py-2">Currency</th>
                <th className="px-2 py-2">USD</th>
                <th className="px-2 py-2">Stock</th>
                <th className="px-2 py-2">MOQ</th>
                <th className="px-2 py-2">Lead</th>
                <th className="px-2 py-2">Match</th>
                <th className="px-2 py-2">Reliability</th>
                <th className="px-2 py-2">Verified</th>
                <th className="px-2 py-2">Link</th>
                <th className="px-2 py-2">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id} className="border-b border-dex-border/60 align-top">
                  <td className="px-2 py-2">{offer.supplier.name ?? offer.supplier.domain}</td>
                  <td className="px-2 py-2">{offer.supplier.country ?? '—'}</td>
                  <td className="px-2 py-2">{offer.manufacturer ?? '—'}</td>
                  <td className="px-2 py-2 font-medium">{offer.mpn}</td>
                  <td className="px-2 py-2">{offer.supplierPartNumber ?? '—'}</td>
                  <td className="px-2 py-2">{offer.price ?? 'Price unavailable'}</td>
                  <td className="px-2 py-2">{offer.currency ?? '—'}</td>
                  <td className="px-2 py-2">{offer.priceUsd ?? 'Price unavailable'}</td>
                  <td className="px-2 py-2">
                    {offer.stockQuantity ?? offer.availability ?? 'Stock unknown'}
                  </td>
                  <td className="px-2 py-2">{offer.moq ?? '—'}</td>
                  <td className="px-2 py-2">{offer.leadTime ?? 'Lead time unavailable'}</td>
                  <td className="px-2 py-2">{offer.matchConfidence.toFixed(2)}</td>
                  <td className="px-2 py-2">
                    {offer.reliabilityScore != null ? offer.reliabilityScore.toFixed(2) : '—'}
                  </td>
                  <td className="px-2 py-2">{new Date(offer.extractedAt).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <a
                      className="text-dex-accent underline"
                      href={offer.productUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  </td>
                  <td className="px-2 py-2 text-dex-warn">
                    {offer.riskFlags?.length ? offer.riskFlags.join(', ') : '—'}
                  </td>
                </tr>
              ))}
              {offers.length === 0 ? (
                <tr>
                  <td className="px-2 py-6 text-dex-muted" colSpan={16}>
                    {!job
                      ? 'Paste a product-page URL and click Find Suppliers.'
                      : isRunning
                        ? 'No supplier rows yet — the pipeline is still working…'
                        : job.status === 'failed'
                          ? 'No suppliers found. Try another product URL with a clear manufacturer part number.'
                          : 'No matching supplier offers for this MPN.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function statusPercent(status: string): number {
  const map: Record<string, number> = {
    queued: 3,
    validating: 8,
    fetching_source: 15,
    extracting_identity: 22,
    identifying_mpn: 30,
    discovering: 42,
    extracting: 60,
    normalizing: 78,
    enriching: 90,
    completed: 100,
    completed_with_errors: 100,
    failed: 100,
    cancelled: 100,
  };
  return map[status] ?? 10;
}
