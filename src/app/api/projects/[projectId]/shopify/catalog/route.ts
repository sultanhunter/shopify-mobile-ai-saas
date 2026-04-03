import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { getProjectRuntimeSecrets } from "@/lib/runtime-sync";
import { parseRuntimeSecrets } from "@/lib/runtime-secrets";
import { fetchShopifyCatalog } from "@/lib/shopify-admin";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Params {
  params: {
    projectId: string;
  };
}

export async function GET(_: Request, { params }: Params) {
  try {
    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const runtimeSecrets = await getProjectRuntimeSecrets(project.id);
    const parsed = parseRuntimeSecrets(runtimeSecrets);
    const shopDomain = parsed.shopify?.shopDomain?.trim().toLowerCase();
    const accessToken = parsed.shopify?.adminAccessToken;

    if (!shopDomain || !accessToken) {
      return NextResponse.json({ error: "Shopify store is not connected." }, { status: 400 });
    }

    const products = await fetchShopifyCatalog({
      shopDomain,
      accessToken,
      limit: 24
    });

    return NextResponse.json({ shopDomain, products });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Failed to fetch Shopify catalog." },
      { status: 500 }
    );
  }
}
