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
  kakao_pending: number;
  target_price: number | null;
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
  /** Idle deadline (slides forward on activity, never past absolute_expires_at). */
  expires_at: string;
  created_at: string;
  absolute_expires_at: string | null;
  idle_timeout_ms: number | null;
  last_seen_at: string | null;
  remember_me: number;
}

export interface ErrorLogRow {
  id: number;
  source: string;
  message: string;
  stack: string | null;
  digest: string | null;
  path: string | null;
  user_id: string | null;
  context: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface PushSubscriptionRow {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_sent_at: string | null;
}
