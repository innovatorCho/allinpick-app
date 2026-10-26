import type { CollectStatus } from "@/collectors/oliveyoung/types";

export type { CollectStatus };

export interface Product {
  id: string; // oliveyoungProductId — the canonical identifier (AGENTS.md §6)
  name: string;
  brand: string;
  imageUrl: string | null;
  sourceUrl: string;
  curatorUrl: string | null;
  normalPrice: number | null;
  salePrice: number | null;
  discountRate: number | null;
  lastCheckedAt: string | null;
  lastCollectStatus: CollectStatus | null;
  lastCollectError: string | null;
  searchCount: number;
  viewCount: number;
  isSeed: boolean;
  /** When the scheduler should next bother re-checking this product (lib/domain/collectionSchedule.ts). */
  nextCheckAt: string | null;
  consecutiveFailures: number;
  consecutiveSameCount: number;
  createdAt: string;
  updatedAt: string;
}

export type PriceChangeType = "initial" | "increase" | "decrease" | "same";
export type PriceHistorySource = "collector" | "seed";

export interface PriceHistoryEntry {
  id: number;
  productId: string;
  price: number;
  changeType: PriceChangeType;
  recordedAt: string;
  source: PriceHistorySource;
}

export interface CollectLogEntry {
  id: number;
  productId: string;
  status: CollectStatus;
  errorMessage: string | null;
  createdAt: string;
}

export interface UserTracking {
  id: number;
  userId: string;
  productId: string;
  targetPrice: number | null;
  createdAt: string;
}

export type NotificationType = "price_drop" | "target_price";

export interface AppNotification {
  id: number;
  userId: string;
  productId: string;
  type: NotificationType;
  message: string;
  oldPrice: number | null;
  newPrice: number | null;
  isRead: boolean;
  createdAt: string;
}

export type UserRole = "user" | "admin";

export interface AppUser {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
}

export type OAuthProvider = "google" | "kakao";

export interface ProductWithPopularity extends Product {
  trackingUserCount: number;
}
