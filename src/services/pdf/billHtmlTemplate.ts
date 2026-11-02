/**
 * src/services/pdf/billHtmlTemplate.ts
 *
 * Professional, print-ready HTML Invoice Template for Tilor Tile Store.
 * Supports:
 * - A4 Page layout with proper print margins & pagination controls
 * - Multi-page invoices with repeating table headers (thead display: table-header-group)
 * - Safe HTML entity escaping to prevent code injection
 * - Offline-safe typography and crisp vector inline SVG branding
 * - Comprehensive financial breakdowns (Subtotal, Discount, CGST/SGST/IGST, Grand Total)
 * - Khatabook Credit Ledger records (Deposit Paid, Remaining Balance, Due Date)
 */

export interface InvoicePrintItem {
  name: string;
  variantLabel?: string;
  brand?: string;
  size?: string;
  boxes: number;
  pricePerBox: number;
  total: number;
  sqftPerBox?: number;
  roomName?: string | null;
  sqft?: number;
  tiles?: number;
  tilesPerBox?: number;
}

export interface CreditPrintDetail {
  depositPaid: number;
  debt: number;
  dueDate: string;
  repayments?: Array<{ amount: number; date: string; mode: string }>;
}

export interface InvoicePrintData {
  invoiceId: string;
  dbId?: string;
  date: string;
  customerName: string;
  customerPhone?: string;
  customerGst?: string;
  customerAddress?: string;
  items: InvoicePrintItem[];
  subtotal: number;
  discount?: number;
  gst?: number;
  gstType?: 'cgst_sgst' | 'igst' | 'none' | string;
  total: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'credit' | string;
  creditDetail?: CreditPrintDetail | null;
  txnRef?: string;
  createdByName?: string;
  shopName?: string;
  shopAddress?: string;
  shopPhone?: string;
  shopEmail?: string;
  shopGst?: string;
}

