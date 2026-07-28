import ExcelJS from 'exceljs';
import { listJobOffers } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  const offers = await listJobOffers(id, { includePossible: true });

  const rows = offers.map((offer) => ({
    mpn: offer.mpn,
    manufacturer: offer.manufacturer ?? '',
    supplierName: offer.supplier.name ?? offer.supplier.domain,
    supplierCountry: offer.supplier.country ?? '',
    supplierWebsite: offer.supplier.website ?? `https://${offer.supplier.domain}`,
    productUrl: offer.productUrl,
    price: offer.price?.toString() ?? '',
    currency: offer.currency ?? '',
    priceUsd: offer.priceUsd?.toString() ?? '',
    stockQuantity: offer.stockQuantity?.toString() ?? '',
    leadTime: offer.leadTime ?? '',
    moq: offer.moq?.toString() ?? '',
    lastUpdated: offer.extractedAt.toISOString(),
    riskFlags: offer.riskFlags.join('|'),
  }));

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Offers');
    sheet.columns = Object.keys(rows[0] ?? { mpn: '' }).map((key) => ({
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

  const header = [
    'mpn',
    'manufacturer',
    'supplierName',
    'supplierCountry',
    'supplierWebsite',
    'productUrl',
    'price',
    'currency',
    'priceUsd',
    'stockQuantity',
    'leadTime',
    'moq',
    'lastUpdated',
    'riskFlags',
  ];
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [
    header.join(','),
    ...rows.map((row) => header.map((key) => escape(String(row[key as keyof typeof row] ?? ''))).join(',')),
  ].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dex-sourcing-${id}.csv"`,
    },
  });
}
