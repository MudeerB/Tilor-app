/**
 * supabase/functions/_shared/pdfSanitizer.ts
 *
 * Hardened HTML & Document Sanitizer for Server-Side PDF Generation (OWASP A10:2021)
 * Defends against:
 * 1. Local File Inclusion (LFI via file:///etc/passwd, file:///etc/hosts)
 * 2. Server-Side Request Forgery (SSRF via <iframe>, <object>, <embed>, <img src="internal-ip">)
 * 3. Cross-Site Scripting (XSS via <script>, inline event handlers)
 * 4. CSS / Base URL Hijacking (via <link>, <base>)
 */

export interface ReceiptItem {
  description: string;
  boxes: number;
  ratePerBox: number;
  amount: number;
}

export interface SecureReceiptPayload {
  shopName: string;
  shopAddress?: string;
  shopGstin?: string;
  shopPhone?: string;
  logoDataUri?: string; // base64 data URI only
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  items: ReceiptItem[];
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
  paymentMode: string;
  notes?: string;
}

/**
 * Escapes raw strings for safe HTML rendering.
 */
function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strips dangerous HTML tags, attributes, protocols, and unverified external resources
 * from raw HTML strings before submitting to headless PDF rendering engines.
 */
export function sanitizeHtmlForPdf(
  rawHtml: string,
  allowedImageDomains: string[] = []
): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let sanitized = rawHtml;

  // 1. Strip all <script>...</script> tags and embedded contents
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 2. Strip dangerous frame / inclusion tags: <iframe>, <object>, <embed>, <applet>, <frame>, <frameset>
  sanitized = sanitized.replace(/<\/?(?:iframe|object|embed|applet|frame|frameset)\b[^>]*>/gi, '');

  // 3. Strip <base> and <link> tags to prevent base URL hijacking and CSS SSRF
  sanitized = sanitized.replace(/<\/?(?:base|link)\b[^>]*>/gi, '');

  // 4. Strip inline event handlers (e.g. onload=, onerror=, onclick=)
  sanitized = sanitized.replace(/\son[a-z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');

  // 5. Strip javascript: and vbscript: URIs
  sanitized = sanitized.replace(/(?:href|src|action)\s*=\s*['"]?\s*(?:javascript|vbscript):[^'"]*['"]?/gi, '');

  // 6. Strip file:/// and local filesystem protocols
  sanitized = sanitized.replace(/file:\/\/\/[^\s"'<>]+/gi, '');

  // 7. Sanitize <img> tags: permit only base64 data URIs or allowlisted remote image domains
  sanitized = sanitized.replace(/<img\b([^>]*?)src\s*=\s*(['"])(.*?)\2([^>]*?)>/gi, (match, before, quote, src, after) => {
    const trimmedSrc = src.trim();

    // Allow base64 data URIs for safe embedded logos
    if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmedSrc)) {
      return `<img ${before}src=${quote}${trimmedSrc}${quote}${after}>`;
    }

    // Check against allowed image domains if HTTP(S)
    if (/^https?:\/\//i.test(trimmedSrc)) {
      try {
        const parsed = new URL(trimmedSrc);
        const host = parsed.hostname.toLowerCase();
        const isAllowed = allowedImageDomains.some((d) => host === d || host.endsWith('.' + d));
        if (isAllowed) {
          return `<img ${before}src=${quote}${trimmedSrc}${quote}${after}>`;
        }
      } catch {
        // malformed URL
      }
    }

    // Drop untrusted image source to prevent SSRF
    return '<!-- [SSRF Blocked Image] -->';
  });

  return sanitized;
}

/**
 * Builds a secure, professional, GST-compliant HTML invoice document.
 * All dynamic parameters are strictly sanitized and escaped.
 */
export function buildSecureReceiptHtml(payload: SecureReceiptPayload): string {
  const safeShopName = escapeHtml(payload.shopName);
  const safeShopAddress = escapeHtml(payload.shopAddress || '');
  const safeShopGstin = escapeHtml(payload.shopGstin || 'URP');
  const safeShopPhone = escapeHtml(payload.shopPhone || '');
  const safeInvoiceNo = escapeHtml(payload.invoiceNumber);
  const safeInvoiceDate = escapeHtml(payload.invoiceDate);
  const safeCustName = escapeHtml(payload.customerName);
  const safeCustPhone = escapeHtml(payload.customerPhone || 'N/A');
  const safeCustAddress = escapeHtml(payload.customerAddress || 'Local Customer');
  const safePaymentMode = escapeHtml(payload.paymentMode);
  const safeNotes = escapeHtml(payload.notes || 'Thank you for your business!');

  const itemRowsHtml = (payload.items || []).map((item, index) => {
    const desc = escapeHtml(item.description);
    const boxes = Number(item.boxes) || 0;
    const rate = (Number(item.ratePerBox) || 0).toFixed(2);
    const amount = (Number(item.amount) || 0).toFixed(2);
    return `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; text-align: center;">${index + 1}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; font-weight: 500;">${desc}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; text-align: right;">${boxes}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; text-align: right;">₹${rate}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #E2E8F0; text-align: right; font-weight: 600;">₹${amount}</td>
      </tr>
    `;
  }).join('');

  const rawHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${safeInvoiceNo}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 30px;
      color: #1A202C;
      background: #FFFFFF;
    }
    .invoice-card {
      max-width: 800px;
      margin: 0 auto;
      border: 1px solid #CBD5E0;
      border-radius: 8px;
      padding: 32px;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #7C3AED;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .shop-title {
      font-size: 24px;
      font-weight: 800;
      color: #6D28D9;
      margin: 0 0 6px 0;
    }
    .invoice-badge {
      font-size: 20px;
      font-weight: 700;
      color: #2D3748;
      text-align: right;
    }
    .info-grid {
      display: flex;
      justify-content: space-between;
      margin-bottom: 28px;
    }
    .info-col {
      width: 48%;
      font-size: 13px;
      line-height: 1.6;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
      font-size: 13px;
    }
    th {
      background: #F3E8FF;
      color: #6D28D9;
      padding: 10px 12px;
      text-align: left;
      font-weight: 700;
    }
    .summary-box {
      margin-left: auto;
      width: 300px;
      font-size: 13px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
    }
    .grand-total {
      border-top: 2px solid #7C3AED;
      font-size: 16px;
      font-weight: 800;
      color: #6D28D9;
      padding-top: 8px;
      margin-top: 4px;
    }
    .footer-notes {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px dashed #CBD5E0;
      font-size: 12px;
      color: #718096;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header-row">
      <div>
        <h1 class="shop-title">${safeShopName}</h1>
        <div style="font-size: 13px; color: #4A5568;">
          ${safeShopAddress ? `<div>${safeShopAddress}</div>` : ''}
          ${safeShopPhone ? `<div>Phone: ${safeShopPhone}</div>` : ''}
          <div>GSTIN: <strong>${safeShopGstin}</strong></div>
        </div>
      </div>
      <div class="invoice-badge">
        <div>TAX INVOICE</div>
        <div style="font-size: 14px; font-weight: 600; color: #6D28D9; margin-top: 4px;">${safeInvoiceNo}</div>
        <div style="font-size: 12px; font-weight: 400; color: #718096;">Date: ${safeInvoiceDate}</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-col">
        <strong style="color: #6D28D9;">BILLED TO:</strong>
        <div>${safeCustName}</div>
        <div>Phone: ${safeCustPhone}</div>
        <div>${safeCustAddress}</div>
      </div>
      <div class="info-col" style="text-align: right;">
        <strong style="color: #6D28D9;">PAYMENT DETAILS:</strong>
        <div>Mode: <strong>${safePaymentMode}</strong></div>
        <div>Status: Settled</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 40px; text-align: center;">#</th>
          <th>Item Description</th>
          <th style="width: 70px; text-align: right;">Boxes</th>
          <th style="width: 100px; text-align: right;">Rate (₹)</th>
          <th style="width: 110px; text-align: right;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRowsHtml}
      </tbody>
    </table>

    <div class="summary-box">
      <div class="summary-row">
        <span>Subtotal:</span>
        <span>₹${payload.subtotal.toFixed(2)}</span>
      </div>
      <div class="summary-row">
        <span>CGST (9%):</span>
        <span>₹${payload.cgstAmount.toFixed(2)}</span>
      </div>
      <div class="summary-row">
        <span>SGST (9%):</span>
        <span>₹${payload.sgstAmount.toFixed(2)}</span>
      </div>
      <div class="summary-row grand-total">
        <span>Grand Total:</span>
        <span>₹${payload.totalAmount.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer-notes">
      ${safeNotes}
    </div>
  </div>
</body>
</html>`;

  return sanitizeHtmlForPdf(rawHtml);
}
