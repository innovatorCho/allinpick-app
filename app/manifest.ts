import type { MetadataRoute } from "next";
import { getSiteSettings } from "@/lib/domain/siteSettings";

// Lets the site be added to the home screen as an app, which iPhone
// requires before it allows push alerts (lib/webPush.ts).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getSiteSettings();
  const name = site.serviceName ?? "올인픽";
  return {
    name,
    short_name: name,
    start_url: "/my",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#18181b",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
