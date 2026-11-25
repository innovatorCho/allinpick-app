import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/auth/providers";
import { listAllProducts } from "@/lib/domain/products";

// Rebuilt at most hourly, so newly registered products show up without a deploy.
export const revalidate = 3600;

/** Public pages plus every product that has real data (not samples, not still awaiting its first collection). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/guide`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
  try {
    const products = await listAllProducts();
    for (const p of products) {
      if (p.isSeed || p.salePrice == null) continue;
      pages.push({
        url: `${base}/product/${p.id}`,
        lastModified: p.lastCheckedAt ?? p.updatedAt,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  } catch (err) {
    // A DB blip shouldn't turn the sitemap into an error page for Google.
    console.error("[sitemap] 상품 목록을 불러오지 못해 기본 페이지만 내보냅니다:", err);
  }
  return pages;
}
