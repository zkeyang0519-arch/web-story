import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { pipelineInfo } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type CreateProjectBody = { action?: "draft"; requestKey?: string };

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function present(row: typeof projects.$inferSelect) {
  const pipeline = row.pipelineJson ? JSON.parse(row.pipelineJson) as { phase?: string; events?: unknown[] } : null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    draftStep: row.draftStep,
    draftVersion: row.draftVersion,
    progress: row.progress,
    runMode: row.runMode,
    pipelinePhase: pipeline?.phase ?? null,
    activity: pipeline?.events ?? [],
    error: row.errorJson ? JSON.parse(row.errorJson) : null,
    createdAt: row.runStartedAt ?? row.createdAt,
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
    if (body.action !== "draft") return Response.json({ error: "该接口只用于创建草稿" }, { status: 400 });
    const requestKey = request.headers.get("Idempotency-Key") ?? body.requestKey ?? "";
    if (!requestKey || requestKey.length > 128) return Response.json({ error: "缺少有效的 Idempotency-Key" }, { status: 400 });

    const db = getDb();
    const owner = ownerId(request);
    const requestFingerprint = await fingerprint(body);
    const [existing] = await db.select().from(projects).where(and(eq(projects.ownerId, owner), eq(projects.requestKey, requestKey))).limit(1);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) return Response.json({ error: "同一个幂等键不能用于不同请求" }, { status: 409 });
      return Response.json({ project: present(existing) });
    }

    const now = new Date().toISOString();
    const info = pipelineInfo();
    const initialInput = {
      topicMode: "ai",
      topic: "",
      goal: "品牌种草",
      audience: "20～35 岁，关注品质生活与效率的城市用户",
      platform: "抖音",
      duration: 15,
      ratio: "9:16",
      style: "真实生活感",
      company: "",
      mustInclude: "",
      mustAvoid: "",
      cta: "",
      rightsConfirmed: false,
      references: [],
    };
    const row: typeof projects.$inferInsert = {
      id: crypto.randomUUID(),
      ownerId: owner,
      requestKey,
      requestFingerprint,
      title: "未命名视频",
      status: "draft",
      draftStep: "references",
      draftVersion: 1,
      progress: 0,
      runMode: info.mode,
      inputJson: JSON.stringify(initialInput),
      createdAt: now,
      updatedAt: now,
    };
    const [created] = await db.insert(projects).values(row).returning();
    return Response.json({ project: present(created) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "草稿创建失败" }, { status: 500 });
  }
}
