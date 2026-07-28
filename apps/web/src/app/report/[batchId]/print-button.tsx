'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-[#1d5bd8] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
    >
      Print / Save as PDF
    </button>
  );
}
