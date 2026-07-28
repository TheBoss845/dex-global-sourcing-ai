import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-dex-border bg-dex-bg-elevated p-8 text-center shadow-card-lg">
        <p className="font-display text-xs font-semibold tracking-[0.22em] text-dex-muted uppercase">
          Data Exchange Corporation
        </p>
        <h1 className="font-display mt-2 text-xl font-semibold text-dex-brand">Page not found</h1>
        <p className="mt-3 text-sm text-dex-muted">That page doesn’t exist.</p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-dex-accent px-6 py-2.5 font-medium text-white transition hover:brightness-110"
        >
          Back to DEX Sourcing
        </Link>
      </div>
    </main>
  );
}
