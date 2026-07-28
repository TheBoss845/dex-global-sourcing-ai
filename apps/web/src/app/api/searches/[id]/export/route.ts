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
    supplierEmail: sanitizeCell(offer.supplier.contactEmail ?? ''),
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

  const COLUMN_LABELS: Record<string, string> = {
    supplierName: 'Vendor',
    supplierEmail: 'Vendor Sales Email',
    supplierCountry: 'Country',
    manufacturer: 'Manufacturer',
    mpn: 'Part Number',
    supplierPartNumber: 'Vendor SKU',
    productUrl: 'Product URL',
    price: 'Price',
    currency: 'Currency',
    priceUsd: 'Price (USD)',
    stockQuantity: 'Stock',
    availability: 'Availability',
    leadTime: 'Lead Time',
    moq: 'MOQ',
    matchConfidence: 'Match Confidence',
    reliabilityScore: 'Reliability',
    lastUpdated: 'Last Updated',
    warnings: 'Warnings',
  };
  const NUMERIC_COLUMNS = new Set([
    'price',
    'priceUsd',
    'stockQuantity',
    'moq',
    'matchConfidence',
    'reliabilityScore',
  ]);

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Offers');
    const keys = Object.keys(rows[0]!);
    sheet.columns = keys.map((key) => ({
      header: COLUMN_LABELS[key] ?? key,
      key,
      width: key === 'productUrl' ? 50 : 18,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D5BD8' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    rows.forEach((row) => {
      sheet.addRow(
        keys.map((key) => {
          const value = row[key as keyof typeof row] ?? '';
          if (NUMERIC_COLUMNS.has(key) && value !== '' && Number.isFinite(Number(value))) {
            return Number(value);
          }
          return value;
        }),
      );
    });
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
  // BOM + CRLF so Excel detects UTF-8 and splits columns correctly on every locale.
  const csv =
    '\ufeff' +
    [
      header.map((key) => COLUMN_LABELS[key] ?? key).join(','),
      ...rows.map((row) =>
        header.map((key) => escape(String(row[key as keyof typeof row] ?? ''))).join(','),
      ),
    ].join('\r\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dex-sourcing-${id}.csv"`,
    },
  });
}
