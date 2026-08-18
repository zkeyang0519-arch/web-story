import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { hydratePipelineInput, reviseCreativeReviewItemWithFeedback, type ArkPipelineState } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type RevisionBody = {
  kind?: "story" | "asset";
  itemId?: string;
  feedback?: string;
  revision?: number;
  draftCreative?: unknown;
  draftAnalyses?: unknown;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    }
    const body = await request.json() as RevisionBody;
    const itemId = body.itemId?.trim() ?? "";
    const feedback = body.feedback?.trim() ?? "";
    if (!(["story", "asset"] as const).includes(body.kind as "story" | "asset") || !itemId || feedback.length < 2 || feedback.length > 1000 || !Number.isInteger(body.revision)) {
      return Response.json({ error: "请提供修改类型、项目标识、2到1000字的修改意见和有效版本号" }, { status: 422 });
    }

    await ensureDatabase();
    const { id } = await context.params;
    const owner = ownerId(request);
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "awaiting_review" || !row.pipelineJson) return Response.json({ error: "当前任务不在素材融合确认阶段" }, { status: 409 });

    const state = JSON.parse(row.pipelineJson) as ArkPipelineState;
    if (state.phase !== "awaiting_creative_review") return Response.json({ error: "素材融合已经锁定，不能再次修改" }, { status: 409 });
    if (state.revision !== body.revision) return Response.json({ error: "素材融合版本已更新，请刷新后重试" }, { status: 409 });

    const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
    const item = await reviseCreativeReviewItemWithFeedback({
      input,
      state,
      kind: body.kind as "story" | "asset",
      itemId,
      feedback,
      draftCreative: body.draftCreative,
      draftAnalyses: body.draftAnalyses,
    });
    return Response.json({ item, revision: state.revision });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创意内容重新生成失败" }, { status: 500 });
  }
}
