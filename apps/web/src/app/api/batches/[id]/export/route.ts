import ExcelJS from 'exceljs';
import { getBatchJobs, listJobOffers } from '@dex/core';
import { prisma } from '@dex/db';

/** Best USD price from the most recent earlier search of the same part. */
async function previousBestUsd(job: {
  id: string;
  createdAt: Date;
  part: { normalizedMpn: string } | null;
}): Promise<number | null> {
  if (!job.part?.normalizedMpn) return null;
  try {
    const previous = await prisma.searchJob.findFirst({
      where: {
        id: { not: job.id },
        status: { in: ['completed', 'completed_with_errors'] },
        createdAt: { lt: job.createdAt },
        part: { normalizedMpn: job.part.normalizedMpn },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!previous) return null;
    const best = await prisma.offer.aggregate({
      where: { jobId: previous.id, priceUsd: { not: null } },
      _min: { priceUsd: true },
    });
    return best._min.priceUsd ? Number(best._min.priceUsd) : null;
  } catch {
    return null;
  }
}

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
  product: string;
  description: string;
  sourceDescription: string;
  quantity: string;
  vendorRank: string;
  vendor: string;
  country: string;
  price: string;
  currency: string;
  priceUsd: string;
  lineTotalUsd: string;
  previousBestUsd: string;
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
    const product = sanitizeCell(job.part?.displayName ?? '');
    const aiDescription = job.part?.descriptionClean ?? '';
    const rawDescription = job.part?.descriptionRaw ?? job.part?.title ?? '';
    const description = sanitizeCell(aiDescription || rawDescription);
    const sourceDescription = sanitizeCell(
      aiDescription && rawDescription && aiDescription !== rawDescription ? rawDescription : '',
    );
    const offers = await listJobOffers(job.id, { includePossible: false, limit: 10 });
    const quantity = job.quantity != null ? String(job.quantity) : '';
    const prevBest = await previousBestUsd(job);
    const previousBest = prevBest != null ? prevBest.toFixed(4) : '';

    if (offers.length === 0) {
      rows.push({
        partNumber,
        product,
        description,
        sourceDescription,
        quantity,
        vendorRank: '—',
        vendor: job.errorMessage ? `No vendors found (${job.errorMessage.slice(0, 80)})` : 'No vendors found',
        country: '',
        price: '',
        currency: '',
        priceUsd: '',
        lineTotalUsd: '',
        previousBestUsd: previousBest,
        stock: '',
        leadTime: '',
        productUrl: '',
        match: '',
        warnings: '',
      });
      continue;
    }

    offers.forEach((offer, index) => {
      const usd = offer.priceUsd != null ? Number(offer.priceUsd) : null;
      const lineTotal =
        usd != null && job.quantity != null ? (usd * job.quantity).toFixed(2) : '';
      rows.push({
        partNumber,
        product,
        description,
        sourceDescription,
        quantity,
        vendorRank: String(index + 1),
        vendor: sanitizeCell(offer.supplier.name ?? offer.supplier.domain),
        country: sanitizeCell(offer.supplier.country ?? ''),
        price: sanitizeCell(offer.price?.toString() ?? ''),
        currency: sanitizeCell(offer.currency ?? ''),
        priceUsd: sanitizeCell(offer.priceUsd?.toString() ?? ''),
        lineTotalUsd: lineTotal,
        previousBestUsd: index === 0 ? previousBest : '',
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
    { key: 'product', label: 'Product' },
    { key: 'description', label: 'Description' },
    { key: 'sourceDescription', label: 'Source Description' },
    { key: 'quantity', label: 'Qty' },
    { key: 'vendorRank', label: 'Vendor #' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'country', label: 'Country' },
    { key: 'price', label: 'Price' },
    { key: 'currency', label: 'Currency' },
    { key: 'priceUsd', label: 'Price (USD)' },
    { key: 'lineTotalUsd', label: 'Line Total (USD)' },
    { key: 'previousBestUsd', label: 'Prev Best (USD)' },
    { key: 'stock', label: 'Stock' },
    { key: 'leadTime', label: 'Lead Time' },
    { key: 'productUrl', label: 'Product URL' },
    { key: 'match', label: 'Match Confidence' },
    { key: 'warnings', label: 'Warnings' },
  ];

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DEX Global Sourcing Assistant';
    const sheet = workbook.addWorksheet('Vendor Report', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });

    sheet.columns = headers.map((h) => ({
      key: h.key,
      width:
        h.key === 'productUrl'
          ? 52
          : h.key === 'description'
            ? 46
            : h.key === 'sourceDescription'
              ? 30
              : h.key === 'product'
                ? 28
                : h.key === 'vendor'
                  ? 26
                  : h.key === 'partNumber'
                    ? 24
                    : 14,
    }));

    // Title banner
    sheet.mergeCells(1, 1, 1, headers.length);
    const title = sheet.getCell(1, 1);
    title.value = 'DEX · Data Exchange Corporation — Global Sourcing Vendor Report';
    title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A1F33' } };
    title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(2, 1, 2, headers.length);
    const subtitle = sheet.getCell(2, 1);
    const partCount = new Set(rows.map((r) => r.partNumber)).size;
    subtitle.value = `Generated ${new Date().toISOString().slice(0, 10)} · ${partCount} part${partCount === 1 ? '' : 's'} · up to 10 vendors each · prices best-effort from public listings`;
    subtitle.font = { size: 10, color: { argb: 'FF5D6D7E' } };
    subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Header row
    const headerRow = sheet.getRow(3);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h.label;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D5BD8' } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF0A1F33' } } };
    });
    headerRow.height = 20;

    // Numeric columns become real numbers so buyers can sum/sort in Excel.
    const numericKeys = new Set<keyof ReportRow>([
      'quantity',
      'price',
      'priceUsd',
      'lineTotalUsd',
      'previousBestUsd',
      'match',
    ]);

    // Data rows with alternating background per part group
    let previousPart = '';
    let shade = false;
    rows.forEach((row) => {
      if (row.partNumber !== previousPart) {
        shade = !shade;
        previousPart = row.partNumber;
      }
      const excelRow = sheet.addRow(
        headers.map((h) => {
          const value = row[h.key];
          if (numericKeys.has(h.key) && value !== '' && Number.isFinite(Number(value))) {
            return Number(value);
          }
          return value;
        }),
      );
      if (shade) {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F9' } };
        });
      }
      if (row.warnings) {
        excelRow.getCell(headers.findIndex((h) => h.key === 'warnings') + 1).font = {
          color: { argb: 'FF935F00' },
          size: 10,
        };
      }
    });

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
