import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/auth/providers";

// Pages that are per-user, admin-only or thin (search results) stay out of
// search engines; everything else, including product pages, is crawlable.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/my", "/login", "/search"],
    },
    sitemap: `${getBaseUrl()}/sitemap.xml`,
  };
}
