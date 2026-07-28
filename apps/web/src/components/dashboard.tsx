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

const PIPELINE_STEPS = [
  { key: 'read', label: 'Read page', statuses: ['queued', 'validating', 'fetching_source'] },
  { key: 'identify', label: 'Identify part', statuses: ['extracting_identity', 'identifying_mpn'] },
  { key: 'discover', label: 'Find suppliers', statuses: ['discovering'] },
  { key: 'extract', label: 'Extract offers', statuses: ['extracting', 'normalizing'] },
  { key: 'finish', label: 'Rank & finish', statuses: ['enriching'] },
] as const;

function DexLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="dexlg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d5bd8" />
          <stop offset="1" stopColor="#0a1f33" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#dexlg)" />
      <path
        d="M20 18h12c8.8 0 15 6 15 14s-6.2 14-15 14H20V18zm7 6.5v15h5c4.9 0 8-3 8-7.5s-3.1-7.5-8-7.5h-5z"
        fill="#fff"
      />
      <circle cx="47" cy="19" r="4" fill="#43c384" />
    </svg>
  );
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll('_', ' ');
  const style =
    status === 'completed'
      ? 'bg-dex-ok-soft text-dex-ok border-transparent'
      : status === 'completed_with_errors'
        ? 'bg-dex-warn-soft text-dex-warn border-transparent'
        : status === 'failed' || status === 'cancelled'
          ? 'bg-dex-danger-soft text-dex-danger border-transparent'
          : 'bg-dex-accent-soft text-dex-accent border-transparent';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase ${style}`}
    >
      {!TERMINAL.has(status) ? <span className="dex-pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}

function MatchBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const style =
    value >= 0.8
      ? 'bg-dex-ok-soft text-dex-ok'
      : value >= 0.6
        ? 'bg-dex-warn-soft text-dex-warn'
        : 'bg-dex-bg text-dex-muted';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {pct}%
    </span>
  );
}

function stepState(status: string): { index: number; done: boolean } {
  if (status === 'completed' || status === 'completed_with_errors') {
    return { index: PIPELINE_STEPS.length - 1, done: true };
  }
  const idx = PIPELINE_STEPS.findIndex((step) => (step.statuses as readonly string[]).includes(status));
  return { index: idx === -1 ? 0 : idx, done: false };
}

function StageStepper({ status }: { status: string }) {
  const { index: active, done } = stepState(status);
  const failed = status === 'failed' || status === 'cancelled';
  return (
    <ol className="mt-5 flex items-center gap-1">
      {PIPELINE_STEPS.map((step, i) => {
        const complete = done || i < active;
        const current = !done && i === active && !failed;
        return (
          <li key={step.key} className="flex flex-1 flex-col gap-1.5">
            <span
              className={`h-1.5 w-full rounded-full transition-colors duration-500 ${
                complete
                  ? 'bg-dex-ok'
                  : current
                    ? 'dex-progress-active bg-dex-accent'
                    : failed && i === active
                      ? 'bg-dex-danger'
                      : 'bg-dex-border'
              }`}
            />
            <span
              className={`hidden text-[11px] font-medium sm:block ${
                complete || current ? 'text-dex-fg' : 'text-dex-muted'
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dex-border bg-dex-bg-elevated p-4 shadow-card">
      <p className="text-xs font-medium tracking-wide text-dex-muted uppercase">{label}</p>
      <p className="font-display mt-1.5 text-2xl font-semibold text-dex-brand">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-dex-muted">{hint}</p> : null}
    </div>
  );
}

function fmtUsd(value: string | null): string | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

type BatchJobRow = {
  id: string;
  mpn: string;
  description: string | null;
  status: string;
  offerCount: number;
  bestUsd?: number | null;
  errorMessage?: string | null;
};

