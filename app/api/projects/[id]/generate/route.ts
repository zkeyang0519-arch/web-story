import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects, uploads } from "@/db/schema";
import { submitPipeline, type PipelineInput } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function present(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    draftStep: row.draftStep,
    draftVersion: row.draftVersion,
    progress: row.progress,
    runMode: row.runMode,
    createdAt: row.runStartedAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    input: JSON.parse(row.inputJson),
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    const { id } = await context.params;
    const body = await request.json() as { requestKey?: string; draftVersion?: number };
    const requestKey = request.headers.get("Idempotency-Key") ?? body.requestKey ?? "";
    if (!requestKey || typeof body.draftVersion !== "number") return Response.json({ error: "缺少有效的提交标识或草稿版本" }, { status: 400 });

    const db = getDb();
    const owner = ownerId(request);
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "draft") return Response.json({ project: present(row) });
    if (row.draftVersion !== body.draftVersion) return Response.json({ error: "草稿已更新，请刷新确认后重试" }, { status: 409 });
    if (row.draftStep !== "settings") return Response.json({ error: "请按顺序完成参考素材、创作要求和成片设置" }, { status: 409 });

    const input = JSON.parse(row.inputJson) as PipelineInput & { rightsConfirmed?: boolean };
    if (!input.rightsConfirmed || !Array.isArray(input.references) || input.references.length < 1 || !input.audience?.trim() || !input.goal?.trim()) return Response.json({ error: "制作信息不完整，请返回前面的步骤检查" }, { status: 400 });
    for (const reference of input.references as Array<Record<string, unknown>>) {
      if (reference.kind !== "file") continue;
      if (typeof reference.uploadId !== "string") return Response.json({ error: "存在尚未上传完成的参考视频" }, { status: 400 });
      const [upload] = await db.select().from(uploads).where(and(eq(uploads.id, reference.uploadId), eq(uploads.ownerId, owner), eq(uploads.projectId, id), eq(uploads.status, "ready"))).limit(1);
      if (!upload) return Response.json({ error: "参考视频已失效或不属于当前项目" }, { status: 400 });
    }

    const snapshot = await submitPipeline({ ...input, projectId: id, title: row.title });
    const now = new Date().toISOString();
    const [updated] = await db.update(projects).set({
      status: snapshot.status,
      draftStep: "locked",
      draftVersion: row.draftVersion + 1,
      progress: snapshot.progress,
      providerJobId: snapshot.providerJobId ?? null,
      resultJson: snapshot.result ? JSON.stringify(snapshot.result) : null,
      errorJson: snapshot.error ? JSON.stringify(snapshot.error) : null,
      runStartedAt: now,
      updatedAt: now,
    }).where(and(eq(projects.id, id), eq(projects.ownerId, owner), eq(projects.status, "draft"), eq(projects.draftVersion, row.draftVersion))).returning();
    if (!updated) return Response.json({ error: "任务已经开始制作，请勿重复提交" }, { status: 409 });
    return Response.json({ project: present(updated) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "任务启动失败" }, { status: 500 });
  }
}
