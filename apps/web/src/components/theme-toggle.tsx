'use client';

import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="rounded-md border border-dex-border px-3 py-1.5 text-sm text-dex-muted hover:text-dex-fg"
    >
      {theme === 'dark' ? 'Light' : 'Dark'} mode
    </button>
  );
}
