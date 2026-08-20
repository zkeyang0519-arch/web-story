import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { hydratePipelineInput, regenerateStoryboardFrameWithFeedback, type ArkPipelineState } from "@/lib/pipeline";
import { presentProject } from "@/lib/project-view";

export const dynamic = "force-dynamic";

type RegenerateBody = {
  frameId?: string;
  feedback?: string;
  revision?: number;
  draftImagePlan?: unknown;
  draftCanvas?: unknown;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    }
    const body = await request.json() as RegenerateBody;
    const frameId = body.frameId?.trim() ?? "";
    const feedback = body.feedback?.trim() ?? "";
    if (!frameId || feedback.length < 2 || feedback.length > 1000 || !Number.isInteger(body.revision) || !body.draftImagePlan || !body.draftCanvas) {
      return Response.json({ error: "请提供分镜标识、2到1000字的修改意见、当前四幕编辑稿和有效版本号" }, { status: 422 });
    }

    await ensureDatabase();
    const { id } = await context.params;
    const owner = ownerId(request);
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "awaiting_review" || !row.pipelineJson) return Response.json({ error: "当前任务不在四幕画布确认阶段" }, { status: 409 });

    const currentPipelineJson = row.pipelineJson;
    const state = JSON.parse(currentPipelineJson) as ArkPipelineState;
    if (state.phase !== "awaiting_canvas_review") return Response.json({ error: "四幕画布已经锁定，不能重新生成" }, { status: 409 });
    if (state.revision !== body.revision) return Response.json({ error: "四幕版本已更新，请刷新后重试" }, { status: 409 });

    const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
    const snapshot = await regenerateStoryboardFrameWithFeedback({
      input,
      state,
      frameId,
      feedback,
      ownerId: owner,
      draftImagePlan: body.draftImagePlan,
      draftCanvas: body.draftCanvas,
    });
    const [updated] = await db.update(projects).set({
      status: snapshot.status,
      progress: snapshot.progress,
      pipelineJson: snapshot.state ? JSON.stringify(snapshot.state) : currentPipelineJson,
      errorJson: null,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(projects.id, id),
      eq(projects.ownerId, owner),
      eq(projects.status, row.status),
      eq(projects.pipelineJson, currentPipelineJson),
    )).returning();
    if (!updated) return Response.json({ error: "四幕画布已被其他操作更新，请刷新后重试" }, { status: 409 });
    return Response.json({ project: presentProject(updated) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "本幕重新生成失败" }, { status: 500 });
  }
}
