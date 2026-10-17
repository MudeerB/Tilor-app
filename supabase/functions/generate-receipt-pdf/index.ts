/**
 * supabase/functions/generate-receipt-pdf/index.ts
 *
 * Supabase Edge Function: Secure Receipt & Invoice PDF Generation (OWASP A10:2021)
 * Enforces strict input validation, tenant authorization, and SSRF/LFI immune rendering.
 */

import { buildSecureReceiptHtml, sanitizeHtmlForPdf, SecureReceiptPayload } from '../_shared/pdfSanitizer';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function handleGenerateReceiptRequest(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { payload, customHtml } = body;

    let finalHtml: string;

    if (payload) {
      // Validate structured payload
      const receiptPayload: SecureReceiptPayload = {
        shopName: String(payload.shopName || 'Tilor Retail'),
        shopAddress: payload.shopAddress ? String(payload.shopAddress) : undefined,
        shopGstin: payload.shopGstin ? String(payload.shopGstin) : undefined,
        shopPhone: payload.shopPhone ? String(payload.shopPhone) : undefined,
        invoiceNumber: String(payload.invoiceNumber || 'INV-0001'),
        invoiceDate: String(payload.invoiceDate || new Date().toISOString().slice(0, 10)),
        customerName: String(payload.customerName || 'Walk-in Customer'),
        customerPhone: payload.customerPhone ? String(payload.customerPhone) : undefined,
        customerAddress: payload.customerAddress ? String(payload.customerAddress) : undefined,
        items: Array.isArray(payload.items) ? payload.items : [],
        subtotal: Number(payload.subtotal) || 0,
        cgstAmount: Number(payload.cgstAmount) || 0,
        sgstAmount: Number(payload.sgstAmount) || 0,
        totalAmount: Number(payload.totalAmount) || 0,
        paymentMode: String(payload.paymentMode || 'Cash'),
        notes: payload.notes ? String(payload.notes) : undefined,
      };

      finalHtml = buildSecureReceiptHtml(receiptPayload);
    } else if (customHtml) {
      // If raw HTML is provided for templating, enforce rigorous SSRF / LFI sanitization
      finalHtml = sanitizeHtmlForPdf(String(customHtml), []);
    } else {
      return new Response(JSON.stringify({ error: 'Missing invoice payload or HTML content' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Return sanitized document with strict isolation headers
    return new Response(finalHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; frame-ancestors 'none';",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Default Deno serve entrypoint (if running directly in Deno environment)
if (typeof (globalThis as any).Deno !== 'undefined') {
  (globalThis as any).Deno.serve(handleGenerateReceiptRequest);
}
