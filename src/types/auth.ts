// TypeScript types for Supabase Auth layer

export type UserRole = 'owner' | 'staff' | 'admin' | 'superadmin';

export interface UserProfile {
  id: string;           // UUID — matches auth.users.id
  shop_id: string | null; // UUID of the tenant shop (null for superadmin)
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  password_changed_at?: string | null;
  created_at: string;
  shop_name?: string;   // Optional joined shop name
}

export interface UserSession {
  id: string;
  username: string;     // Display name (full_name || email)
  email: string;
  role: UserRole;
  shop_id: string;      // Current active shop context (for superadmin: selected shop)
  full_name: string | null;
  time: string;         // ISO string of last login
  password_changed_at?: string | null;
}

export interface AuthError {
  message: string;
  status?: number;
}

export interface ShopRecord {
  id: string;
  name: string;
  currency: string;
  gst_rate: number;
  settings?: {
    phone?: string;
    address?: string;
    email?: string;
    gstin?: string;
    [key: string]: any;
  } | null;
  created_at?: string;
  updated_at?: string;
  user_count?: number;
  collection_count?: number;
}

export interface CreateShopPayload {
  name: string;
  gstRate?: number;
  currency?: string;
  settings?: {
    phone?: string;
    address?: string;
    email?: string;
    gstin?: string;
    [key: string]: any;
  };
}

export interface CreateUserPayload {
  email: string;
  password: string;
  fullName: string;
  role: 'owner' | 'admin' | 'staff';
  shopId: string;
}