export function sanitizePdfFilename(invoiceId: string | undefined): string {
  const base = (invoiceId || 'INV-001').trim();
  // Replace illegal filename characters with underscores
  const safeBase = base
    .replace(/[/\\?%*:|"<> ]/g, '_')
    .replace(/_+/g, '_');
  return `Invoice_${safeBase}.pdf`;
}

/**
 * Escapes unsafe HTML characters to prevent XSS and formatting corruption.
 */
export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats a numeric value into the Indian Rupee currency string (₹ XX,XXX.XX).
 */
export function formatInr(amount: number | undefined | null): string {
  const num = Number(amount) || 0;
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats date into a clean readable string (e.g. 02 Nov 2026, 04:30 PM).
 */
export function formatDateTime(dateStr: string | undefined | null): { date: string; time: string } {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) {
      return { date: dateStr || 'N/A', time: '' };
    }
    const dateFormatted = d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timeFormatted = d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return { date: dateFormatted, time: timeFormatted };
  } catch {
    return { date: dateStr || 'N/A', time: '' };
  }
}

/**
 * Generates a complete, self-contained, print-ready HTML document for an invoice.
 */
export function generateBillHtml(inv: InvoicePrintData): string {
  const safeInvoiceId = escapeHtml(inv.invoiceId || 'INV-001');
  const { date: formattedDate, time: formattedTime } = formatDateTime(inv.date);
  const safeCustomerName = escapeHtml(inv.customerName || 'Retail Customer');
  const safeCustomerPhone = escapeHtml(inv.customerPhone || '');
  const safeCustomerGst = escapeHtml(inv.customerGst || '');
  const safeCustomerAddress = escapeHtml(inv.customerAddress || '');
  const safeCreatedBy = escapeHtml(inv.createdByName || '');
  const safeTxnRef = escapeHtml(inv.txnRef || '');

  const shopName = escapeHtml(inv.shopName || 'Tilor Tiles & Ceramics');
  const shopAddress = escapeHtml(inv.shopAddress || 'Tile & Sanitaryware Commercial Hub, Main Ring Road');
  const shopPhone = escapeHtml(inv.shopPhone || '+91 98765 43210');
  const shopEmail = escapeHtml(inv.shopEmail || 'support@tilor.app');
  const shopGst = escapeHtml(inv.shopGst || '27AABCT9981A1ZP');

  const subtotal = Number(inv.subtotal) || 0;
  const discount = Number(inv.discount) || 0;
  const gst = Number(inv.gst) || 0;
  const total = Number(inv.total) || (subtotal - discount + gst);
  const paymentMethod = (inv.paymentMethod || 'cash').toUpperCase();
  const isCredit = inv.paymentMethod === 'credit' || !!inv.creditDetail;
  const isGstBill = gst > 0;

  // Status Badge
  let statusBadgeHtml = '';
  if (isCredit && inv.creditDetail && inv.creditDetail.debt > 0) {
    statusBadgeHtml = `
      <span class="badge badge-amber">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        PARTIALLY PAID / CREDIT
      </span>`;
  } else {
    statusBadgeHtml = `
      <span class="badge badge-emerald">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        PAID IN FULL
      </span>`;
  }

  // Tax Breakdown Rows
  let taxRowsHtml = '';
  if (isGstBill) {
    if (inv.gstType === 'igst') {
      taxRowsHtml = `
        <div class="summary-row">
          <span class="summary-label">Integrated GST (18%)</span>
          <span class="summary-val font-mono">${formatInr(gst)}</span>
        </div>`;
    } else {
      const halfGst = gst / 2;
      taxRowsHtml = `
        <div class="summary-row">
          <span class="summary-label">CGST (9%)</span>
          <span class="summary-val font-mono">${formatInr(halfGst)}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">SGST (9%)</span>
          <span class="summary-val font-mono">${formatInr(halfGst)}</span>
        </div>`;
    }
  } else {
    taxRowsHtml = `
      <div class="summary-row">
        <span class="summary-label">Tax (Non-GST Retail)</span>
        <span class="summary-val font-mono">₹0.00</span>
      </div>`;
  }

  // Items Rows
  const items = Array.isArray(inv.items) ? inv.items : [];
  const itemsRowsHtml = items.map((item, index) => {
    const safeName = escapeHtml(item.name || 'Tile Item');
    const safeVariant = item.variantLabel ? escapeHtml(item.variantLabel) : '';
    const safeBrand = item.brand ? escapeHtml(item.brand) : '';
    const safeSize = item.size ? escapeHtml(item.size) : '';
    const safeRoom = item.roomName ? escapeHtml(item.roomName) : '';
    const boxes = Number(item.boxes) || 1;
    const pricePerBox = Number(item.pricePerBox) || 0;
    const rowTotal = Number(item.total) || (boxes * pricePerBox);

    // Compute sqft & tiles with reliable fallbacks
    const itemSqft = item.sqft !== undefined
      ? item.sqft
      : (item.sqftPerBox ? Math.round(boxes * item.sqftPerBox * 10) / 10 : (item.size?.includes('12') ? boxes * 9 : boxes * 16));
    const itemTiles = item.tiles !== undefined
      ? item.tiles
      : (item.tilesPerBox ? boxes * item.tilesPerBox : (item.size?.includes('12') ? boxes * 6 : boxes * 4));

    // Build specification pills
    const pills: string[] = [];
    if (safeVariant) pills.push(`<span class="item-tag item-tag-variant">${safeVariant}</span>`);
    if (safeSize) pills.push(`<span class="item-tag">${safeSize}</span>`);
    if (itemSqft) pills.push(`<span class="item-tag item-tag-metric">📐 ${itemSqft} sq.ft</span>`);
    if (itemTiles) pills.push(`<span class="item-tag item-tag-metric">🧱 ${itemTiles} tiles</span>`);
    if (safeBrand) pills.push(`<span class="item-tag item-tag-brand">Brand: ${safeBrand}</span>`);

    return `
      <tr>
        <td class="col-num">${index + 1}</td>
        <td class="col-desc">
          <div class="item-room-badge"><span class="room-pin">🏠</span> <span class="room-text">${(safeRoom || 'GENERAL ROOM').toUpperCase()}</span></div>
          <div class="item-title">${safeName}</div>
          ${pills.length > 0 ? `<div class="item-tags">${pills.join(' ')}</div>` : ''}
        </td>
        <td class="col-boxes font-mono">${boxes} bx</td>
        <td class="col-rate font-mono">${formatInr(pricePerBox)}</td>
        <td class="col-total font-mono">${formatInr(rowTotal)}</td>
      </tr>`;
  }).join('');

  // Fallback empty item if list is empty
  const renderedItemsHtml = itemsRowsHtml || `
    <tr>
      <td colspan="5" style="text-align:center; padding: 24px; color: #94A3B8;">
        No product items listed in this invoice.
      </td>
    </tr>`;

  // Khatabook Ledger Block
  let khatabookBlockHtml = '';
  if (isCredit && inv.creditDetail) {
    const depositPaid = Number(inv.creditDetail.depositPaid) || 0;
    const debt = Number(inv.creditDetail.debt) || 0;
    const safeDueDate = escapeHtml(inv.creditDetail.dueDate || 'In 30 days');

    khatabookBlockHtml = `
      <div class="khatabook-box no-break">
        <div class="khatabook-header">
          <div class="khatabook-title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            KHATABOOK CREDIT LEDGER
          </div>
          <span class="khatabook-due">Due: <strong>${safeDueDate}</strong></span>
        </div>
        <div class="khatabook-grid">
          <div class="khatabook-card card-paid">
            <div class="khatabook-card-label">Deposit Collected</div>
            <div class="khatabook-card-val font-mono">${formatInr(depositPaid)}</div>
            <div class="khatabook-card-sub">Recorded to cash/bank ledger</div>
          </div>
          <div class="khatabook-card card-debt">
            <div class="khatabook-card-label">Outstanding Debt Balance</div>
            <div class="khatabook-card-val font-mono">${formatInr(debt)}</div>
            <div class="khatabook-card-sub">Remaining balance to collect</div>
          </div>
        </div>
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice - ${safeInvoiceId}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ─── Global Reset & Variables ─────────────────────────────────────── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }

    :root {
      --primary: #7C3AED;
      --primary-dark: #6D28D9;
      --primary-subtle: #F5F3FF;
      --primary-border: #E9D5FF;
      --text-main: #0F172A;
      --text-body: #334155;
      --text-muted: #64748B;
      --text-light: #94A3B8;
      --border: #E2E8F0;
      --border-subtle: #EDF2F7;
      --bg-light: #F8FAFC;
      --emerald: #059669;
      --emerald-bg: #ECFDF5;
      --rose: #E11D48;
      --rose-bg: #FFF1F2;
      --amber: #B45309;
      --amber-bg: #FEF3C7;
    }

    @page {
      size: A4 portrait;
      margin: 12mm 14mm 14mm 14mm;
    }

    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text-body);
      background-color: #FFFFFF;
      margin: 0;
      padding: 0;
    }

    .font-mono {
      font-family: 'JetBrains Mono', Consolas, Monaco, "Courier New", monospace;
    }

    .invoice-container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      background: #FFFFFF;
    }

    /* ─── Header Section ──────────────────────────────────────────────── */
    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--border);
      padding-bottom: 18px;
      margin-bottom: 18px;
      gap: 16px;
    }

    .brand-section {
      flex: 1;
      max-width: 58%;
    }

    .brand-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }

    .brand-logo {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      box-shadow: 0 4px 10px rgba(124, 58, 237, 0.25);
    }

    .brand-title {
      font-size: 20px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.4px;
    }

    .brand-title span {
      color: var(--primary);
    }

    .brand-tagline {
      font-size: 11px;
      font-weight: 600;
      color: var(--primary-dark);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 6px;
    }

    .brand-details {
      font-size: 10.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .meta-section {
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      min-width: 200px;
    }

    .invoice-type {
      font-size: 20px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.3px;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    .invoice-number {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 6px;
    }

    .invoice-dates {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .badge-emerald {
      background: var(--emerald-bg);
      color: var(--emerald);
      border: 1px solid #A7F3D0;
    }

    .badge-amber {
      background: var(--amber-bg);
      color: var(--amber);
      border: 1px solid #FDE68A;
    }

    /* ─── Info Blocks (Customer & Invoice Metadata) ───────────────────── */
    .info-grid {
      display: flex;
      gap: 16px;
      margin-bottom: 18px;
    }

    .info-card {
      flex: 1;
      background: var(--bg-light);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
    }

    .info-card-title {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: var(--text-light);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .info-customer-name {
      font-size: 14px;
      font-weight: 800;
      color: var(--text-main);
      margin-bottom: 4px;
    }

    .info-line {
      font-size: 11px;
      color: var(--text-body);
      line-height: 1.5;
    }

    .info-line strong {
      color: var(--text-main);
    }

    /* ─── Product Table ──────────────────────────────────────────────── */
    .table-container {
      width: 100%;
      margin-bottom: 18px;
    }

    table.items-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    table.items-table thead {
      display: table-header-group;
      background: var(--primary-subtle);
    }

    table.items-table th {
      color: var(--primary-dark);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--primary-border);
      text-align: left;
    }

    table.items-table tbody tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    table.items-table tbody tr:nth-child(even) {
      background-color: #FAFAFC;
    }

    table.items-table td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 11.5px;
      vertical-align: middle;
      color: var(--text-body);
    }

    table.items-table tbody tr:last-child td {
      border-bottom: none;
    }

    .col-num {
      width: 5%;
      text-align: center;
      font-weight: 600;
      color: var(--text-light);
    }

    .col-desc {
      width: 48%;
    }

    .col-boxes {
      width: 15%;
      text-align: center;
      font-weight: 600;
    }

    .col-rate {
      width: 16%;
      text-align: right;
      font-weight: 600;
    }

    .col-total {
      width: 16%;
      text-align: right;
      font-weight: 700;
      color: var(--text-main);
    }

    .item-room-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #F3E8FF;
      border: 1px solid #DDD6FE;
      color: #6D28D9;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.5px;
      padding: 2px 7px;
      border-radius: 4px;
      margin-bottom: 3px;
    }

    .item-room-badge .room-pin {
      font-size: 9.5px;
    }

    .item-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 2px;
    }

    .item-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 3px;
    }

    .item-tag {
      font-size: 9.5px;
      font-weight: 600;
      background: #EDF2F7;
      color: #475569;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .item-tag-room {
      background: #F3E8FF;
      color: #6D28D9;
      border: 1px solid #E9D5FF;
    }

    .item-tag-variant {
      background: #FEF3C7;
      color: #92400E;
      border: 1px solid #FDE68A;
      font-weight: 700;
    }

    .item-tag-metric {
      background: #EDE9FE;
      color: #5B21B6;
      border: 1px solid #DDD6FE;
      font-weight: 700;
      text-transform: none;
    }

    .item-tag-brand {
      background: #F8FAFC;
      color: #64748B;
      border: 1px solid #E2E8F0;
      font-weight: 500;
      text-transform: none;
    }

    /* ─── Financial Breakdown & Summary ───────────────────────────────── */
    .summary-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      margin-bottom: 18px;
    }

    .left-side {
      flex: 1.1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .right-side {
      flex: 0.9;
      min-width: 260px;
    }

    .summary-card {
      background: #FFFFFF;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 16px;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 0;
      font-size: 11.5px;
      color: var(--text-muted);
    }

    .summary-val {
      font-weight: 600;
      color: var(--text-main);
    }

    .summary-discount {
      color: var(--emerald);
      font-weight: 700;
    }

    .grand-total-box {
      margin-top: 8px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%);
      border-radius: 10px;
      color: #FFFFFF;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25);
    }

    .grand-total-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .grand-total-val {
      font-size: 19px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }

    /* ─── Khatabook Ledger Box ────────────────────────────────────────── */
    .khatabook-box {
      background: #FAF5FF;
      border: 1.5px solid var(--primary-border);
      border-radius: 12px;
      padding: 12px 14px;
    }

    .khatabook-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .khatabook-title {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--primary-dark);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .khatabook-due {
      font-size: 10px;
      color: var(--text-muted);
    }

    .khatabook-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .khatabook-card {
      background: #FFFFFF;
      border-radius: 8px;
      padding: 8px 10px;
      border: 1px solid var(--border);
    }

    .card-paid {
      border-color: #A7F3D0;
      background: #F0FDF4;
    }

    .card-debt {
      border-color: #FECDD3;
      background: #FFF1F2;
    }

    .khatabook-card-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    .card-paid .khatabook-card-label { color: #059669; }
    .card-debt .khatabook-card-label { color: #E11D48; }

    .khatabook-card-val {
      font-size: 14px;
      font-weight: 800;
    }

    .card-paid .khatabook-card-val { color: #059669; }
    .card-debt .khatabook-card-val { color: #E11D48; }

    .khatabook-card-sub {
      font-size: 9px;
      color: var(--text-muted);
      margin-top: 1px;
    }

    /* ─── Payment Details & Terms ─────────────────────────────────────── */
    .payment-note-card {
      background: var(--bg-light);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 10.5px;
      line-height: 1.5;
    }

    .terms-box {
      font-size: 9.5px;
      color: var(--text-muted);
      line-height: 1.45;
    }

    .terms-box ol {
      padding-left: 14px;
      margin-top: 3px;
    }

    /* ─── Footer Section ──────────────────────────────────────────────── */
    .invoice-footer {
      border-top: 1px dashed var(--border);
      padding-top: 14px;
      margin-top: 14px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 9.5px;
      color: var(--text-light);
      page-break-inside: avoid;
    }

    .signatory-box {
      text-align: right;
    }

    .signatory-line {
      width: 140px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 4px;
      margin-left: auto;
    }

    .no-break {
      page-break-inside: avoid;
    }

    @media print {
      body {
        background: #FFFFFF !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .invoice-container {
        max-width: 100% !important;
        box-shadow: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    
    <!-- ── Header ─────────────────────────────────────────────── -->
    <header class="invoice-header">
      <div class="brand-section">
        <div class="brand-header">
          <div class="brand-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="8" height="8" rx="2"></rect>
              <rect x="13" y="3" width="8" height="8" rx="2"></rect>
              <rect x="3" y="13" width="8" height="8" rx="2"></rect>
              <rect x="13" y="13" width="8" height="8" rx="2"></rect>
            </svg>
          </div>
          <div class="brand-title">Tilor<span>.</span></div>
        </div>
        <div class="brand-tagline">${shopName}</div>
        <div class="brand-details">
          ${shopAddress}<br>
          Phone: ${shopPhone} &bull; Email: ${shopEmail}<br>
          <strong>GSTIN:</strong> ${shopGst}
        </div>
      </div>

      <div class="meta-section">
        <div class="invoice-type">${isGstBill ? 'Tax Invoice' : 'Retail Invoice'}</div>
        <div class="invoice-number font-mono">#${safeInvoiceId}</div>
        <div class="invoice-dates">
          <span>Date: <strong>${formattedDate}</strong></span>
          ${formattedTime ? `<span> &bull; ${formattedTime}</span>` : ''}
        </div>
        ${statusBadgeHtml}
      </div>
    </header>

    <!-- ── Customer & Dispatch Info ───────────────────────────── -->
    <section class="info-grid no-break">
      <div class="info-card">
        <div class="info-card-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Bill To / Customer Details
        </div>
        <div class="info-customer-name">${safeCustomerName}</div>
        <div class="info-line">
          ${safeCustomerPhone ? `<strong>Phone:</strong> +91 ${safeCustomerPhone}` : '<strong>Phone:</strong> N/A'}
        </div>
        ${safeCustomerAddress ? `<div class="info-line"><strong>Address:</strong> ${safeCustomerAddress}</div>` : ''}
        ${safeCustomerGst ? `<div class="info-line"><strong>GSTIN:</strong> <span class="font-mono">${safeCustomerGst}</span></div>` : ''}
      </div>

      <div class="info-card">
        <div class="info-card-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
          Payment & Transaction Info
        </div>
        <div class="info-line"><strong>Payment Method:</strong> ${paymentMethod}</div>
        ${safeTxnRef ? `<div class="info-line"><strong>Txn / UTR Ref:</strong> <span class="font-mono">${safeTxnRef}</span></div>` : ''}
        ${safeCreatedBy ? `<div class="info-line"><strong>Billed By:</strong> ${safeCreatedBy}</div>` : ''}
        <div class="info-line"><strong>Supply Type:</strong> ${isGstBill ? 'B2B / Taxable Supply' : 'Direct Consumer Retail'}</div>
      </div>
    </section>

    <!-- ── Items Table ────────────────────────────────────────── -->
    <div class="table-container">
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-num">#</th>
            <th class="col-desc">Item Description & Specifications</th>
            <th class="col-boxes">Boxes</th>
            <th class="col-rate">Rate / Box</th>
            <th class="col-total">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${renderedItemsHtml}
        </tbody>
      </table>
    </div>

    <!-- ── Summary & Ledger ───────────────────────────────────── -->
    <section class="summary-section no-break">
      <div class="left-side">
        ${khatabookBlockHtml}

        <div class="terms-box">
          <strong>Terms & Conditions:</strong>
          <ol>
            <li>Goods once sold will not be accepted or exchanged without the original bill.</li>
            <li>Please inspect batch, color, and shade uniformity prior to tile fixing. No claims entertained thereafter.</li>
            <li>All disputes are subject to local merchant jurisdiction.</li>
          </ol>
        </div>
      </div>

      <div class="right-side">
        <div class="summary-card">
          <div class="summary-row">
            <span class="summary-label">Items Subtotal</span>
            <span class="summary-val font-mono">${formatInr(subtotal)}</span>
          </div>

          ${discount > 0 ? `
            <div class="summary-row">
              <span class="summary-label">Promotional Discount</span>
              <span class="summary-val summary-discount font-mono">- ${formatInr(discount)}</span>
            </div>` : ''}

          ${taxRowsHtml}

          <div class="grand-total-box">
            <span class="grand-total-label">Grand Total</span>
            <span class="grand-total-val font-mono">${formatInr(total)}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Footer ─────────────────────────────────────────────── -->
    <footer class="invoice-footer">
      <div>
        <strong>Tilor Store Billing Suite</strong> &bull; Authenticated Digital Invoice &bull; Thank you for your business!
      </div>
      <div class="signatory-box">
        <div class="signatory-line"></div>
        <div>Authorized Signatory</div>
      </div>
    </footer>

  </div>
</body>
</html>`;
}
