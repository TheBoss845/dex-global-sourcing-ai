import ExcelJS from 'exceljs';
import { getBatchJobs, listJobOffers } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

/** Prevent CSV/Excel formula injection from scraped supplier fields. */
function sanitizeCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

type ReportRow = {
  partNumber: string;
  description: string;
  vendorRank: string;
  vendor: string;
  country: string;
  price: string;
  currency: string;
  priceUsd: string;
  stock: string;
  leadTime: string;
  productUrl: string;
  match: string;
  warnings: string;
};

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'xlsx';

  const jobs = await getBatchJobs(id);
  if (jobs.length === 0) {
    return new Response('Batch not found', { status: 404 });
  }

  const rows: ReportRow[] = [];
  for (const job of jobs) {
    const partNumber = sanitizeCell(job.inputValue);
    const description = sanitizeCell(job.part?.title ?? '');
    const offers = await listJobOffers(job.id, { includePossible: false, limit: 10 });

    if (offers.length === 0) {
      rows.push({
        partNumber,
        description,
        vendorRank: '—',
        vendor: job.errorMessage ? `No vendors found (${job.errorMessage.slice(0, 80)})` : 'No vendors found',
        country: '',
        price: '',
        currency: '',
        priceUsd: '',
        stock: '',
        leadTime: '',
        productUrl: '',
        match: '',
        warnings: '',
      });
      continue;
    }

    offers.forEach((offer, index) => {
      rows.push({
        partNumber,
        description,
        vendorRank: String(index + 1),
        vendor: sanitizeCell(offer.supplier.name ?? offer.supplier.domain),
        country: sanitizeCell(offer.supplier.country ?? ''),
        price: sanitizeCell(offer.price?.toString() ?? ''),
        currency: sanitizeCell(offer.currency ?? ''),
        priceUsd: sanitizeCell(offer.priceUsd?.toString() ?? ''),
        stock: sanitizeCell(
          offer.stockQuantity?.toString() ?? offer.availability ?? '',
        ),
        leadTime: sanitizeCell(offer.leadTime ?? ''),
        productUrl: sanitizeCell(offer.productUrl),
        match: String(offer.matchConfidence),
        warnings: sanitizeCell(offer.riskFlags.join('|')),
      });
    });
  }

  const headers: Array<{ key: keyof ReportRow; label: string }> = [
    { key: 'partNumber', label: 'Part Number' },
    { key: 'description', label: 'Description' },
    { key: 'vendorRank', label: 'Vendor #' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'country', label: 'Country' },
    { key: 'price', label: 'Price' },
    { key: 'currency', label: 'Currency' },
    { key: 'priceUsd', label: 'Price (USD)' },
    { key: 'stock', label: 'Stock' },
    { key: 'leadTime', label: 'Lead Time' },
    { key: 'productUrl', label: 'Product URL' },
    { key: 'match', label: 'Match Confidence' },
    { key: 'warnings', label: 'Warnings' },
  ];

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('DEX Sourcing Report');
    sheet.columns = headers.map((h) => ({
      header: h.label,
      key: h.key,
      width: h.key === 'productUrl' ? 50 : h.key === 'description' ? 40 : 16,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRows(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="dex-vendor-report-${id.slice(0, 8)}.xlsx"`,
      },
    });
  }

  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [
    headers.map((h) => h.label).join(','),
    ...rows.map((row) => headers.map((h) => escape(String(row[h.key] ?? ''))).join(',')),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dex-vendor-report-${id.slice(0, 8)}.csv"`,
    },
  });
}
