import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { refreshCustomerAuthToken } from "@/lib/shopify-customer-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      refreshToken?: string;
    };

    const refreshToken = payload.refreshToken?.trim();
    if (!refreshToken) {
      return NextResponse.json({ error: "refreshToken is required." }, { status: 400 });
    }

    const project = await getProject(params.projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const auth = project.store?.customerAuth;
    const tokenEndpoint = auth?.customerAccountApi.tokenEndpoint;
    const clientId = auth?.customerAccountApi.clientId;
    if (!tokenEndpoint || !clientId) {
      return NextResponse.json({ error: "Customer Account API token refresh is unavailable." }, { status: 409 });
    }

    const tokens = await refreshCustomerAuthToken({
      tokenEndpoint,
      clientId,
      refreshToken,
    });

    return NextResponse.json({ tokens });
  } catch (caught) {
    return NextResponse.json(
      {
        error: caught instanceof Error ? caught.message : "Failed to refresh customer auth token.",
      },
      { status: 500 }
    );
  }
}
