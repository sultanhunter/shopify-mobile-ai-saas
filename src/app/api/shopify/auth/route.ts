import { NextRequest, NextResponse } from "next/server";
import { getPublicProject } from "@/lib/project-service";
import {
  buildShopifyAuthorizeUrl,
  createShopifyOAuthState,
  getAppBaseUrl,
  normalizeShopDomain
} from "@/lib/shopify";

export async function GET(request: NextRequest) {
  const rawShop = request.nextUrl.searchParams.get("shop");
  const shop = rawShop ? normalizeShopDomain(rawShop) : null;
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim();

  if (!shop) {
    return NextResponse.json({ error: "Missing or invalid `shop` query param" }, { status: 400 });
  }

  if (!projectId) {
    return NextResponse.json({ error: "Missing `projectId` query param" }, { status: 400 });
  }

  const project = await getPublicProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const appBaseUrl = getAppBaseUrl(request.nextUrl.origin);
  const redirectUri = `${appBaseUrl}/api/shopify/callback`;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "SHOPIFY_API_KEY is missing",
        hint: "Set SHOPIFY_API_KEY in .env.local"
      },
      { status: 500 }
    );
  }

  const state = createShopifyOAuthState({
    projectId,
    shopDomain: shop
  });

  const authUrl = buildShopifyAuthorizeUrl({
    shopDomain: shop,
    apiKey,
    redirectUri,
    state
  });

  return NextResponse.json({ authUrl });
}
