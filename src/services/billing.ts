/**
 * src/services/billing.ts
 *
 * Service layer for Invoices, Billing, Customer CRM sync, and Stock Deductions via Supabase.
 */

import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { catalogService } from './catalog';
import { activityLogService } from './activityLog';
import { dataCache } from './dataCache';
import { CartItem, Customer } from '../screens/BillingScreen';
import {
  sanitizeCustomerName,
  sanitizeAddress,
  sanitizeTxnRef,
  sanitizeReceiptField,
} from '../utils/sanitize';

const OFFLINE_INVOICE_QUEUE_KEY = 'tilor_offline_invoice_queue';

export interface CreateInvoicePayload {
  shopId: string;
  idempotencyKey?: string;
  customerName: string;
  customerPhone: string;
  customerGst: string;
  customerAddress: string;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  gstAmount: number;
  isGst?: boolean;
  gstType: 'cgst_sgst' | 'igst' | 'none';
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'upi' | 'credit';
  isCredit: boolean;
  creditDeposit: number;
  creditDebt: number;
  creditDueDate?: string;
  txnRef: string;
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  requiresLoading?: boolean;
  assignedTo?: string;
  assignedToName?: string;
}

export const billingService = {
  /**
   * Invalidates memory cache for invoices, metrics, debtors, etc.
   */
  invalidateCache(shopId?: string): void {
    if (shopId) {
      dataCache.invalidate(`invoices_${shopId}`);
      dataCache.invalidate(`dashboard_metrics_${shopId}`);
      dataCache.invalidate(`debtors_${shopId}`);
      dataCache.invalidate(`customers_${shopId}`);
    } else {
      dataCache.invalidate('invoices');
      dataCache.invalidate('dashboard_metrics');
      dataCache.invalidate('debtors');
      dataCache.invalidate('customers');
    }
  },

  /**
   * Generates atomic invoice number from Supabase stored procedure in format: INV-DDMMYY-001
   */
  async generateInvoiceNumber(shopId: string): Promise<string> {
    try {
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '');
        const randomNum = Math.floor(100 + Math.random() * 900);
        return `INV-${dateStr}-${randomNum}`;
      }

      const { data, error } = await supabase.rpc('generate_invoice_number', {
        p_shop_id: shopId,
      });

      if (error || !data) {
        const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '');
        const randomNum = Math.floor(100 + Math.random() * 900);
        return `INV-${dateStr}-${randomNum}`;
      }

      return String(data);
    } catch {
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '');
      const randomNum = Math.floor(100 + Math.random() * 900);
      return `INV-${dateStr}-${randomNum}`;
    }
  },

  /**
   * Creates Invoice in Supabase, deducts stock via FOR UPDATE RPC, and syncs Customer CRM profile.
   */
  async createInvoice(
    payload: CreateInvoicePayload
  ): Promise<{ success: boolean; invoiceNumber?: string; invoiceRecord?: any; error?: string }> {
    try {
      const sanitizedPayload = {
        ...payload,
        customerName: sanitizeCustomerName(payload.customerName),
        customerAddress: sanitizeAddress(payload.customerAddress),
        txnRef: sanitizeTxnRef(payload.txnRef),
      };

      // Execute the entire checkout atomically on the server
      const { data, error } = await supabase.rpc('process_checkout', { p_payload: sanitizedPayload });

      if (error || !data || !data.success) {
        console.error('process_checkout RPC Error Details:');
        console.error('Error Code:', error?.code);
        console.error('Error Message:', error?.message);
        console.error('Error Details:', error?.details);
        console.error('Error Hint:', error?.hint);
        console.error('Raw Error:', JSON.stringify(error, null, 2));
        console.error('RPC Data:', JSON.stringify(data, null, 2));
        console.error('Payload Sent:', JSON.stringify(sanitizedPayload, null, 2));
        return { success: false, error: error?.message || data?.error || 'Failed to process checkout securely.' };
      }

      const invoiceNumber = data.invoiceNumber;
      const invoiceId = data.invoiceId;
      const trueTotal = data.totalCalculated;

      const invoiceRecord = {
        invoiceId: invoiceNumber,
        dbId: invoiceId,
        date: new Date().toISOString(),
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerGst: payload.customerGst,
        customerAddress: payload.customerAddress,
        items: payload.items.map(i => ({
          name: i.name,
          variantLabel: i.variantLabel,
          brand: i.brand,
          size: i.size,
          boxes: i.boxes,
          pricePerBox: i.pricePerBox,
          total: i.boxes * i.pricePerBox,
        })),
        subtotal: payload.subtotal,
        discount: payload.discountAmount,
        gst: payload.gstAmount,
        gstType: payload.gstType,
        total: trueTotal, // Trust the server-calculated total
        paymentMethod: payload.paymentMethod,
        creditDetail: payload.isCredit
          ? {
              depositPaid: payload.creditDeposit,
              debt: trueTotal - (payload.creditDeposit || 0),
              dueDate: payload.creditDueDate || 'In 30 days',
              repayments: [],
            }
          : null,
        txnRef: payload.txnRef,
      };

      // Log Activity
      await activityLogService.logActivity({
        shopId: payload.shopId,
        userId: payload.createdBy,
        userName: payload.createdByName,
        userRole: payload.createdByRole,
        entityType: 'invoice',
        entityId: invoiceId,
        entityName: invoiceNumber,
        action: 'created',
        details: {
          totalAmount: trueTotal,
          customerName: payload.customerName,
          paymentMethod: payload.paymentMethod,
        }
      });

      // Invalidate relevant caches
      dataCache.invalidate(`invoices_${payload.shopId}`);
      dataCache.invalidate(`dashboard_metrics_${payload.shopId}`);
      dataCache.invalidate(`debtors_${payload.shopId}`);
      dataCache.invalidate(`catalog_${payload.shopId}`);
      dataCache.invalidate(`customers_${payload.shopId}`);

      return { success: true, invoiceNumber, invoiceRecord };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to process checkout.' };
    }
  },

  /**
   * Search Customer CRM database by 10-digit phone number.
   */
  async findCustomerByPhone(shopId: string, phone: string): Promise<Customer | null> {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('phone', phone.trim())
        .maybeSingle();

      if (error || !data) return null;

      return {
        name: data.name,
        phone: data.phone,
        address: data.address || '',
        gstin: data.gstin || '',
        history: [],
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetches all sales invoices with line items for a shop from Supabase.
   * Utilizes in-memory SWR caching (60s TTL) with Promise deduplication.
   */
  async fetchInvoices(shopId: string, forceRefresh: boolean = false): Promise<any[]> {
    const cacheKey = `invoices_${shopId}`;
    if (forceRefresh) {
      dataCache.invalidate(cacheKey);
    }
    return dataCache.executeSWR(
      cacheKey,
      () => this.fetchInvoicesFromDb(shopId),
      60000
    );
  },

  async fetchInvoicesFromDb(shopId: string): Promise<any[]> {
    try {
      const { data: dbInvoices, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          created_at,
          customer_name,
          customer_phone,
          customer_gst,
          customer_address,
          subtotal,
          discount_amount,
          gst_amount,
          gst_type,
          total_amount,
          payment_method,
          is_credit,
          credit_deposit,
          credit_debt,
          credit_due_date,
          txn_ref,
          is_voided,
          voided_at,
          repayments,
          loading_status,
          assigned_to,
          assigned_to_name,
          total_boxes_billed,
          total_boxes_loaded,
          users!invoices_created_by_fkey ( full_name, email ),
          invoice_items (
            id,
            tile_name,
            variant_label,
            brand,
            size,
            boxes,
            price_per_box,
            total_amount
          )
        `)
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      if (error || !dbInvoices) {
        console.error('Error fetching invoices from Supabase:', error);
        return [];
      }

      return dbInvoices.map((inv: any) => ({
        dbId: inv.id,
        invoiceId: inv.invoice_number,
        date: inv.created_at,
        customerName: inv.customer_name || 'Walk-in Customer',
        customerPhone: inv.customer_phone || '',
        customerGst: inv.customer_gst || '',
        customerAddress: inv.customer_address || '',
        items: (inv.invoice_items || []).map((item: any) => ({
          name: item.tile_name,
          variantLabel: item.variant_label,
          brand: item.brand,
          size: item.size,
          boxes: Number(item.boxes) || 0,
          pricePerBox: Number(item.price_per_box) || 0,
          total: Number(item.total_amount) || 0,
        })),
        subtotal: Number(inv.subtotal) || 0,
        discount: Number(inv.discount_amount) || 0,
        gst: Number(inv.gst_amount) || 0,
        gstType: inv.gst_type || 'cgst_sgst',
        total: Number(inv.total_amount) || 0,
        paymentMethod: inv.payment_method || 'cash',
        isVoided: Boolean(inv.is_voided),
        voidedAt: inv.voided_at,
        creditDetail: inv.is_credit || inv.payment_method === 'credit'
          ? {
              depositPaid: Number(inv.credit_deposit) || 0,
              debt: Number(inv.credit_debt) || 0,
              dueDate: inv.credit_due_date || 'N/A',
              repayments: Array.isArray(inv.repayments) ? inv.repayments : [],
            }
          : null,
        txnRef: inv.txn_ref || '',
        createdByName: inv.users?.full_name || inv.users?.email || 'User',
        loadingStatus: inv.loading_status || 'not_required',
        assignedTo: inv.assigned_to,
        assignedToName: inv.assigned_to_name,
        totalBoxesBilled: Number(inv.total_boxes_billed) || 0,
        totalBoxesLoaded: Number(inv.total_boxes_loaded) || 0,
      }));
    } catch (e) {
      console.error('Failed to fetch invoices:', e);
      return [];
    }
  },

  /**
   * Records a partial or full repayment for a credit debt invoice.
   */
  async recordRepayment(
    invoiceDbId: string,
    amount: number,
    mode: string,
    dateStr: string
  ): Promise<{ success: boolean; newDebt?: number; repayments?: any[]; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('record_invoice_repayment', {
        p_invoice_id: invoiceDbId,
        p_amount: amount,
        p_mode: mode,
        p_date: dateStr,
      });

      if (error || !data || !data.success) {
        return { success: false, error: error?.message || data?.error || 'Failed to record repayment.' };
      }

      dataCache.invalidate('invoices');
      dataCache.invalidate('dashboard_metrics');
      dataCache.invalidate('debtors');
      dataCache.invalidate('customers');

      return {
        success: true,
        newDebt: data.new_debt,
        repayments: data.repayments,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to process repayment.' };
    }
  },

  /**
   * Fetch customers and their credit invoice history for Khatabook.
   * Utilizes in-memory SWR caching (60s TTL).
   */
  async fetchDebtors(shopId: string, forceRefresh: boolean = false): Promise<any[]> {
    const cacheKey = `debtors_${shopId}`;
    if (forceRefresh) {
      dataCache.invalidate(cacheKey);
    }
    return dataCache.executeSWR(
      cacheKey,
      () => this.fetchDebtorsFromDb(shopId),
      60000
    );
  },

  async fetchDebtorsFromDb(shopId: string): Promise<any[]> {
    try {
      const { data: dbInvoices, error } = await supabase
        .from('invoices')
        .select(`
          id, invoice_number, created_at, customer_name, customer_phone, customer_gst, customer_address,
          subtotal, gst_amount, total_amount, payment_method, is_credit, credit_deposit, credit_debt, credit_due_date,
          repayments, is_voided, txn_ref,
          invoice_items (
            collection_id, variant_id, tile_name, variant_label, brand, size, boxes, price_per_box, total_amount, room_name
          )
        `)
        .eq('shop_id', shopId)
        .eq('is_credit', true)
        .eq('is_voided', false)
        .order('created_at', { ascending: false });

      if (error || !dbInvoices) return [];

      const customersMap = new Map<string, any>();

      dbInvoices.forEach((inv: any) => {
        const phone = inv.customer_phone || 'UNKNOWN';
        if (!customersMap.has(phone)) {
          customersMap.set(phone, {
            name: inv.customer_name || 'Unknown',
            phone: phone,
            address: inv.customer_address,
            gstin: inv.customer_gst,
            history: [],
          });
        }

        const customer = customersMap.get(phone);
        
        // Parse items
        const items = (inv.invoice_items || []).map((item: any) => ({
          tileId: item.collection_id,
          variantId: item.variant_id,
          name: item.tile_name,
          variantLabel: item.variant_label,
          brand: item.brand,
          size: item.size,
          boxes: Number(item.boxes),
          pricePerBox: Number(item.price_per_box),
          total: Number(item.total_amount),
          roomName: item.room_name,
        }));

        customer.history.push({
          dbId: inv.id,
          invoiceId: inv.invoice_number,
          date: inv.created_at,
          customerName: inv.customer_name,
          customerPhone: inv.customer_phone,
          customerGst: inv.customer_gst,
          customerAddress: inv.customer_address,
          items,
          subtotal: Number(inv.subtotal),
          gst: Number(inv.gst_amount),
          total: Number(inv.total_amount),
          paymentMethod: inv.payment_method || 'credit',
          isVoided: Boolean(inv.is_voided),
          creditDetail: {
            depositPaid: Number(inv.credit_deposit) || 0,
            debt: Number(inv.credit_debt) || 0,
            dueDate: inv.credit_due_date,
            repayments: Array.isArray(inv.repayments) ? inv.repayments : [],
          }
        });
      });

      return Array.from(customersMap.values());
    } catch (e) {
      console.error('Failed to fetch debtors:', e);
      return [];
    }
  },

  /**
   * Adds a manual credit entry (a lightweight invoice) for Khatabook.
    */
  async addManualCreditEntry(payload: {
    shopId: string;
    customerName: string;
    customerPhone: string;
    amount: number;
    note: string;
    dueDate: string;
    createdBy?: string;
  }): Promise<{ success: boolean; invoiceId?: string; invoiceNumber?: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('create_manual_credit_entry', {
        p_payload: {
          shopId: payload.shopId,
          customerName: payload.customerName.trim(),
          customerPhone: payload.customerPhone.trim(),
          amount: payload.amount,
          note: payload.note || 'Manual Credit Entry',
          dueDate: payload.dueDate || null,
          createdBy: payload.createdBy || null,
        },
      });

      if (error || !data || !data.success) {
        return {
          success: false,
          error: error?.message || data?.error || 'Failed to create manual credit entry.',
        };
      }

      dataCache.invalidate(`invoices_${payload.shopId}`);
      dataCache.invalidate(`dashboard_metrics_${payload.shopId}`);
      dataCache.invalidate(`debtors_${payload.shopId}`);

      return {
        success: true,
        invoiceId: data.invoiceId,
        invoiceNumber: data.invoiceNumber,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to log manual entry' };
    }
  },

  /**
   * Atomically void an invoice via secure RPC (restores stock, zeroes debt, logs audit).
   */
  async voidInvoice(
    invoiceDbId: string,
    reason: string = 'Voided by store owner'
  ): Promise<{ success: boolean; invoiceNumber?: string; depositToRefund?: number; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('void_invoice', {
        p_invoice_id: invoiceDbId,
        p_reason: reason,
      });

      if (error || !data || !data.success) {
        return { success: false, error: error?.message || data?.error || 'Failed to void invoice.' };
      }

      dataCache.invalidate('invoices');
      dataCache.invalidate('dashboard_metrics');
      dataCache.invalidate('debtors');
      dataCache.invalidate('catalog');
      dataCache.invalidate('customers');

      return { 
        success: true, 
        invoiceNumber: data.invoice_number,
        depositToRefund: Number(data.deposit_to_refund) || 0,
      };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to void invoice.' };
    }
  },

  /**
   * Fetches saved estimate drafts and quotes from Supabase and local storage.
   */
  async fetchEstimates(shopId: string): Promise<any[]> {
    try {
      const { data: dbEstimates } = await supabase
        .from('estimates')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });

      const cloudList = (dbEstimates || []).map((est: any) => ({
        dbId: est.id,
        projectName: est.project_name,
        rooms: Array.isArray(est.rooms_data) ? est.rooms_data : [],
        wastagePercent: Number(est.wastage_percent) || 10,
        totalSqft: Number(est.total_sqft) || 0,
        totalBoxes: Number(est.total_boxes) || 0,
        totalAmount: Number(est.total_amount) || 0,
        timestamp: est.created_at,
        isDraft: Boolean(est.is_draft),
      }));

      // Merge with local estimates array if any exist offline
      const localStored = await AsyncStorage.getItem('tilor_all_estimates');
      let localList: any[] = localStored ? JSON.parse(localStored) : [];

      // Also check single draft keys for backward compatibility
      const singleDraft = await AsyncStorage.getItem('tilor_current_draft');
      if (singleDraft) {
        const parsed = JSON.parse(singleDraft);
        if (!localList.some(item => item.timestamp === parsed.timestamp)) {
          localList.push({ ...parsed, isDraft: true });
        }
      }

      // Combine cloud + local list, removing duplicates by timestamp or dbId
      const map = new Map<string, any>();
      cloudList.forEach(item => map.set(item.dbId || item.timestamp, item));
      localList.forEach(item => {
        const key = item.dbId || item.timestamp;
        if (!map.has(key)) map.set(key, item);
      });

      return Array.from(map.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch {
      return [];
    }
  },

  /**
   * Saves or syncs an estimate draft to Supabase and local storage array.
   */
  async saveEstimate(shopId: string, estimateData: any): Promise<boolean> {
    try {
      const grandTotalSqft = (estimateData.rooms || []).reduce((sum: number, r: any) => sum + (r.sqft || 0), 0);
      const grandTotalBoxes = (estimateData.rooms || []).reduce((sum: number, r: any) => sum + (r.boxes || 0), 0);
      const grandTotalAmount = (estimateData.rooms || []).reduce((sum: number, r: any) => sum + (r.totalAmount || 0), 0);

      // Save to Supabase
      await supabase.from('estimates').insert({
        shop_id: shopId,
        project_name: estimateData.projectName || 'Untitled Project',
        rooms_data: estimateData.rooms || [],
        wastage_percent: estimateData.wastagePercent || 10,
        total_sqft: grandTotalSqft,
        total_boxes: grandTotalBoxes,
        total_amount: grandTotalAmount,
        is_draft: Boolean(estimateData.isDraft),
      });

      // Also update local storage array
      const localStored = await AsyncStorage.getItem('tilor_all_estimates');
      const list: any[] = localStored ? JSON.parse(localStored) : [];
      list.unshift(estimateData);
      await AsyncStorage.setItem('tilor_all_estimates', JSON.stringify(list.slice(0, 50)));

      return true;
    } catch {
      return false;
    }
  },

  /**
   * Deletes an estimate from Supabase or local storage array.
   */
  async deleteEstimate(dbId?: string, timestamp?: string): Promise<boolean> {
    try {
      if (dbId) {
        await supabase.from('estimates').delete().eq('id', dbId);
      }
      if (timestamp) {
        const localStored = await AsyncStorage.getItem('tilor_all_estimates');
        if (localStored) {
          const list: any[] = JSON.parse(localStored);
          const updated = list.filter(item => item.timestamp !== timestamp);
          await AsyncStorage.setItem('tilor_all_estimates', JSON.stringify(updated));
        }
      }
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Fetch all registered customers and their invoices for CRM directory.
   * Utilizes in-memory SWR caching (60s TTL) with Promise deduplication.
   */
  async fetchAllCustomers(shopId: string, forceRefresh: boolean = false): Promise<any[]> {
    const cacheKey = `customers_${shopId}`;
    if (forceRefresh) {
      dataCache.invalidate(cacheKey);
    }
    return dataCache.executeSWR(
      cacheKey,
      () => this.fetchAllCustomersFromDb(shopId),
      60000
    );
  },

  async fetchAllCustomersFromDb(shopId: string): Promise<any[]> {
    try {
      // Join customers with their invoices and invoice items
      const { data, error } = await supabase
        .from('customers')
        .select(`
          id, name, phone, address, gstin, created_at,
          invoices (
            id, invoice_number, created_at,
            customer_name, customer_phone, customer_gst, customer_address,
            subtotal, gst_amount, total_amount, payment_method, 
            is_credit, credit_deposit, credit_debt, credit_due_date, repayments,
            is_voided, txn_ref,
            invoice_items (
              collection_id, variant_id, tile_name, variant_label, 
              brand, size, boxes, price_per_box, total_amount, room_name
            )
          )
        `)
        .eq('shop_id', shopId)
        .order('name', { ascending: true });

      if (error || !data) return [];

      return data.map((c: any) => {
        const history = (c.invoices || []).map((inv: any) => {
          const items = (inv.invoice_items || []).map((item: any) => ({
            name: item.tile_name,
            variantLabel: item.variant_label,
            brand: item.brand,
            size: item.size,
            boxes: item.boxes,
            pricePerBox: item.price_per_box,
            total: item.total_amount,
            roomName: item.room_name,
          }));

          return {
            dbId: inv.id,
            invoiceId: inv.invoice_number,
            date: inv.created_at,
            customerName: inv.customer_name,
            customerPhone: inv.customer_phone,
            customerGst: inv.customer_gst,
            customerAddress: inv.customer_address,
            items,
            subtotal: Number(inv.subtotal),
            gst: Number(inv.gst_amount),
            total: Number(inv.total_amount),
            paymentMethod: inv.payment_method || 'cash',
            isVoided: Boolean(inv.is_voided),
            creditDetail: inv.is_credit ? {
              depositPaid: Number(inv.credit_deposit) || 0,
              debt: Number(inv.credit_debt) || 0,
              dueDate: inv.credit_due_date,
              repayments: Array.isArray(inv.repayments) ? inv.repayments : [],
            } : null,
          };
        });

        // Sort history by date descending
        history.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          address: c.address || '',
          gstin: c.gstin || '',
          history,
        };
      });
    } catch {
      return [];
    }
  },

  /**
   * Manually adds or updates a customer profile without generating an invoice.
   */
  async addCustomer(shopId: string, name: string, phone: string, address: string, gstin: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('upsert_customer', {
        p_shop_id: shopId,
        p_name: name,
        p_phone: phone,
        p_address: address,
        p_gstin: gstin,
      });

      if (error) {
        return { success: false, error: error.message };
      }
      dataCache.invalidate(`customers_${shopId}`);
      dataCache.invalidate('customers');
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Fetch aggregated dashboard metrics for a specific shop.
   * Utilizes in-memory SWR caching (45s TTL) with background revalidation.
   */
  async fetchDashboardMetrics(shopId: string, forceRefresh: boolean = false) {
    const cacheKey = `dashboard_metrics_${shopId}`;
    if (forceRefresh) {
      dataCache.invalidate(cacheKey);
    }
    return dataCache.executeSWR(
      cacheKey,
      () => this.fetchDashboardMetricsFromDb(shopId),
      45000
    );
  },

  async fetchDashboardMetricsFromDb(shopId: string) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      // 1. Today's Sales & Bills
      const { data: todayInvoices } = await supabase
        .from('invoices')
        .select('total_amount')
        .eq('shop_id', shopId)
        .eq('is_voided', false)
        .gte('created_at', todayIso);

      let todaySales = 0;
      let todayBillsCount = 0;
      if (todayInvoices) {
        todayBillsCount = todayInvoices.length;
        todaySales = todayInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
      }

      // 2. Khatabook Due & Customers Count
      const { data: creditInvoices } = await supabase
        .from('invoices')
        .select('credit_debt')
        .eq('shop_id', shopId)
        .eq('is_credit', true)
        .eq('is_voided', false);

      let khatabookDue = 0;
      if (creditInvoices) {
        creditInvoices.forEach(inv => {
          khatabookDue += Number(inv.credit_debt) || 0;
        });
      }

      const { count: customersCount } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shopId);

      // 3. Recent Activities (last 4)
      const { data: recent } = await supabase
        .from('invoices')
        .select('customer_name, invoice_number, payment_method, total_amount')
        .eq('shop_id', shopId)
        .eq('is_voided', false)
        .order('created_at', { ascending: false })
        .limit(4);

      const recentActivities = (recent || []).map(r => ({
        customerName: r.customer_name,
        invoiceId: r.invoice_number,
        paymentMethod: r.payment_method,
        total: Number(r.total_amount),
      }));

      // 4. Pending Dispatch Count (invoices pending or partial loading)
      const { count: pendingDispatchCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('is_voided', false)
        .in('loading_status', ['pending', 'partial']);

      return {
        todaySales,
        todayBillsCount,
        khatabookDue,
        customersCount: customersCount || 0,
        recentActivities,
        pendingDispatchCount: pendingDispatchCount || 0,
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  // ─── Loading & Fulfillment Workflow ─────────────────────────────────────────

  /**
   * Fetches loading logs for a specific invoice.
   */
  async fetchLoadingLogs(invoiceDbId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('invoice_loading_logs')
        .select('*')
        .eq('invoice_id', invoiceDbId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching loading logs:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.error('Failed to fetch loading logs:', e);
      return [];
    }
  },

  /**
   * Records a loading batch for an invoice.
   */
  async createLoadingBatch(payload: {
    shopId: string;
    invoiceDbId: string;
    invoiceNumber: string;
    loadedBy: string;
    loadedByName: string;
    vehicleNumber?: string;
    driverPhone?: string;
    notes?: string;
    itemsLoaded: Array<{ variant_id: string; tile_name: string; boxes_loaded: number }>;
    totalBoxesInBatch: number;
    newTotalBoxesLoaded: number;
    totalBoxesBilled: number;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Call the secure RPC to perform the insert and update atomically
      // This bypasses the RLS restrictions on the invoices table securely
      const { data, error: rpcError } = await supabase.rpc('create_loading_batch', {
        p_shop_id: payload.shopId,
        p_invoice_id: payload.invoiceDbId,
        p_loaded_by: payload.loadedBy,
        p_loaded_by_name: payload.loadedByName,
        p_vehicle_number: payload.vehicleNumber ? sanitizeTxnRef(payload.vehicleNumber) : null,
        p_driver_phone: payload.driverPhone ? payload.driverPhone.replace(/\D/g, '').slice(0, 15) : null,
        p_notes: payload.notes ? sanitizeReceiptField(payload.notes, 250) : null,
        p_items_loaded: payload.itemsLoaded,
        p_total_boxes_in_batch: payload.totalBoxesInBatch,
        p_new_total_boxes_loaded: payload.newTotalBoxesLoaded,
        p_total_boxes_billed: payload.totalBoxesBilled
      });

      if (rpcError) {
        return { success: false, error: rpcError.message };
      }

      if (data && data.success === false) {
        return { success: false, error: data.error || 'Failed to record loading dispatch.' };
      }

      const newStatus = data.new_status || 'completed';

      // 4. Log activity
      await activityLogService.logActivity({
        shopId: payload.shopId,
        userId: payload.loadedBy,
        userName: payload.loadedByName,
        entityType: 'invoice',
        entityId: payload.invoiceDbId,
        entityName: `Invoice #${payload.invoiceNumber}`,
        action: 'dispatch',
        details: {
          boxesLoaded: payload.totalBoxesInBatch,
          vehicleNumber: payload.vehicleNumber,
          status: newStatus,
        }
      });

      dataCache.invalidate(`invoices_${payload.shopId}`);
      dataCache.invalidate(`dashboard_metrics_${payload.shopId}`);

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Failed to record loading dispatch.' };
    }
  }
};

