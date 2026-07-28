'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-dex-border bg-dex-bg-elevated p-8 text-center shadow-card-lg">
        <p className="font-display text-xs font-semibold tracking-[0.22em] text-dex-muted uppercase">
          Data Exchange Corporation
        </p>
        <h1 className="font-display mt-2 text-xl font-semibold text-dex-brand">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-dex-muted">
          The page hit an unexpected problem. Your reports and data are safe — try again.
        </p>
        {error?.message ? (
          <p className="mt-3 rounded-lg bg-dex-bg px-3 py-2 text-xs text-dex-muted">
            {error.message.slice(0, 200)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 rounded-lg bg-dex-accent px-6 py-2.5 font-medium text-white transition hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
