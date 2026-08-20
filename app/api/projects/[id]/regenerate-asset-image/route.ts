import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { hydratePipelineInput, regenerateAssetImageWithFeedback, type ArkPipelineState } from "@/lib/pipeline";
import { presentProject } from "@/lib/project-view";

export const dynamic = "force-dynamic";

type RegenerateBody = {
  assetId?: string;
  feedback?: string;
  revision?: number;
  draftImagePlan?: unknown;
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
    const assetId = body.assetId?.trim() ?? "";
    const feedback = body.feedback?.trim() ?? "";
    if (!assetId || feedback.length > 1000 || !Number.isInteger(body.revision)) {
      return Response.json({ error: "请提供资产标识、1000字以内的补充意见和有效版本号" }, { status: 422 });
    }

    await ensureDatabase();
    const { id } = await context.params;
    const owner = ownerId(request);
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "awaiting_review" || !row.pipelineJson) return Response.json({ error: "当前任务不在真实资产图确认阶段" }, { status: 409 });

    const currentPipelineJson = row.pipelineJson;
    const state = JSON.parse(currentPipelineJson) as ArkPipelineState;
    if (state.phase !== "awaiting_asset_image_review") return Response.json({ error: "真实资产图已经锁定，不能重新生成" }, { status: 409 });
    if (state.revision !== body.revision) return Response.json({ error: "资产版本已更新，请刷新后重试" }, { status: 409 });
    const existingAssetImage = state.assetImages?.some((image) => image.assetId === assetId);
    if (existingAssetImage && feedback.length < 2) return Response.json({ error: "重新生成已有资产时，请填写2到1000字的修改意见" }, { status: 422 });

    const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
    const snapshot = await regenerateAssetImageWithFeedback({ input, state, assetId, feedback, ownerId: owner, draftImagePlan: body.draftImagePlan });
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
    if (!updated) return Response.json({ error: "资产图已被其他操作更新，请刷新后重试" }, { status: 409 });
    return Response.json({ project: presentProject(updated) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "真实资产图重新生成失败" }, { status: 500 });
  }
}
