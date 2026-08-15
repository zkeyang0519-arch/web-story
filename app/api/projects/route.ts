import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { pipelineInfo, submitPipeline, type PipelineInput } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type CreateProjectBody = Omit<PipelineInput, "projectId" | "title"> & {
  requestKey?: string;
  rightsConfirmed?: boolean;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function present(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    progress: row.progress,
    runMode: row.runMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    input: JSON.parse(row.inputJson),
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const db = getDb();
    const rows = await db.select().from(projects).where(eq(projects.ownerId, ownerId(request))).orderBy(desc(projects.createdAt)).limit(12);
    return Response.json({ projects: rows.map(present) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取任务失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    }
    const body = await request.json() as CreateProjectBody;
    const requestKey = request.headers.get("Idempotency-Key") ?? body.requestKey ?? "";
    if (!requestKey || requestKey.length > 128) return Response.json({ error: "缺少有效的 Idempotency-Key" }, { status: 400 });
    if (!body.rightsConfirmed) return Response.json({ error: "必须确认素材使用权" }, { status: 400 });
    if (!Array.isArray(body.references) || body.references.length < 1 || body.references.length > 10) return Response.json({ error: "参考视频数量必须为 1～10 个" }, { status: 400 });
    if (!body.audience?.trim() || !body.goal?.trim()) return Response.json({ error: "目标观众和内容目标不能为空" }, { status: 400 });
    if (![15, 30, 60].includes(body.duration)) return Response.json({ error: "成片时长仅支持 15、30 或 60 秒" }, { status: 400 });

    const db = getDb();
    const owner = ownerId(request);
    const requestFingerprint = await fingerprint(body);
    const [existing] = await db.select().from(projects).where(and(eq(projects.ownerId, owner), eq(projects.requestKey, requestKey))).limit(1);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) return Response.json({ error: "同一个幂等键不能用于不同请求" }, { status: 409 });
      return Response.json({ project: present(existing) });
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const title = body.topicMode === "manual" && body.topic?.trim() ? body.topic.trim() : "AI 自动主题 · 参考灵感融合";
    const input = { ...body, projectId: id, title } as PipelineInput;
    const snapshot = await submitPipeline(input);
    const info = pipelineInfo();
    const row: typeof projects.$inferInsert = {
      id,
      ownerId: owner,
      requestKey,
      requestFingerprint,
      title,
      status: snapshot.status,
      progress: snapshot.progress,
      runMode: info.mode,
      providerJobId: snapshot.providerJobId ?? null,
      inputJson: JSON.stringify(body),
      resultJson: snapshot.result ? JSON.stringify(snapshot.result) : null,
      errorJson: snapshot.error ? JSON.stringify(snapshot.error) : null,
      createdAt: now,
      updatedAt: now,
    };
    const [created] = await db.insert(projects).values(row).returning();
    return Response.json({ project: present(created) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "任务创建失败" }, { status: 500 });
  }
}