export function Dashboard() {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [url, setUrl] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [batchText, setBatchText] = useState('');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchJobs, setBatchJobs] = useState<BatchJobRow[]>([]);
  const [batchStarting, setBatchStarting] = useState(false);
  const [parsedItems, setParsedItems] = useState<
    Array<{ mpn: string; description?: string; manufacturer?: string }> | null
  >(null);
  const [parseMethod, setParseMethod] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
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
  const [verificationSent, setVerificationSent] = useState(false);
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);

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

  async function signIn(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setDevVerifyUrl(null);
    setSendingLink(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: emailInput.trim() }),
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
        setError(`Sign-in failed (HTTP ${res.status}).`);
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
      setCodeInput('');
      const link = data.verifyUrl ?? data.devVerifyUrl;
      if (typeof link === 'string') {
        setDevVerifyUrl(link);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSendingLink(false);
    }
  }

  async function submitCode(code: string) {
    if (code.length !== 6 || verifyingCode) return;
    setVerifyingCode(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: emailInput.trim(), code }),
      });
      const data = (await res.json()) as { error?: string; signedIn?: boolean; email?: string };
      if (!res.ok) {
        setError(data.error ?? 'Verification failed');
        setCodeInput('');
        return;
      }
      if (data.signedIn) {
        setAuthed(true);
        setSignedInEmail(data.email ?? emailInput.trim().toLowerCase());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifyingCode(false);
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

  async function parseBatchText(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!batchText.trim()) {
      setError('Paste your parts list first — straight from SupplyItNow, a spreadsheet, or one part per line.');
      return;
    }
    setParsing(true);
    try {
      const res = await fetch('/api/batches/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: batchText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not read that parts list');
      setParsedItems(data.items ?? []);
      setParseMethod(data.method ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that parts list');
    } finally {
      setParsing(false);
    }
  }

  async function startBatch() {
    if (!parsedItems || parsedItems.length === 0) return;
    setError(null);
    setBatchStarting(true);
    setBatchJobs([]);
    setBatchId(null);
    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ items: parsedItems, forceRefresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to start the report');
      setBatchId(data.batchId);
      setParsedItems(null);
      setParseMethod(null);
      setBatchJobs(
        (data.jobs as Array<{ id: string; mpn: string; status: string }>).map((j) => ({
          ...j,
          description: null,
          offerCount: 0,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the report');
    } finally {
      setBatchStarting(false);
    }
  }

  const batchDone = batchJobs.length > 0 && batchJobs.every((j) => TERMINAL.has(j.status));

  useEffect(() => {
    if (!batchId || batchJobs.length === 0 || batchDone) return;
    let cancelled = false;

    async function pollBatch() {
      // Serverless mode: advance up to two running parts per cycle.
      const active = batchJobs.filter((j) => !TERMINAL.has(j.status)).slice(0, 2);
      for (const item of active) {
        if (cancelled) return;
        await fetch(`/api/searches/${item.id}/tick`, { method: 'POST' }).catch(() => undefined);
      }
      if (cancelled) return;
      const res = await fetch(`/api/batches/${batchId}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      // Only trigger a re-render when something actually changed.
      setBatchJobs((prev) => {
        const next = (data.jobs ?? []) as BatchJobRow[];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    }

    void pollBatch();
    const handle = setInterval(() => void pollBatch(), 2500);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [batchId, batchDone, batchJobs]);

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
      // Serverless deployments (no background worker) advance the pipeline here;
      // on worker-backed deployments this returns immediately as a no-op.
      if (job && !TERMINAL.has(job.status)) {
        await fetch(`/api/searches/${job.id}/tick`, { method: 'POST' }).catch(() => undefined);
      }
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

  const identifiedMpn = job?.part?.originalMpn || job?.part?.rawMpn || job?.summaryJson?.mpn;
  const identifiedMfr = job?.part?.manufacturer || job?.summaryJson?.manufacturer;
  const isRunning = Boolean(job && !TERMINAL.has(job.status));

  const stats = useMemo(() => {
    const priced = offers
      .map((offer) => Number(offer.priceUsd))
      .filter((num) => Number.isFinite(num) && num > 0)
      .sort((a, b) => a - b);
    const countries = new Set(
      offers.map((offer) => offer.supplier.country).filter((c): c is string => Boolean(c)),
    );
    const suppliers = new Set(offers.map((offer) => offer.supplier.domain));
    return {
      offerCount: offers.length,
      lowestUsd: priced.length
        ? priced[0]!.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : '—',
      supplierCount: suppliers.size,
      countryCount: countries.size,
    };
  }, [offers]);

  const bestPriceOfferId = useMemo(() => {
    let best: { id: string; usd: number } | null = null;
    for (const offer of offers) {
      const usd = Number(offer.priceUsd);
      if (Number.isFinite(usd) && usd > 0 && (!best || usd < best.usd)) {
        best = { id: offer.id, usd };
      }
    }
    return best?.id ?? null;
  }, [offers]);

  if (authChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-dex-muted">
          <Spinner />
          <span>Loading DEX Sourcing…</span>
        </div>
      </main>
    );
  }

  /* ---------------------------- Sign-in screen ---------------------------- */
  if (authRequired && !authed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="dex-fade-up w-full max-w-md">
          <div className="rounded-2xl border border-dex-border bg-dex-bg-elevated p-8 shadow-card-lg">
            <div className="flex items-center gap-3">
              <DexLogo size={44} />
              <div>
                <p className="font-display text-xs font-semibold tracking-[0.22em] text-dex-muted uppercase">
                  Data Exchange Corporation
                </p>
                <h1 className="font-display text-xl font-semibold text-dex-brand">
                  Global Sourcing Assistant
                </h1>
              </div>
            </div>

            <p className="mt-5 text-sm leading-relaxed text-dex-muted">
              Identify any part from a product link and compare vetted suppliers worldwide —
              prices, stock, and lead times in one view.
            </p>

            {verificationSent ? (
              <div className="mt-6 rounded-xl border border-dex-border bg-dex-bg p-5">
                <p className="font-medium text-dex-fg">Check your email</p>
                <p className="mt-1.5 text-sm text-dex-muted">
                  We sent a 6-digit code to{' '}
                  <span className="font-medium text-dex-fg">{emailInput}</span>. Enter it here, or
                  click the button in the email.
                </p>
                <input
                  value={codeInput}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCodeInput(digits);
                    if (digits.length === 6) void submitCode(digits);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  aria-label="6-digit verification code"
                  autoFocus
                  disabled={verifyingCode}
                  className="mt-4 w-full rounded-xl border border-dex-border bg-dex-bg-elevated px-4 py-3 text-center font-mono text-2xl font-semibold tracking-[0.6em] text-dex-fg outline-none transition focus:border-dex-accent focus:ring-2 focus:ring-dex-accent/25 disabled:opacity-60"
                />
                {verifyingCode ? (
                  <p className="mt-3 flex items-center justify-center gap-2 text-sm text-dex-muted">
                    <Spinner className="text-dex-accent" /> Verifying…
                  </p>
                ) : null}
                {devVerifyUrl ? (
                  <a
                    className="mt-3 block text-center text-sm text-dex-accent hover:underline"
                    href={devVerifyUrl}
                  >
                    Local dev: sign in with one click
                  </a>
                ) : null}
                <div className="mt-4 flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="text-dex-accent hover:underline"
                    disabled={sendingLink}
                    onClick={() => {
                      setCodeInput('');
                      void signIn();
                    }}
                  >
                    {sendingLink ? 'Sending…' : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="text-dex-muted hover:text-dex-fg hover:underline"
                    onClick={() => {
                      setVerificationSent(false);
                      setDevVerifyUrl(null);
                      setCodeInput('');
                      setError(null);
                    }}
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={(e) => void signIn(e)} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium" htmlFor="work-email">
                    Work email
                  </label>
                  <input
                    id="work-email"
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full rounded-lg border border-dex-border bg-transparent px-3.5 py-2.5 text-dex-fg outline-none transition focus:border-dex-accent focus:ring-2 focus:ring-dex-accent/25"
                    placeholder="you@dex.com"
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={sendingLink}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-dex-accent px-5 py-2.5 font-medium text-white shadow-card transition hover:brightness-110 disabled:opacity-60"
                >
                  {sendingLink ? <Spinner /> : null}
                  {sendingLink ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {error ? (
              <p className="mt-4 rounded-lg bg-dex-danger-soft px-3 py-2 text-sm text-dex-danger">
                {error}
              </p>
            ) : null}

            <p className="mt-6 border-t border-dex-border pt-4 text-xs text-dex-muted">
              Access is limited to Data Exchange Corporation team accounts.
            </p>
          </div>
          <p className="mt-4 text-center text-xs text-dex-muted">
            DEX · Data Exchange Corporation · procurement intelligence
          </p>
        </div>
      </main>
    );
  }

  /* ------------------------------- Dashboard ------------------------------ */
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-dex-border bg-dex-bg-elevated/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <DexLogo />
            <div className="leading-tight">
              <p className="font-display text-[10px] font-semibold tracking-[0.22em] text-dex-muted uppercase">
                Data Exchange Corporation
              </p>
              <p className="font-display text-sm font-semibold text-dex-brand">
                Global Sourcing Assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {signedInEmail ? (
              <div className="hidden items-center gap-2 rounded-full border border-dex-border bg-dex-bg px-3 py-1.5 sm:flex">
                <span className="h-2 w-2 rounded-full bg-dex-ok" />
                <span className="max-w-[220px] truncate text-xs font-medium text-dex-fg">
                  {signedInEmail}
                </span>
              </div>
            ) : null}
            <ThemeToggle />
            {signedInEmail ? (
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-lg border border-dex-border px-3 py-1.5 text-sm font-medium text-dex-muted transition hover:text-dex-fg"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">
        {/* Hero + search */}
        <section className="dex-fade-up">
          {!job && !batchId ? (
            <div className="mb-6 max-w-3xl">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-dex-brand md:text-[2.6rem] md:leading-[1.15]">
                Source any part, worldwide,
                <br className="hidden md:block" /> in one report.
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-dex-muted">
                Paste a parts list or a product link. DEX finds up to 10 vendors per part —
                with prices, stock, and lead times — and builds one downloadable report.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {[
                  ['1', 'Paste your parts — any format'],
                  ['2', 'AI verifies real vendors worldwide'],
                  ['3', 'Download one Excel report'],
                ].map(([step, label]) => (
                  <div
                    key={step}
                    className="flex items-center gap-2 rounded-full border border-dex-border bg-dex-bg-elevated px-3.5 py-1.5 text-xs font-medium text-dex-fg shadow-card"
                  >
                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-dex-accent text-[10px] font-bold text-white">
                      {step}
                    </span>
                    {label}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mb-4 inline-flex rounded-xl border border-dex-border bg-dex-bg-elevated p-1 shadow-card">
            <button
              type="button"
              onClick={() => {
                setMode('batch');
                setError(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                mode === 'batch' ? 'bg-dex-accent text-white' : 'text-dex-muted hover:text-dex-fg'
              }`}
            >
              Parts list report
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('single');
                setError(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                mode === 'single' ? 'bg-dex-accent text-white' : 'text-dex-muted hover:text-dex-fg'
              }`}
            >
              Single product link
            </button>
          </div>

          {mode === 'batch' && !parsedItems ? (
            <form
              onSubmit={(e) => void parseBatchText(e)}
              className="rounded-2xl border border-dex-border bg-dex-bg-elevated p-5 shadow-card md:p-6"
            >
              <label className="mb-2 block text-sm font-semibold text-dex-fg" htmlFor="parts-list">
                Paste your parts list — any format
              </label>
              <p className="mb-3 text-xs text-dex-muted">
                Copy rows straight from SupplyItNow, a spreadsheet, or an email — or type one part
                per line like <span className="font-mono">LM7805CT, 5V regulator</span>. DEX figures
                out the part numbers, descriptions, and manufacturers automatically.
              </p>
              <textarea
                id="parts-list"
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                rows={8}
                placeholder={'Paste anything here, e.g. rows copied from supplyitnow.com:\n\nAbb\tRenewable\t29088391\tCIRCUIT BREAKER, 0.63-1A, MS325-1.0\t1\t$Best Offer…\nDell\tInformation Technology\tMYHV5\tASSY,BZL,FRT,5860T\t1\t$Best Offer…'}
                className="w-full rounded-xl border border-dex-border bg-transparent px-4 py-3 font-mono text-xs text-dex-fg outline-none transition focus:border-dex-accent focus:ring-2 focus:ring-dex-accent/25"
                spellCheck={false}
              />
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-dex-muted">
                  Up to 50 parts per report. Each part gets up to 10 vendors with prices.
                </p>
                <button
                  type="submit"
                  disabled={parsing || !batchText.trim() || (batchJobs.length > 0 && !batchDone)}
                  className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-dex-accent px-6 py-3 font-semibold text-white shadow-card transition hover:brightness-110 disabled:opacity-50"
                >
                  {parsing || (batchJobs.length > 0 && !batchDone) ? <Spinner /> : null}
                  {parsing
                    ? 'Reading…'
                    : batchJobs.length > 0 && !batchDone
                      ? 'Building report…'
                      : 'Read parts list'}
                </button>
              </div>
              {error ? (
                <p className="mt-3 rounded-lg bg-dex-danger-soft px-3 py-2 text-sm text-dex-danger">
                  {error}
                </p>
              ) : null}
            </form>
          ) : null}

          {mode === 'batch' && parsedItems ? (
            <div className="rounded-2xl border border-dex-border bg-dex-bg-elevated shadow-card">
              <div className="flex flex-col gap-3 border-b border-dex-border p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold text-dex-brand">
                    Found {parsedItems.length} part{parsedItems.length === 1 ? '' : 's'}
                  </h2>
                  <p className="mt-0.5 text-sm text-dex-muted">
                    {parseMethod === 'ai'
                      ? 'AI cleaned up your paste — check the list, then run the report.'
                      : 'Check the list, then run the report.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParsedItems(null);
                      setParseMethod(null);
                    }}
                    className="rounded-lg border border-dex-border px-4 py-2 text-sm font-medium text-dex-fg transition hover:bg-dex-bg"
                  >
                    Back to edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void startBatch()}
                    disabled={batchStarting || parsedItems.length === 0}
                    className="flex items-center gap-2 rounded-lg bg-dex-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {batchStarting ? <Spinner /> : null}
                    {batchStarting ? 'Starting…' : `Run report (${parsedItems.length})`}
                  </button>
                </div>
              </div>
              <div className="dex-scroll max-h-72 overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold tracking-wide text-dex-muted uppercase">
                      <th className="px-5 py-2.5">Part number</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5">Manufacturer</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {parsedItems.map((item, index) => (
                      <tr key={`${item.mpn}-${index}`} className="border-t border-dex-border/70">
                        <td className="px-5 py-2.5 font-medium text-dex-fg">{item.mpn}</td>
                        <td className="max-w-[320px] truncate px-4 py-2.5 text-dex-muted">
                          {item.description ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-dex-muted">{item.manufacturer ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Remove ${item.mpn}`}
                            onClick={() =>
                              setParsedItems((prev) => prev?.filter((_, i) => i !== index) ?? null)
                            }
                            className="text-xs font-semibold text-dex-muted transition hover:text-dex-danger"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {error ? (
                <p className="m-4 rounded-lg bg-dex-danger-soft px-3 py-2 text-sm text-dex-danger">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === 'batch' && batchJobs.length > 0 ? (
            <div className="dex-fade-up mt-6 rounded-2xl border border-dex-border bg-dex-bg-elevated shadow-card">
              <div className="flex flex-col gap-3 border-b border-dex-border p-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold text-dex-brand">
                    Vendor report · {batchJobs.length} part{batchJobs.length === 1 ? '' : 's'}
                  </h2>
                  <p className="mt-0.5 text-sm text-dex-muted">
                    {batchDone
                      ? `Finished — ${batchJobs.reduce((sum, j) => sum + j.offerCount, 0)} vendor offers found. Download the report below.`
                      : `Searching worldwide… ${batchJobs.filter((j) => TERMINAL.has(j.status)).length} of ${batchJobs.length} parts done. Keep this page open.`}
                  </p>
                  <div className="mt-3 h-1.5 max-w-md overflow-hidden rounded-full bg-dex-border/60">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${batchDone ? 'bg-dex-ok' : 'dex-progress-active bg-dex-accent'}`}
                      style={{
                        width: `${Math.max(4, Math.round((batchJobs.filter((j) => TERMINAL.has(j.status)).length / batchJobs.length) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
                {batchDone && batchId ? (
                  <div className="flex shrink-0 gap-2">
                    <a
                      className="rounded-lg bg-dex-accent px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:brightness-110"
                      href={`/api/batches/${batchId}/export?format=xlsx`}
                    >
                      ↓ Excel report
                    </a>
                    <a
                      className="rounded-lg border border-dex-border px-4 py-2 text-sm font-medium text-dex-fg transition hover:bg-dex-bg"
                      href={`/api/batches/${batchId}/export?format=csv`}
                    >
                      ↓ CSV
                    </a>
                  </div>
                ) : null}
              </div>
              <div className="dex-scroll overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-[11px] font-semibold tracking-wide text-dex-muted uppercase">
                      <th className="px-5 py-3">Part number</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Vendors</th>
                      <th className="px-4 py-3">Best price</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {batchJobs.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-dex-border/70 transition-colors hover:bg-dex-bg/60"
                      >
                        <td className="px-5 py-3 font-medium text-dex-fg">{item.mpn}</td>
                        <td className="max-w-[260px] truncate px-4 py-3 text-dex-muted">
                          {item.description ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3">
                          {item.offerCount > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-dex-ok-soft px-2.5 py-0.5 text-xs font-semibold text-dex-ok">
                              {item.offerCount}
                            </span>
                          ) : TERMINAL.has(item.status) ? (
                            <span className="text-dex-muted">0</span>
                          ) : (
                            <Spinner className="text-dex-accent" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-dex-fg">
                          {item.bestUsd != null
                            ? item.bestUsd.toLocaleString('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              })
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {TERMINAL.has(item.status) && item.offerCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setMode('single');
                                setJob({
                                  id: item.id,
                                  status: item.status,
                                  inputValue: item.mpn,
                                  offerCount: item.offerCount,
                                } as SearchJob);
                              }}
                              className="rounded-lg border border-dex-border px-3 py-1.5 text-xs font-semibold text-dex-accent transition hover:bg-dex-accent-soft"
                            >
                              View vendors
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <form
            onSubmit={startSearch}
            className={`rounded-2xl border border-dex-border bg-dex-bg-elevated p-5 shadow-card md:p-6 ${mode === 'single' ? '' : 'hidden'}`}
          >
            <label className="mb-2 block text-sm font-semibold text-dex-fg" htmlFor="product-url">
              Product page URL
            </label>
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                id="product-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.sparkfun.com/products/127"
                className="w-full rounded-xl border border-dex-border bg-transparent px-4 py-3 text-[15px] text-dex-fg outline-none transition focus:border-dex-accent focus:ring-2 focus:ring-dex-accent/25"
                required
                type="url"
                autoComplete="url"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={submitting || !url.trim() || isRunning}
                className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-dex-accent px-6 py-3 font-semibold text-white shadow-card transition hover:brightness-110 disabled:opacity-50"
              >
                {submitting || isRunning ? <Spinner /> : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                )}
                {submitting ? 'Starting…' : isRunning ? 'Working…' : 'Find suppliers'}
              </button>
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => void cancelJob()}
                  disabled={cancelling}
                  className="rounded-xl border border-dex-border px-4 py-3 text-sm font-medium text-dex-fg transition hover:bg-dex-bg disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-col gap-2 text-xs text-dex-muted md:flex-row md:items-center md:justify-between">
              <p>
                Works best on public product pages showing a manufacturer part number (MPN).
              </p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={forceRefresh}
                  onChange={(e) => setForceRefresh(e.target.checked)}
                  className="accent-[var(--dex-accent)]"
                />
                Force refresh (skip cache)
              </label>
            </div>
            {!job ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dex-border pt-4">
                <span className="text-xs font-medium text-dex-muted">Try an example:</span>
                {[
                  {
                    label: 'Raspberry Pi Zero',
                    href: 'https://www.adafruit.com/product/2885',
                  },
                  {
                    label: 'Adafruit Feather M4',
                    href: 'https://www.adafruit.com/product/3857',
                  },
                  {
                    label: 'SparkFun Qwiic Cable',
                    href: 'https://www.sparkfun.com/flexible-qwiic-cable-100mm.html',
                  },
                ].map((example) => (
                  <button
                    key={example.href}
                    type="button"
                    onClick={() => setUrl(example.href)}
                    className="rounded-full border border-dex-border bg-dex-bg px-3 py-1.5 text-xs font-medium text-dex-fg transition hover:border-dex-accent hover:text-dex-accent"
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            ) : null}
            {error ? (
              <p className="mt-3 rounded-lg bg-dex-danger-soft px-3 py-2 text-sm text-dex-danger">
                {error}
              </p>
            ) : null}
          </form>
        </section>

        {/* Progress */}
        {mode === 'single' && job ? (
          <section className="dex-fade-up mt-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-2xl border border-dex-border bg-dex-bg-elevated p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-dex-brand">Pipeline</h2>
                <StatusBadge status={job.status} />
              </div>

              <StageStepper status={job.status} />

              {(identifiedMpn || identifiedMfr) && job.resolveStatus === 'identified' ? (
                <div className="mt-5 rounded-xl border border-dex-border bg-dex-bg p-4">
                  <p className="text-[11px] font-semibold tracking-wide text-dex-muted uppercase">
                    Identified part
                  </p>
                  <p className="font-display mt-1 text-2xl font-semibold text-dex-brand">
                    {identifiedMfr ? `${identifiedMfr} · ` : ''}
                    {identifiedMpn}
                  </p>
                  <p className="mt-1.5 text-sm text-dex-muted">
                    Confidence{' '}
                    <span className="font-medium text-dex-fg">
                      {typeof job.identificationConfidence === 'number'
                        ? `${Math.round(job.identificationConfidence * 100)}%`
                        : '—'}
                    </span>
                    {job.finalSourceUrl || job.rawSourceUrl ? (
                      <>
                        {' · '}
                        <a
                          className="text-dex-accent hover:underline"
                          href={job.finalSourceUrl || job.rawSourceUrl || undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View source page ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                  {job.part?.descriptionClean &&
                  job.part.descriptionClean !== job.part.title ? (
                    <p className="mt-2.5 border-t border-dex-border/60 pt-2.5 text-sm leading-relaxed text-dex-fg">
                      {job.part.descriptionClean}
                    </p>
                  ) : null}
                </div>
              ) : isRunning ? (
                <p className="mt-5 flex items-center gap-2 text-sm text-dex-muted">
                  <Spinner className="text-dex-accent" />
                  Reading the product page and identifying the exact part number…
                </p>
              ) : null}

              {job.summaryJson?.summary ? (
                <p className="mt-4 text-sm leading-relaxed text-dex-fg">{job.summaryJson.summary}</p>
              ) : null}
              {job.errorMessage ? (
                <p className="mt-4 rounded-lg bg-dex-danger-soft px-3 py-2 text-sm text-dex-danger">
                  {job.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-dex-border bg-dex-bg-elevated p-5 shadow-card">
              <h3 className="font-display mb-3 text-sm font-semibold text-dex-brand">
                Activity log
              </h3>
              <ul className="dex-scroll max-h-52 space-y-2.5 overflow-auto pr-1 text-sm">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-dex-accent/70" />
                    <div className="min-w-0">
                      <p className="text-dex-fg">{event.message}</p>
                      <p className="text-[11px] text-dex-muted">
                        {new Date(event.createdAt).toLocaleTimeString()}
                        {event.stage ? ` · ${event.stage}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
                {events.length === 0 ? (
                  <li className="flex items-center gap-2 text-dex-muted">
                    <Spinner />
                    Waiting for worker events…
                  </li>
                ) : null}
              </ul>
            </div>
          </section>
        ) : null}

        {/* Stats */}
        {mode === 'single' && job && offers.length > 0 ? (
          <section className="dex-fade-up mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Supplier offers" value={String(stats.offerCount)} />
            <StatCard label="Lowest price" value={stats.lowestUsd} hint="USD, best-effort" />
            <StatCard label="Suppliers" value={String(stats.supplierCount)} />
            <StatCard label="Countries" value={String(stats.countryCount)} />
          </section>
        ) : null}

        {/* Results */}
        <section
          className={`dex-fade-up mt-6 rounded-2xl border border-dex-border bg-dex-bg-elevated shadow-card ${mode === 'single' ? '' : 'hidden'}`}
        >
          <div className="flex flex-col gap-3 border-b border-dex-border p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-dex-brand">
                Supplier results
              </h2>
              <p className="mt-0.5 text-sm text-dex-muted">
                Sorted by USD price, best match first
                {job?.status === 'completed_with_errors' ? ' · some sources failed (best-effort)' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter results…"
                className="rounded-lg border border-dex-border bg-transparent px-3 py-2 text-sm outline-none transition focus:border-dex-accent focus:ring-2 focus:ring-dex-accent/25"
                aria-label="Filter supplier results"
              />
              {job && TERMINAL.has(job.status) && offers.length > 0 ? (
                <>
                  <a
                    className="rounded-lg border border-dex-border px-3.5 py-2 text-sm font-medium text-dex-fg transition hover:bg-dex-bg"
                    href={`/api/searches/${job.id}/export?format=csv`}
                  >
                    ↓ CSV
                  </a>
                  <a
                    className="rounded-lg border border-dex-border px-3.5 py-2 text-sm font-medium text-dex-fg transition hover:bg-dex-bg"
                    href={`/api/searches/${job.id}/export?format=xlsx`}
                  >
                    ↓ Excel
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <div className="dex-scroll overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold tracking-wide text-dex-muted uppercase">
                  <th className="px-5 py-3">Supplier</th>
                  <th className="px-4 py-3">Part</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Stock / MOQ</th>
                  <th className="px-4 py-3">Lead time</th>
                  <th className="px-4 py-3">Match</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => {
                  const usd = fmtUsd(offer.priceUsd);
                  const isBest = offer.id === bestPriceOfferId;
                  return (
                    <tr
                      key={offer.id}
                      className="border-t border-dex-border/70 align-top transition-colors hover:bg-dex-bg/60"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(offer.supplier.domain)}&sz=32`}
                            alt=""
                            width={18}
                            height={18}
                            className="rounded"
                            loading="lazy"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-dex-fg">
                              {offer.supplier.name ?? offer.supplier.domain}
                            </p>
                            <p className="text-xs text-dex-muted">
                              {offer.supplier.country ?? offer.supplier.domain}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-dex-fg">{offer.mpn}</p>
                        <p className="text-xs text-dex-muted">
                          {offer.manufacturer ?? '—'}
                          {offer.supplierPartNumber ? ` · SKU ${offer.supplierPartNumber}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        {usd ? (
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-dex-fg">{usd}</span>
                            {isBest ? (
                              <span className="rounded-full bg-dex-ok-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-dex-ok uppercase">
                                Best
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-dex-muted">On request</span>
                        )}
                        {offer.price && offer.currency && offer.currency !== 'USD' ? (
                          <p className="text-xs text-dex-muted">
                            {offer.price} {offer.currency}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-dex-fg">
                          {offer.stockQuantity != null
                            ? offer.stockQuantity.toLocaleString()
                            : (offer.availability ?? '—')}
                        </p>
                        <p className="text-xs text-dex-muted">
                          MOQ {offer.moq != null ? offer.moq.toLocaleString() : '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-dex-fg">{offer.leadTime ?? '—'}</td>
                      <td className="px-4 py-3.5">
                        <MatchBadge value={offer.matchConfidence} />
                      </td>
                      <td className="max-w-[180px] px-4 py-3.5">
                        {offer.riskFlags?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {offer.riskFlags.map((flag) => (
                              <span
                                key={flag}
                                className="rounded-full bg-dex-warn-soft px-2 py-0.5 text-[11px] font-medium text-dex-warn"
                              >
                                {flag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-dex-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <a
                          className="inline-flex items-center gap-1 rounded-lg border border-dex-border px-3 py-1.5 text-xs font-semibold text-dex-accent transition hover:bg-dex-accent-soft"
                          href={offer.productUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
                {offers.length === 0 ? (
                  <tr className="border-t border-dex-border/70">
                    <td className="px-5 py-14 text-center" colSpan={8}>
                      {!job ? (
                        <div className="mx-auto max-w-sm">
                          <p className="font-display text-base font-semibold text-dex-brand">
                            Ready when you are
                          </p>
                          <p className="mt-1.5 text-sm text-dex-muted">
                            Paste a product-page URL above and DEX will find suppliers for the
                            exact part, worldwide.
                          </p>
                        </div>
                      ) : isRunning ? (
                        <div className="flex items-center justify-center gap-2 text-dex-muted">
                          <Spinner className="text-dex-accent" />
                          Searching global suppliers…
                        </div>
                      ) : job.status === 'failed' ? (
                        <p className="text-sm text-dex-muted">
                          No suppliers found. Try a product URL that clearly shows a manufacturer
                          part number.
                        </p>
                      ) : (
                        <p className="text-sm text-dex-muted">
                          No matching supplier offers for this part.
                        </p>
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="border-t border-dex-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-dex-muted sm:flex-row md:px-8">
          <p>© {new Date().getFullYear()} Data Exchange Corporation (DEX) · Global Sourcing Assistant</p>
          <p>Procurement intelligence for the DEX team</p>
        </div>
      </footer>
    </div>
  );
}
