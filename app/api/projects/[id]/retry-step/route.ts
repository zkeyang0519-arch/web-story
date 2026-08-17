import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { retryRecoverableStep, type ArkPipelineState } from "@/lib/pipeline";
import { presentProject } from "@/lib/project-view";

export const dynamic = "force-dynamic";

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await context.params;
    const owner = ownerId(request);
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (!["needs_action", "failed"].includes(row.status) || !row.pipelineJson) {
      return Response.json({ error: "当前任务没有可单独重试的流程步骤" }, { status: 409 });
    }
    const currentPipelineJson = row.pipelineJson;
    const state = JSON.parse(currentPipelineJson) as ArkPipelineState;
    const snapshot = retryRecoverableStep(state);
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
    if (!updated) return Response.json({ error: "任务状态已经变化，请刷新后重试" }, { status: 409 });
    return Response.json({ project: presentProject(updated) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "流程步骤重试失败" }, { status: 500 });
  }
}
