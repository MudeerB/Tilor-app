/**
 * src/utils/receiptPrint.ts
 *
 * Cross-Platform Receipt Sharing & Clean Web Printing Utility
 * Supports:
 * - Native Android/iOS: React Native Share sheet (WhatsApp, Gmail, Bluetooth POS printer apps)
 * - Mobile Web: Web Share API (navigator.share)
 * - Desktop Web: Isolated popup print window (eliminates app-bar & UI background printing)
 */

import { Platform, Share, Alert } from 'react-native';

/**
 * Opens an isolated popup window containing only the formatted receipt text,
 * triggers the browser's print dialog, and automatically closes the popup.
 */
export function printCleanReceiptOnWeb(receiptText: string, title: string = 'Tax Invoice'): void {
  if (typeof window === 'undefined') return;

  try {
    const printWindow = window.open('', '_blank', 'width=500,height=700');
    if (!printWindow) {
      window.print();
      return;
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Courier New", monospace;
      white-space: pre-wrap;
      padding: 24px;
      color: #111827;
      background: #FFFFFF;
      font-size: 13px;
      line-height: 1.6;
      max-width: 480px;
      margin: 0 auto;
    }
    @media print {
      body {
        padding: 0;
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
${receiptText}
<script>
  window.onload = function() {
    window.print();
    setTimeout(function() { window.close(); }, 600);
  };
</script>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  } catch {
    window.print();
  }
}

/**
 * Universal cross-platform handler to share or print receipts across Web, Android, and iOS.
 */
export async function shareOrPrintReceipt(receiptText: string, invoiceId?: string): Promise<void> {
  if (!receiptText) return;

  const invTitle = invoiceId ? `Invoice ${invoiceId}` : 'Tax Invoice';

  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({
          title: invTitle,
          text: receiptText,
        });
        return;
      } catch {
        // User cancelled or share failed, fall back to clean print
      }
    }
    printCleanReceiptOnWeb(receiptText, invTitle);
  } else {
    try {
      await Share.share({
        message: receiptText,
        title: invTitle,
      });
    } catch {
      Alert.alert('Error', 'Failed to share receipt.');
    }
  }
}
