import ExcelJS from 'exceljs';
import { getBatchJobs, listJobOffers } from '@dex/core';
import { appBaseUrl, emailFrom, resendApiKey } from '@/lib/email';

/** Compact workbook for the emailed copy of a finished vendor report. */
async function buildAttachment(batchId: string): Promise<Buffer | null> {
  const jobs = await getBatchJobs(batchId);
  if (jobs.length === 0) return null;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Vendor Report');
  sheet.columns = [
    { header: 'Part Number', key: 'mpn', width: 24 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Vendor #', key: 'rank', width: 9 },
    { header: 'Vendor', key: 'vendor', width: 26 },
    { header: 'Country', key: 'country', width: 9 },
    { header: 'Price (USD)', key: 'usd', width: 12 },
    { header: 'Line Total (USD)', key: 'total', width: 14 },
    { header: 'Stock', key: 'stock', width: 12 },
    { header: 'URL', key: 'url', width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const job of jobs) {
    const offers = await listJobOffers(job.id, { includePossible: false, limit: 10 });
    if (offers.length === 0) {
      sheet.addRow({
        mpn: job.inputValue,
        product: job.part?.displayName ?? '',
        qty: job.quantity ?? '',
        rank: '—',
        vendor: 'No vendors found',
      });
      continue;
    }
    offers.forEach((offer, index) => {
      const usd = offer.priceUsd != null ? Number(offer.priceUsd) : null;
      sheet.addRow({
        mpn: job.inputValue,
        product: job.part?.displayName ?? '',
        qty: job.quantity ?? '',
        rank: index + 1,
        vendor: offer.supplier.name ?? offer.supplier.domain,
        country: offer.supplier.country ?? '',
        usd: usd != null ? usd.toFixed(4) : '',
        total: usd != null && job.quantity != null ? (usd * job.quantity).toFixed(2) : '',
        stock: offer.stockQuantity ?? offer.availability ?? '',
        url: offer.productUrl,
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Email the finished vendor report to the signed-in user. Entirely
 * best-effort: any failure is swallowed — the on-screen report and
 * downloads are the source of truth.
 */
export async function sendBatchReportEmail(input: {
  batchId: string;
  to: string;
  partCount: number;
  offerCount: number;
}): Promise<boolean> {
  const apiKey = resendApiKey();
  const from = emailFrom();
  if (!apiKey || !from) return false;

  const attachment = await buildAttachment(input.batchId);
  if (!attachment) return false;

  const base = appBaseUrl();
  const reportUrl = `${base}/report/${input.batchId}`;
  const excelUrl = `${base}/api/batches/${input.batchId}/export?format=xlsx`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Your DEX vendor report is ready — ${input.partCount} part${input.partCount === 1 ? '' : 's'}, ${input.offerCount} offers`,
      html: `
        <div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#1d5bd8,#0a1f33);border-radius:14px 14px 0 0;padding:24px 28px;">
            <p style="margin:0;color:#9db9e8;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-weight:600;">Data Exchange Corporation</p>
            <p style="margin:6px 0 0;color:#fff;font-size:18px;font-weight:700;">Your vendor report is ready</p>
          </div>
          <div style="background:#fff;border:1px solid #d7dfe9;border-top:0;border-radius:0 0 14px 14px;padding:26px 28px;">
            <p style="margin:0;color:#14212e;font-size:14px;line-height:1.6;">
              ${input.partCount} part${input.partCount === 1 ? '' : 's'} searched · ${input.offerCount} vendor offer${input.offerCount === 1 ? '' : 's'} found.
              The full report is attached as an Excel file.
            </p>
            <p style="margin:18px 0 0;">
              <a href="${reportUrl}" style="display:inline-block;background:#1d5bd8;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 24px;border-radius:9px;">View report</a>
              <a href="${excelUrl}" style="display:inline-block;margin-left:8px;color:#1d5bd8;text-decoration:none;font-size:14px;font-weight:600;padding:10px 12px;">Download Excel</a>
            </p>
          </div>
        </div>`,
      attachments: [
        {
          filename: `dex-vendor-report-${input.batchId.slice(0, 8)}.xlsx`,
          content: attachment.toString('base64'),
        },
      ],
    }),
  });

  return response.ok;
}
