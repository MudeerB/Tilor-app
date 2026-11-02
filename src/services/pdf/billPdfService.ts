/**
 * src/services/pdf/billPdfService.ts
 *
 * Senior React Native service for generating genuine PDF documents and sharing them
 * natively on Android, iOS, and Web.
 *
 * Workflow:
 * 1. Validates structured invoice data.
 * 2. Generates semantic HTML using billHtmlTemplate.
 * 3. Compiles HTML into genuine binary PDF via expo-print (Print.printToFileAsync).
 * 4. Assigns predictable, clean filename (e.g. Invoice_INV_2026_001.pdf).
 * 5. Validates file existence and binary header signature (%PDF-).
 * 6. Invokes Android native share sheet via expo-sharing (Sharing.shareAsync).
 */

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { generateBillHtml, InvoicePrintData, sanitizePdfFilename } from './billHtmlTemplate';

export { sanitizePdfFilename };

export interface GeneratePdfOptions {
  customFilename?: string;
  dialogTitle?: string;
}

export interface PdfGenerationResult {
  success: boolean;
  uri?: string;
  numberOfPages?: number;
  error?: string;
}

class BillPdfService {
  private isProcessing = false;

  /**
   * Determines if native file sharing is available on current runtime.
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await Sharing.isAvailableAsync();
    } catch {
      return false;
    }
  }

  /**
   * Generates a genuine PDF file from invoice data and saves it to app cache.
   * Returns verified file URI and page count.
   */
  async generatePdfFile(
    invoice: InvoicePrintData,
    options?: GeneratePdfOptions
  ): Promise<{ uri: string; numberOfPages: number }> {
    if (!invoice) {
      throw new Error('Cannot generate PDF: Invoice data is missing.');
    }

    // 1. Generate clean HTML template
    const html = generateBillHtml(invoice);

    // 2. Generate actual PDF file via Expo Print
    const result = await Print.printToFileAsync({
      html,
    });

    if (!result || !result.uri) {
      throw new Error('PDF Generation failed: printToFileAsync returned an empty URI.');
    }

    let finalUri = result.uri;
    const safeFilename = options?.customFilename || sanitizePdfFilename(invoice.invoiceId);

    // 3. Rename/copy to human-readable filename on native platforms
    if (Platform.OS !== 'web') {
      try {
        const sourceFile = new File(result.uri);
        const destinationFile = new File(Paths.cache, safeFilename);

        // Remove old file with the same name if exists
        if (destinationFile.exists) {
          try {
            destinationFile.delete();
          } catch (delErr) {
            console.warn('[BillPdfService] Could not remove existing file at destination:', delErr);
          }
        }

        // Copy source to predictable destination
        await sourceFile.copy(destinationFile);

        if (destinationFile.exists && destinationFile.size > 0) {
          finalUri = destinationFile.uri;
        }
      } catch (fileErr) {
        console.warn('[BillPdfService] Could not rename file in cache, retaining original URI:', fileErr);
      }

      // 4. Validate file existence and verify binary %PDF- header
      try {
        const checkFile = new File(finalUri);
        if (!checkFile.exists || checkFile.size === 0) {
          throw new Error('Generated PDF file is missing or has 0 bytes.');
        }

        // Validate %PDF- file signature (first 5 bytes must be 0x25, 0x50, 0x44, 0x46, 0x2D)
        const bytes = await checkFile.bytes();
        const header = String.fromCharCode(...bytes.slice(0, 5));
        if (!header.startsWith('%PDF-')) {
          throw new Error(`Generated file is corrupted or not a real PDF (header was: "${header}")`);
        }
      } catch (validationErr: any) {
        // If file system inspection fails specifically, log and rethrow
        console.error('[BillPdfService] PDF Signature verification failed:', validationErr);
        throw new Error(validationErr.message || 'PDF verification failed.');
      }
    }

    return {
      uri: finalUri,
      numberOfPages: result.numberOfPages || 1,
    };
  }

  /**
   * Shares the generated PDF file using the platform's native share sheet (WhatsApp, Gmail, Drive).
   */
  async sharePdf(uri: string, dialogTitle: string = 'Share Bill'): Promise<void> {
    if (!uri) {
      throw new Error('No PDF URI provided to share.');
    }

    if (Platform.OS === 'web') {
      const isShareAvailable = await this.isAvailable();
      if (isShareAvailable) {
        try {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle,
          });
          return;
        } catch {
          // Fall through to window print/download on web
        }
      }
      if (typeof window !== 'undefined') {
        const win = window.open(uri, '_blank');
        if (!win) {
          window.location.href = uri;
        }
      }
      return;
    }

    // Native Android & iOS sharing
    const isShareAvailable = await this.isAvailable();
    if (!isShareAvailable) {
      throw new Error('Sharing is not supported on this device.');
    }

    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle,
      UTI: '.pdf',
    });
  }

  /**
   * Complete atomic flow: generates genuine PDF and opens Android/iOS native share sheet.
   * Concurrency-guarded to prevent duplicate triggers from rapid button taps.
   */
  async generateAndShare(
    invoice: InvoicePrintData,
    options?: GeneratePdfOptions
  ): Promise<PdfGenerationResult> {
    if (this.isProcessing) {
      return { success: false, error: 'PDF generation is already in progress.' };
    }

    this.isProcessing = true;
    try {
      const dialogTitle = options?.dialogTitle || `Share Invoice #${invoice.invoiceId || ''}`.trim();
      const { uri, numberOfPages } = await this.generatePdfFile(invoice, options);

      await this.sharePdf(uri, dialogTitle);

      return {
        success: true,
        uri,
        numberOfPages,
      };
    } catch (err: any) {
      console.error('[BillPdfService] generateAndShare error:', err);
      return {
        success: false,
        error: err?.message || 'An unexpected error occurred while generating or sharing the bill.',
      };
    } finally {
      this.isProcessing = false;
    }
  }
}

export const billPdfService = new BillPdfService();
