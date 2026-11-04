export type VariantType = 'light' | 'highlighter' | 'dark' | 'flooring' | 'default';

export interface StockLog {
  id?: string;
  date: string;
  type: 'inward' | 'outward';
  boxes: number;
  reference: string;
  performed_by?: string;
  performed_by_name?: string;
  variant_id?: string;
}

export interface StockAuditLogItem {
  id: string;
  date: string;
  type: 'inward' | 'outward';
  boxes: number;
  reference: string;
  performed_by?: string;
  performed_by_name: string;
  variant_id: string;
  variant_label: string;
  variant_type: string;
  tile_id: string;
  tile_name: string;
  tile_brand: string;
  tile_size: string;
}

export interface TileVariant {
  id?: string;
  collection_id?: string;
  type: VariantType;
  label: string;           // "Light", "Highlighter", "Dark", "Flooring", "Default"
  pricePerBox: number;
  stock: number;
  color: string;           // Primary swatch color hex
  accent: string;          // Secondary swatch accent color hex
  history: StockLog[];
}

export interface MasterCategory {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface MasterTileSize {
  id: string;
  label: string;
  category_id?: string;
  category_name?: string;
  default_pieces_per_box: number;
  default_sqft_per_box: number;
  has_concept_variants: boolean;
  display_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface TileCollection {
  id: string;               // "t1" or UUID
  shop_id?: string;
  name: string;             // "Ivory Marble"
  brand: string;            // "Kajaria"
  category?: string;        // "Wall Tiles", "Floor Vitrified", etc.
  size: string;             // "12×18", "2×2", "2×4", etc.
  sqftPerBox: number;       // e.g. 7.5 or 9.0 for 12×18, 16 for 2×2, etc.
  tilesPerBox: number;      // e.g. 5 or 6 for 12×18, 4 for 2×2, etc.
  is12x18: boolean;         // True if 12×18 wall tile with variants
  is_archived?: boolean;
  variants: TileVariant[];  // List of variants
}
