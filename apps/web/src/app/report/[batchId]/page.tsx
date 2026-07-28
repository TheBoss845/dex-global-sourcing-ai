import { getBatchJobs, listJobOffers } from '@dex/core';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

type PartBlock = {
  mpn: string;
  product: string | null;
  description: string | null;
  quantity: number | null;
  imageUrl: string | null;
  offers: Array<{
    vendor: string;
    email: string | null;
    country: string | null;
    priceUsd: string | null;
    lineTotal: string | null;
    stock: string | null;
    leadTime: string | null;
    url: string;
  }>;
};

export default async function BatchReportPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const jobs = await getBatchJobs(batchId);

  if (jobs.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-lg font-semibold">Report not found</p>
      </main>
    );
  }

  const blocks: PartBlock[] = [];
  for (const job of jobs) {
    const offers = await listJobOffers(job.id, { includePossible: false, limit: 10 });
    blocks.push({
      mpn: job.inputValue,
      product: job.part?.displayName ?? null,
      description: job.part?.descriptionClean ?? job.part?.title ?? null,
      quantity: job.quantity ?? null,
      imageUrl: job.part?.imageUrl ?? null,
      offers: offers.map((offer) => {
        const usd = offer.priceUsd != null ? Number(offer.priceUsd) : null;
        return {
          vendor: offer.supplier.name ?? offer.supplier.domain,
          email: offer.supplier.contactEmail ?? null,
          country: offer.supplier.country,
          priceUsd: usd != null ? `$${usd.toFixed(2)}` : null,
          lineTotal:
            usd != null && job.quantity != null ? `$${(usd * job.quantity).toFixed(2)}` : null,
          stock: offer.stockQuantity?.toLocaleString() ?? offer.availability ?? null,
          leadTime: offer.leadTime,
          url: offer.productUrl,
        };
      }),
    });
  }

  const generated = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-4xl bg-white px-8 py-10 text-[#14212e] print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <p className="text-sm text-[#5d6d7e]">Print-ready report · use your browser’s “Save as PDF”</p>
        <PrintButton />
      </div>

      <header className="border-b-4 border-[#0a1f33] pb-4">
        <p className="text-[11px] font-semibold tracking-[0.25em] text-[#5d6d7e] uppercase">
          Data Exchange Corporation
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[#0a1f33]">Global Sourcing Vendor Report</h1>
        <p className="mt-1 text-sm text-[#5d6d7e]">
          Generated {generated} · {blocks.length} part{blocks.length === 1 ? '' : 's'} · up to 10
          vendors each · prices best-effort from public listings
        </p>
      </header>

      {blocks.map((block) => (
        <section key={block.mpn} className="mt-8 break-inside-avoid">
          <div className="flex items-start gap-4">
            {block.imageUrl ? (
              <img
                src={block.imageUrl}
                alt=""
                width={64}
                height={64}
                className="h-16 w-16 rounded border border-[#d7dfe9] bg-white object-contain p-1"
              />
            ) : null}
            <div>
              <h2 className="text-lg font-bold text-[#0a1f33]">
                {block.product ? `${block.product} — ` : ''}
                {block.mpn}
                {block.quantity != null ? (
                  <span className="ml-2 text-sm font-medium text-[#5d6d7e]">
                    (qty {block.quantity.toLocaleString()})
                  </span>
                ) : null}
              </h2>
              {block.description ? (
                <p className="mt-0.5 max-w-2xl text-sm leading-relaxed text-[#5d6d7e]">
                  {block.description}
                </p>
              ) : null}
            </div>
          </div>

          {block.offers.length === 0 ? (
            <p className="mt-3 text-sm text-[#935f00]">No vendors found for this part.</p>
          ) : (
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#0a1f33] text-left text-white">
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Vendor</th>
                  <th className="px-3 py-2 font-semibold">Country</th>
                  <th className="px-3 py-2 font-semibold">Price (USD)</th>
                  {block.quantity != null ? (
                    <th className="px-3 py-2 font-semibold">Line Total</th>
                  ) : null}
                  <th className="px-3 py-2 font-semibold">Stock</th>
                  <th className="px-3 py-2 font-semibold">Lead Time</th>
                </tr>
              </thead>
              <tbody>
                {block.offers.map((offer, i) => (
                  <tr key={offer.url} className={i % 2 ? 'bg-[#f2f5f9]' : ''}>
                    <td className="px-3 py-1.5">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">
                      {offer.vendor}
                      {offer.email ? (
                        <span className="block text-xs font-normal text-[#1d5bd8]">
                          {offer.email}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">{offer.country ?? '—'}</td>
                    <td className="px-3 py-1.5 font-semibold">{offer.priceUsd ?? 'On request'}</td>
                    {block.quantity != null ? (
                      <td className="px-3 py-1.5">{offer.lineTotal ?? '—'}</td>
                    ) : null}
                    <td className="px-3 py-1.5">{offer.stock ?? '—'}</td>
                    <td className="px-3 py-1.5">{offer.leadTime ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <footer className="mt-10 border-t border-[#d7dfe9] pt-4 text-xs text-[#5d6d7e]">
        © {new Date().getFullYear()} Data Exchange Corporation (DEX) · Global Sourcing Assistant
      </footer>
    </main>
  );
}
