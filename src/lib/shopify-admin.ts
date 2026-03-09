const SHOPIFY_ADMIN_API_VERSION = "2024-10";

interface ShopifyImage {
  src?: string;
}

interface ShopifyVariant {
  id?: number;
  price?: string;
}

interface ShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  image?: ShopifyImage;
  images?: ShopifyImage[];
  variants?: ShopifyVariant[];
}

interface ProductsResponse {
  products?: ShopifyProduct[];
}

export interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl?: string;
  price: number;
  variantId: string;
}

export interface ShopifyProductDetail extends ShopifyProductSummary {
  description?: string;
}

function toMoney(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function stripHtml(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function mapProductSummary(raw: ShopifyProduct): ShopifyProductSummary | null {
  const firstVariant = raw.variants?.[0];
  if (!raw.id || !raw.title || !raw.handle || !firstVariant?.id) {
    return null;
  }

  const imageUrl = raw.image?.src || raw.images?.[0]?.src;

  return {
    id: String(raw.id),
    title: raw.title,
    handle: raw.handle,
    imageUrl,
    price: toMoney(firstVariant.price),
    variantId: String(firstVariant.id)
  };
}

function mapProductDetail(raw: ShopifyProduct): ShopifyProductDetail | null {
  const summary = mapProductSummary(raw);
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    description: stripHtml(raw.body_html)
  };
}

async function shopifyAdminFetch<T>(params: {
  shopDomain: string;
  accessToken: string;
  resourcePath: string;
  query?: Record<string, string>;
}): Promise<T> {
  const search = new URLSearchParams(params.query ?? {});
  const response = await fetch(
    `https://${params.shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/${params.resourcePath}?${search.toString()}`,
    {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": params.accessToken,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const payload = (await response.json().catch(() => null)) as T | { errors?: unknown } | null;
  if (!response.ok || !payload) {
    const errorText =
      payload && typeof payload === "object" && "errors" in payload
        ? JSON.stringify((payload as { errors?: unknown }).errors)
        : `Shopify API status ${response.status}`;
    throw new Error(`Shopify API request failed: ${errorText}`);
  }

  return payload as T;
}

export async function fetchShopifyCatalog(params: {
  shopDomain: string;
  accessToken: string;
  limit?: number;
}): Promise<ShopifyProductSummary[]> {
  const limit = String(params.limit ?? 24);
  const payload = await shopifyAdminFetch<ProductsResponse>({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    resourcePath: "products.json",
    query: {
      limit,
      fields: "id,title,handle,image,images,variants"
    }
  });

  return (payload.products ?? [])
    .map((product) => mapProductSummary(product))
    .filter((item): item is ShopifyProductSummary => Boolean(item));
}

export async function fetchShopifyProductByHandle(params: {
  shopDomain: string;
  accessToken: string;
  handle: string;
}): Promise<ShopifyProductDetail | null> {
  const payload = await shopifyAdminFetch<ProductsResponse>({
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
    resourcePath: "products.json",
    query: {
      handle: params.handle,
      limit: "1",
      fields: "id,title,handle,body_html,image,images,variants"
    }
  });

  const found = payload.products?.[0];
  if (!found) {
    return null;
  }

  return mapProductDetail(found);
}
