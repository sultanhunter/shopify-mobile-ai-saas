import { NextRequest, NextResponse } from "next/server";
import { runPrompt } from "@/lib/project-service";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const payload = (await request.json()) as { prompt?: string; model?: string; thinking?: string };
    const prompt = payload.prompt?.trim();
    const model = payload.model?.trim();
    const thinking = payload.thinking?.trim();

    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const result = await runPrompt(params.projectId, prompt, {
      model: model || undefined,
      thinking: thinking || undefined
    });
    return NextResponse.json(result);
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : "Prompt execution failed." },
      { status: 500 }
    );
  }
}
