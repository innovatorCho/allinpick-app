/** Raw row shapes as returned by node:sqlite (snake_case columns). */

export interface ProductRow {
  oliveyoung_product_id: string;
  name: string;
  brand: string;
  image_url: string | null;
  source_url: string;
  curator_url: string | null;
  normal_price: number | null;
  sale_price: number | null;
  discount_rate: number | null;
  last_checked_at: string | null;
  last_collect_status: string | null;
  last_collect_error: string | null;
  search_count: number;
  view_count: number;
  is_seed: number;
  next_check_at: string | null;
  consecutive_failures: number;
  consecutive_same_count: number;
  created_at: string;
  updated_at: string;
}

export interface PriceHistoryRow {
  id: number;
  product_id: string;
  price: number;
  change_type: string;
  recorded_at: string;
  source: string;
}

export interface CollectLogRow {
  id: number;
  product_id: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface UserTrackingRow {
  id: number;
  user_id: string;
  product_id: string;
  target_price: number | null;
  created_at: string;
}

export interface NotificationRow {
  id: number;
  user_id: string;
  product_id: string;
  type: string;
  message: string;
  old_price: number | null;
  new_price: number | null;
  is_read: number;
  created_at: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  created_at: string;
}

export interface OAuthAccountRow {
  id: number;
  user_id: string;
  provider: string;
  provider_user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  created_at: string;
}

export interface KakaoSendLogRow {
  id: number;
  user_id: string;
  product_id: string;
  notification_type: string;
  status: string;
  detail: string | null;
  created_at: string;
}

export interface KakaoDigestLogRow {
  id: number;
  user_id: string;
  digest_date: string;
  drop_count: number;
  status: string;
  detail: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}
