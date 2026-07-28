import Link from 'next/link';

export const metadata = {
  title: 'How to use · DEX Global Sourcing Assistant',
};

const SECTIONS = [
  {
    title: '1. Sign in',
    body: [
      'Enter your @dex.com work email (or an authorized account) on the sign-in screen. When email verification is enabled you will receive a 6-digit code — enter it, or use the one-click link in the email.',
    ],
  },
  {
    title: '2. Build a vendor report from a parts list',
    body: [
      'Open the “Parts list report” tab and paste your parts in any format — rows copied straight from SupplyItNow, a spreadsheet, an email, or one part per line (e.g. “LM7805CT, 5V regulator”). Quantities are picked up automatically when present.',
      'Select “Read parts list”. The assistant identifies each part number, description, manufacturer, and quantity, and shows you a preview. Remove any rows you don’t want, then select “Run report”.',
      'Keep the page open while it works. Each part is searched worldwide, every vendor is verified, and the table fills in live: vendor count, best price, and price change versus your previous search of the same part.',
    ],
  },
  {
    title: '3. Search a single product',
    body: [
      'Use the “Single product link” tab for one item. You can paste a product-page link, type an exact part number, or describe the product in plain words — the assistant resolves it, asks you to confirm only when the request is ambiguous, and learns from your corrections.',
    ],
  },
  {
    title: '4. Read the results',
    body: [
      'Each part shows a verified product photo, a plain-English product name, and a professional description. Vendor rows include country, sales contact email when published, price in original currency and USD, stock, lead time, and a match-confidence score.',
      'The cheapest verified offer is marked “Best”. Warning chips flag price outliers and risk signals. “On request” means the vendor quotes by inquiry — common for industrial parts.',
    ],
  },
  {
    title: '5. Export and share',
    body: [
      'Download the consolidated report as Excel or CSV at any time — even while parts are still running (it includes everything finished so far). “Print / PDF” opens a formatted document for printing or saving as PDF.',
      'When email is configured, the finished report is also delivered to your inbox automatically with the Excel file attached.',
    ],
  },
  {
    title: 'Tips',
    body: [
      'Failed parts show a Retry control — transient network issues usually succeed on a second pass.',
      'Add the manufacturer name to ambiguous part numbers (e.g. “ABB 29088391”) for better matches.',
      'DEX’s own marketplaces are automatically excluded from vendor results.',
      'A refresh or closed tab does not lose a running report — reopen the site and it resumes.',
    ],
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="font-display text-[11px] font-semibold tracking-[0.22em] text-dex-muted uppercase">
            Data Exchange Corporation
          </p>
          <h1 className="font-display mt-1 text-3xl font-semibold text-dex-brand">
            How to use the Sourcing Assistant
          </h1>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-lg bg-dex-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Open the app
        </Link>
      </div>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-dex-border bg-dex-bg-elevated p-6 shadow-card"
          >
            <h2 className="font-display text-lg font-semibold text-dex-brand">{section.title}</h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph) => (
                <p key={paragraph.slice(0, 40)} className="text-sm leading-relaxed text-dex-fg">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-dex-muted">
        © {new Date().getFullYear()} Data Exchange Corporation (DEX) · Global Sourcing Assistant
      </p>
    </main>
  );
}
