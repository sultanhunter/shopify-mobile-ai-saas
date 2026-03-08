import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { streamOpenCodeProjectUpdate } from "@/lib/llm";
import { runPromptFromPrecomputedOutput } from "@/lib/project-service";

export const runtime = "nodejs";

interface Params {
  params: {
    projectId: string;
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  const payload = (await request.json().catch(() => null)) as
    | { prompt?: string; model?: string; thinking?: string }
    | null;

  const prompt = payload?.prompt?.trim();
  const model = payload?.model?.trim();
  const thinking = payload?.thinking?.trim();

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const project = await getProject(params.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const write = (controller: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const aiOutput = await streamOpenCodeProjectUpdate(
            project,
            prompt,
            {
              model: model || undefined,
              thinking: thinking || undefined
            },
            (event) => {
              write(controller, { type: "stream", event });
            }
          );

          const result = await runPromptFromPrecomputedOutput(params.projectId, prompt, aiOutput);
          write(controller, { type: "final", project: result.project, run: result.run });
        } catch (caught) {
          write(controller, {
            type: "error",
            error: caught instanceof Error ? caught.message : "Prompt execution failed."
          });
        } finally {
          controller.close();
        }
      })();
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
