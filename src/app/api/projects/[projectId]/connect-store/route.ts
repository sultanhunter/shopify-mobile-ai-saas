import { NextRequest, NextResponse } from "next/server";
import { connectStoreToProject } from "@/lib/project-service";

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json()) as {
      shopDomain?: string;
      adminAccessToken?: string;
    };

    const shopDomain = payload.shopDomain?.trim();
    if (!shopDomain) {
      return NextResponse.json({ error: "shopDomain is required" }, { status: 400 });
    }

    const project = await connectStoreToProject({
      projectId: params.projectId,
      shopDomain,
      accessToken: payload.adminAccessToken?.trim() || undefined
    });

    return NextResponse.json({ project });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Could not connect store." },
      { status: 500 }
    );
  }
}
