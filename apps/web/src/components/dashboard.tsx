'use client';

import { useEffect, useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

type SearchJob = {
  id: string;
  status: string;
  inputType: string;
  inputValue: string;
  offerCount: number;
  summaryJson?: { summary?: string } | null;
  part?: {
    rawMpn: string;
    normalizedMpn: string;
    manufacturer?: string | null;
    descriptionClean?: string | null;
  } | null;
  errorMessage?: string | null;
};

type OfferRow = {
  id: string;
  mpn: string;
  manufacturer: string | null;
  productUrl: string;
  price: string | null;
  currency: string | null;
  priceUsd: string | null;
  stockQuantity: number | null;
  leadTime: string | null;
  moq: number | null;
  extractedAt: string;
  riskFlags: string[];
  matchConfidence: number;
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

type SortKey = 'priceUsd' | 'supplier' | 'country' | 'extractedAt';

export function Dashboard() {
  const [mode, setMode] = useState<'mpn' | 'url'>('mpn');
  const [value, setValue] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('priceUsd');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function startSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setOffers([]);
    setEvents([]);
    try {
      const body =
        mode === 'mpn'
          ? { mpn: value.trim(), forceRefresh }
          : { url: value.trim(), forceRefresh };
      const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create search');
      setJob(data.job);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSubmitting(false);
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
          `/api/searches/${job!.id}/results?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}`,
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
    const handle = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [job?.id, query, sort, order]);

  const progressLabel = useMemo(() => {
    if (!job) return 'Idle';
    return job.status.replaceAll('_', ' ');
  }, [job]);

  function toggleSort(next: SortKey) {
    if (sort === next) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(next);
      setOrder('asc');
    }
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
            Enter a SupplyItNow URL or manufacturer part number. We search worldwide suppliers,
            normalize prices to USD, and rank the lowest offers first.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <form
        onSubmit={startSearch}
        className="mb-6 rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4 shadow-sm backdrop-blur md:p-5"
      >
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'mpn' ? 'bg-dex-accent text-white' : 'border border-dex-border text-dex-muted'}`}
            onClick={() => setMode('mpn')}
          >
            MPN
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'url' ? 'bg-dex-accent text-white' : 'border border-dex-border text-dex-muted'}`}
            onClick={() => setMode('url')}
          >
            SupplyItNow URL
          </button>
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={mode === 'mpn' ? 'e.g. LM7805CT' : 'https://www.supplyitnow.com/...'}
            className="w-full rounded-lg border border-dex-border bg-transparent px-3 py-2.5 text-dex-fg outline-none ring-dex-accent focus:ring-2"
            required
          />
          <button
            type="submit"
            disabled={submitting || !value.trim()}
            className="rounded-lg bg-dex-accent px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Search suppliers'}
          </button>
        </div>
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
              <h2 className="text-lg font-medium">Job progress</h2>
              <span className="rounded-full border border-dex-border px-3 py-1 text-xs uppercase tracking-wide text-dex-muted">
                {progressLabel}
              </span>
            </div>
            <p className="mt-2 text-sm text-dex-muted">
              {job.inputType}: <span className="text-dex-fg">{job.inputValue}</span>
            </p>
            {job.part ? (
              <p className="mt-1 text-sm text-dex-muted">
                MPN <span className="text-dex-fg">{job.part.rawMpn}</span>
                {job.part.manufacturer ? ` · ${job.part.manufacturer}` : ''}
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
                className="h-full bg-dex-accent transition-all"
                style={{
                  width: `${statusPercent(job.status)}%`,
                }}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-auto rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4">
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
            </ul>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-dex-border bg-dex-bg-elevated/90 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-medium">Results</h2>
            <p className="text-sm text-dex-muted">
              {offers.length} offers · sorted by {sort} ({order})
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter table…"
              className="rounded-md border border-dex-border bg-transparent px-3 py-1.5 text-sm"
            />
            {job ? (
              <>
                <a
                  className="rounded-md border border-dex-border px-3 py-1.5 text-sm"
                  href={`/api/searches/${job.id}/export?format=csv`}
                >
                  Export CSV
                </a>
                <a
                  className="rounded-md border border-dex-border px-3 py-1.5 text-sm"
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
                <th className="px-2 py-2">MPN</th>
                <th className="px-2 py-2">Manufacturer</th>
                <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('supplier')}>
                  Supplier
                </th>
                <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('country')}>
                  Country
                </th>
                <th className="px-2 py-2">Website</th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Price</th>
                <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('priceUsd')}>
                  USD
                </th>
                <th className="px-2 py-2">Stock</th>
                <th className="px-2 py-2">Lead</th>
                <th className="px-2 py-2">MOQ</th>
                <th className="cursor-pointer px-2 py-2" onClick={() => toggleSort('extractedAt')}>
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.id} className="border-b border-dex-border/60 align-top">
                  <td className="px-2 py-2 font-medium">{offer.mpn}</td>
                  <td className="px-2 py-2">{offer.manufacturer ?? '—'}</td>
                  <td className="px-2 py-2">
                    {offer.supplier.name ?? offer.supplier.domain}
                    {offer.riskFlags?.includes('ai_suspicious') ? (
                      <span className="ml-2 text-xs text-dex-warn">flagged</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">{offer.supplier.country ?? '—'}</td>
                  <td className="px-2 py-2">
                    <a
                      className="text-dex-accent underline"
                      href={offer.supplier.website ?? `https://${offer.supplier.domain}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {offer.supplier.domain}
                    </a>
                  </td>
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
                  <td className="px-2 py-2">
                    {offer.price != null ? `${offer.price} ${offer.currency ?? ''}`.trim() : '—'}
                  </td>
                  <td className="px-2 py-2">{offer.priceUsd ?? '—'}</td>
                  <td className="px-2 py-2">{offer.stockQuantity ?? '—'}</td>
                  <td className="px-2 py-2">{offer.leadTime ?? '—'}</td>
                  <td className="px-2 py-2">{offer.moq ?? '—'}</td>
                  <td className="px-2 py-2">
                    {new Date(offer.extractedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {offers.length === 0 ? (
                <tr>
                  <td className="px-2 py-6 text-dex-muted" colSpan={12}>
                    {job ? 'No offers yet — waiting for the pipeline…' : 'Run a search to populate results.'}
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
    queued: 5,
    resolving: 15,
    discovering: 35,
    extracting: 55,
    normalizing: 75,
    enriching: 90,
    completed: 100,
    completed_with_errors: 100,
    failed: 100,
    cancelled: 100,
  };
  return map[status] ?? 10;
}
