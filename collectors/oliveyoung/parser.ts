import * as cheerio from "cheerio";
import type { ParsedProduct } from "./types";
import { ParserError, PriceNotFoundError, ProductNotFoundError } from "./errors";

/**
 * Parses an OliveYoung product-detail HTML document into structured data.
 *
 * Strategy (in order, each field falls back independently):
 *  1. `eg:*` meta tags (`eg:itemName`, `eg:brandName`, `eg:originalPrice`,
 *     `eg:salePrice`) plus `og:image` — verified directly against a real
 *     rendered product page while building this (see browserFetcher.ts for
 *     why a real render, not a plain fetch, was needed to see it at all).
 *     These are clean, pre-formatted values meant for a tracking pixel, and
 *     were the most reliable source found on the real page — no JSON-LD was
 *     present at all.
 *  2. schema.org `Product` JSON-LD, in case a different product template
 *     does include it.
 *  3. Known CSS selectors, as a last resort — NOT verified against a real
 *     page (the real page's classes are hashed CSS-module names that change
 *     per deploy, e.g. `PopupBenefits_info-item-price__PnWga`), kept only as
 *     a fallback for a differently-structured page.
 */
export function parseProductHtml(html: string, sourceUrl: string): ParsedProduct {
  const $ = cheerio.load(html);

  if (isProductNotFoundPage($, html)) {
    throw new ProductNotFoundError();
  }

  const fromMeta = tryParseMetaTags($);
  const fromJsonLd = tryParseJsonLd($);
  const fromSelectors = tryParseSelectors($);

  const name = fromMeta?.name ?? fromJsonLd?.name ?? fromSelectors?.name;
  const brand = fromMeta?.brand ?? fromJsonLd?.brand ?? fromSelectors?.brand;
  const imageUrl = fromMeta?.imageUrl ?? fromJsonLd?.imageUrl ?? fromSelectors?.imageUrl ?? null;

  if (!name) {
    throw new ParserError("상품명을 찾을 수 없습니다.");
  }

  const salePrice = fromMeta?.salePrice ?? fromSelectors?.salePrice ?? fromJsonLd?.salePrice;
  const normalPrice = fromMeta?.normalPrice ?? fromSelectors?.normalPrice ?? fromJsonLd?.normalPrice ?? salePrice;

  if (salePrice == null || Number.isNaN(salePrice)) {
    throw new PriceNotFoundError();
  }

  const finalNormalPrice = normalPrice ?? salePrice;
  const discountRate =
    finalNormalPrice > salePrice
      ? Math.round(((finalNormalPrice - salePrice) / finalNormalPrice) * 100)
      : 0;

  const goodsNoMatch = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/i);
  const oliveyoungProductId = goodsNoMatch ? goodsNoMatch[1].toUpperCase() : "";

  return {
    oliveyoungProductId,
    name: name.trim(),
    brand: (brand ?? "브랜드 미상").trim(),
    imageUrl,
    normalPrice: finalNormalPrice,
    salePrice,
    discountRate,
  };
}

function isProductNotFoundPage($: cheerio.CheerioAPI, html: string): boolean {
  const notFoundMarkers = [
    "상품이 존재하지 않습니다",
    "판매중지",
    "삭제된 상품",
    "존재하지 않는 상품",
  ];
  return notFoundMarkers.some((marker) => html.includes(marker));
}

interface PartialParsed {
  name?: string;
  brand?: string;
  imageUrl?: string | null;
  salePrice?: number;
  normalPrice?: number;
}

/** `eg:*` product meta tags — see the module doc comment for how this was verified. */
function tryParseMetaTags($: cheerio.CheerioAPI): PartialParsed | null {
  const meta = (property: string): string | undefined => $(`meta[property="${property}"]`).attr("content");

  const name = meta("eg:itemName");
  const salePriceRaw = meta("eg:salePrice");
  if (!name && !salePriceRaw) return null;

  const originalPriceRaw = meta("eg:originalPrice");
  return {
    name,
    brand: meta("eg:brandName"),
    imageUrl: meta("og:image") ?? null,
    salePrice: salePriceRaw != null ? Number(salePriceRaw) : undefined,
    normalPrice: originalPriceRaw != null ? Number(originalPriceRaw) : undefined,
  };
}

function tryParseJsonLd($: cheerio.CheerioAPI): PartialParsed | null {
  const scripts = $('script[type="application/ld+json"]');
  for (const el of scripts.toArray()) {
    const raw = $(el).contents().text();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const product = findProductNode(candidate);
        if (product) return extractFromJsonLdProduct(product);
      }
    } catch {
      // Malformed JSON-LD is common enough not to be fatal; try next script tag.
      continue;
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findProductNode(node: any): any | null {
  if (!node || typeof node !== "object") return null;
  if (node["@type"] === "Product") return node;
  if (Array.isArray(node["@graph"])) {
    return node["@graph"].find((n: unknown) =>
      typeof n === "object" && n !== null && (n as { ["@type"]?: string })["@type"] === "Product"
    ) ?? null;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromJsonLdProduct(product: any): PartialParsed {
  const brand =
    typeof product.brand === "string" ? product.brand : product.brand?.name;
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const price = offers?.price ?? offers?.lowPrice;

  return {
    name: typeof product.name === "string" ? product.name : undefined,
    brand: typeof brand === "string" ? brand : undefined,
    imageUrl: typeof image === "string" ? image : null,
    salePrice: price != null ? Number(price) : undefined,
  };
}

function tryParseSelectors($: cheerio.CheerioAPI): PartialParsed | null {
  const name = firstText($, [".prd_name", ".goods_txt .tit", "h2.prd_name", "h1.product-name"]);
  const brand = firstText($, [".prd_brand", ".brand_name", ".goods_txt .brand"]);
  const imageUrl =
    $(".prd_img img, .goods_img img, .prd-view-img img").first().attr("src") ?? null;

  const salePriceText = firstText($, [
    ".price-2 strong",
    ".price_wrap .price strong",
    ".total_price .price strong",
  ]);
  const normalPriceText = firstText($, [".price-1 strike", ".price_wrap .original strike"]);

  const salePrice = salePriceText ? parseKrwPrice(salePriceText) : undefined;
  const normalPrice = normalPriceText ? parseKrwPrice(normalPriceText) : undefined;

  if (!name && !salePrice) return null;

  return { name, brand, imageUrl, salePrice, normalPrice };
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return undefined;
}

function parseKrwPrice(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  return Number(digits);
}
