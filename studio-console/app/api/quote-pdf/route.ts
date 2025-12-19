import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { getConvexHttpClient } from "@/lib/convexServerClient";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

function escapeHtml(input: string): string {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;");
}

function buildQuoteHtml(args: {
    projectName: string;
    clientName: string;
    quoteVersion: number;
    currency: string;
    totalAmount: number;
    breakdown: Array<{ label: string; amount: number; notes?: string | null }>;
    clientDocumentText: string;
    brandingLogoUrl: string | null;
    quoteFooterHebrew: string;
}) {
    const rows = args.breakdown
        .map((item) => {
            const notes = item.notes ? `<div class="notes">${escapeHtml(item.notes)}</div>` : "";
            return `<tr>
                <td class="label">${escapeHtml(item.label)}${notes}</td>
                <td class="amount">${item.amount.toLocaleString()} ${escapeHtml(args.currency)}</td>
            </tr>`;
        })
        .join("\n");

    const logo = args.brandingLogoUrl
        ? `<img class="logo" src="${escapeHtml(args.brandingLogoUrl)}" alt="Logo" />`
        : "";

    const footer = args.quoteFooterHebrew.trim() ? `<div class="footer">${escapeHtml(args.quoteFooterHebrew)}</div>` : "";

    return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 0; }
    .page { padding: 28px 32px; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .meta { text-align: right; }
    .title { font-size: 18px; font-weight: 700; margin: 0; }
    .sub { font-size: 12px; color: #6b7280; margin-top: 4px; white-space: pre-wrap; }
    .logo { max-height: 44px; max-width: 180px; object-fit: contain; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 6px; vertical-align: top; }
    th { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .label { font-size: 13px; font-weight: 600; }
    .notes { font-size: 12px; font-weight: 400; color: #6b7280; margin-top: 4px; }
    .amount { font-size: 13px; text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .total { font-size: 16px; font-weight: 800; text-align: left; padding-top: 14px; }
    .doc { white-space: pre-wrap; font-size: 12.5px; line-height: 1.5; }
    .footer { margin-top: 18px; font-size: 11px; color: #6b7280; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="meta">
        <div class="title">הצעת מחיר (גרסה ${args.quoteVersion})</div>
        <div class="sub">${escapeHtml(args.clientName)} · ${escapeHtml(args.projectName)}</div>
      </div>
      ${logo}
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th style="text-align:right;">Item</th>
            <th style="text-align:left;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td class="label">סה״כ</td>
            <td class="total">${args.totalAmount.toLocaleString()} ${escapeHtml(args.currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="doc">${escapeHtml(args.clientDocumentText)}</div>
    </div>

    ${footer}
  </div>
</body>
</html>`;
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as { quoteId?: string };
        if (!body.quoteId) {
            return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
        }

        const quoteId = body.quoteId as Id<"quotes">;
        const client = getConvexHttpClient();
        const data = await client.query(api.quotes.getQuotePdfData, { quoteId });

        const html = buildQuoteHtml({
            projectName: data.project.name,
            clientName: data.project.clientName,
            quoteVersion: data.quote.version,
            currency: data.quote.currency,
            totalAmount: data.quote.totalAmount,
            breakdown: data.breakdown.map((b) => ({
                label: b.label,
                amount: b.amount,
                notes: b.notes ?? null,
            })),
            clientDocumentText: data.quote.clientDocumentText,
            brandingLogoUrl: data.brandingLogoUrl,
            quoteFooterHebrew: data.quoteFooterHebrew ?? "",
        });

        const browser = await chromium.launch();
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });

        const pdfBytes = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" },
        });
        await browser.close();

        const uploadUrl = await client.mutation(api.quotes.generatePdfUploadUrl, {});
        const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: Buffer.from(pdfBytes),
        });
        if (!uploadResponse.ok) {
            return NextResponse.json({ error: `Upload failed: ${uploadResponse.status}` }, { status: 500 });
        }
        const uploaded = (await uploadResponse.json()) as { storageId: string };
        const attached = await client.mutation(api.quotes.attachPdf, { quoteId, pdfStorageId: uploaded.storageId });

        return NextResponse.json({ pdfUrl: attached.pdfUrl });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
