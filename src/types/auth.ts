// TypeScript types for Supabase Auth layer

export type UserRole = 'owner' | 'staff' | 'admin';

export interface UserProfile {
  id: string;           // UUID — matches auth.users.id
  shop_id: string;      // UUID of the tenant shop
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  password_changed_at?: string | null;
  created_at: string;
}

export interface UserSession {
  id: string;
  username: string;     // Display name (full_name || email)
  email: string;
  role: UserRole;
  shop_id: string;
  full_name: string | null;
  time: string;         // ISO string of last login
  password_changed_at?: string | null;
}

export interface AuthError {
  message: string;
  status?: number;
}
