import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { answerAssetAssistant, hydratePipelineInput, type ArkPipelineState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  message?: string;
  history?: unknown;
  draftImagePlan?: unknown;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function validHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if ((role !== "user" && role !== "assistant") || !content) return [];
    return [{ role, content: content.slice(0, 1200) }];
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    }
    const body = await request.json() as ChatBody;
    const message = body.message?.trim() ?? "";
    if (message.length < 2 || message.length > 1000) {
      return Response.json({ error: "问题需要填写2到1000个字符" }, { status: 422 });
    }

    await ensureDatabase();
    const { id } = await context.params;
    const owner = ownerId(request);
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (!row.pipelineJson) return Response.json({ error: "资产草稿尚未准备好" }, { status: 409 });
    const state = JSON.parse(row.pipelineJson) as ArkPipelineState;
    if (!state.imagePlan) return Response.json({ error: "资产草稿尚未准备好" }, { status: 409 });

    const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
    const reply = await answerAssetAssistant({
      input,
      state,
      message,
      history: validHistory(body.history),
      draftImagePlan: body.draftImagePlan,
    });
    return Response.json({ reply });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI 资产顾问暂时无法回答" }, { status: 500 });
  }
}
