import ExcelJS from 'exceljs';
import { listJobOffers } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

/** Prevent CSV/Excel formula injection from scraped supplier fields. */
function sanitizeCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  const offers = await listJobOffers(id, { includePossible: false, limit: 50 });

  if (offers.length === 0) {
    return new Response('No offers available for export', { status: 404 });
  }

  const rows = offers.map((offer) => ({
    supplierName: sanitizeCell(offer.supplier.name ?? offer.supplier.domain),
    supplierCountry: sanitizeCell(offer.supplier.country ?? ''),
    manufacturer: sanitizeCell(offer.manufacturer ?? ''),
    mpn: sanitizeCell(offer.mpn),
    supplierPartNumber: sanitizeCell(offer.supplierPartNumber ?? ''),
    productUrl: sanitizeCell(offer.productUrl),
    price: sanitizeCell(offer.price?.toString() ?? ''),
    currency: sanitizeCell(offer.currency ?? ''),
    priceUsd: sanitizeCell(offer.priceUsd?.toString() ?? ''),
    stockQuantity: sanitizeCell(offer.stockQuantity?.toString() ?? ''),
    availability: sanitizeCell(offer.availability ?? ''),
    leadTime: sanitizeCell(offer.leadTime ?? ''),
    moq: sanitizeCell(offer.moq?.toString() ?? ''),
    matchConfidence: String(offer.matchConfidence),
    reliabilityScore: offer.reliabilityScore?.toString() ?? '',
    lastUpdated: offer.extractedAt.toISOString(),
    warnings: sanitizeCell(offer.riskFlags.join('|')),
  }));

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Offers');
    sheet.columns = Object.keys(rows[0]!).map((key) => ({
      header: key,
      key,
      width: 18,
    }));
    sheet.addRows(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="dex-sourcing-${id}.xlsx"`,
      },
    });
  }

  const header = Object.keys(rows[0]!);
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [
    header.join(','),
    ...rows.map((row) =>
      header.map((key) => escape(String(row[key as keyof typeof row] ?? ''))).join(','),
    ),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dex-sourcing-${id}.csv"`,
    },
  });
}
