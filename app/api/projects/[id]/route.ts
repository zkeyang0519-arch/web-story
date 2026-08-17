import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects, uploads } from "@/db/schema";
import { readPipeline, type ArkPipelineState, type PipelineInput } from "@/lib/pipeline";
import { calculateCostQuote } from "@/lib/cost";

export const dynamic = "force-dynamic";

type PatchDraftBody = {
  step?: "references" | "requirements" | "settings" | "quote";
  data?: Record<string, unknown>;
  advance?: boolean;
  draftVersion?: number;
};

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function present(row: typeof projects.$inferSelect) {
  const pipeline = row.pipelineJson ? JSON.parse(row.pipelineJson) as { phase?: string; events?: unknown[]; keyframe?: { objectKey?: string; model?: string; size?: string } } : null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    draftStep: row.draftStep,
    draftVersion: row.draftVersion,
    progress: row.progress,
    runMode: row.runMode,
    pipelinePhase: pipeline?.phase ?? null,
    keyframeUrl: pipeline?.keyframe?.objectKey ? `/api/media/${encodeURIComponent(pipeline.keyframe.objectKey)}` : null,
    keyframeModel: pipeline?.keyframe?.model ?? null,
    keyframeSize: pipeline?.keyframe?.size ?? null,
    activity: pipeline?.events ?? [],
    error: row.errorJson ? JSON.parse(row.errorJson) : null,
    createdAt: row.runStartedAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    input: JSON.parse(row.inputJson),
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await context.params;
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId(request)))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });

    if (!["draft", "completed", "failed", "cancelled"].includes(row.status)) {
      const pipelineState = row.pipelineJson ? JSON.parse(row.pipelineJson) as ArkPipelineState & { _lock?: { token: string; until: number } } : null;
      if (pipelineState?._lock && pipelineState._lock.until > Date.now()) return Response.json({ project: present(row) });
      const unlockedState = pipelineState ? { ...pipelineState } : null;
      if (unlockedState) delete unlockedState._lock;
      const lockToken = crypto.randomUUID();
      const lockedJson = unlockedState ? JSON.stringify({ ...unlockedState, _lock: { token: lockToken, until: Date.now() + 120_000 } }) : null;
      let lockedRow = row;
      if (row.runMode === "production" && row.pipelineJson && lockedJson) {
        const [acquired] = await db.update(projects).set({ pipelineJson: lockedJson }).where(and(
          eq(projects.id, id),
          eq(projects.ownerId, ownerId(request)),
          eq(projects.pipelineJson, row.pipelineJson),
        )).returning();
        if (!acquired) return Response.json({ project: present(row) });
        lockedRow = acquired;
      }
      const input = { ...JSON.parse(row.inputJson), projectId: row.id, title: row.title } as PipelineInput;
      const snapshot = await readPipeline({
        providerJobId: row.providerJobId,
        createdAt: row.runStartedAt ?? row.createdAt,
        input,
        state: unlockedState,
        ownerId: ownerId(request),
      });
      const changed = snapshot.status !== row.status || snapshot.progress !== row.progress || Boolean(snapshot.result) !== Boolean(row.resultJson);
      if (changed || snapshot.state) {
        const now = new Date().toISOString();
        const [updated] = await db.update(projects).set({
          status: snapshot.status,
          progress: snapshot.progress,
          providerJobId: snapshot.providerJobId ?? row.providerJobId,
          pipelineJson: snapshot.state ? JSON.stringify(snapshot.state) : row.pipelineJson,
          resultJson: snapshot.result ? JSON.stringify(snapshot.result) : row.resultJson,
          errorJson: snapshot.error ? JSON.stringify(snapshot.error) : row.errorJson,
          updatedAt: now,
        }).where(and(
          eq(projects.id, id),
          eq(projects.ownerId, ownerId(request)),
          row.runMode === "production" && lockedJson ? eq(projects.pipelineJson, lockedRow.pipelineJson) : eq(projects.status, row.status),
        )).returning();
        if (!updated) return Response.json({ project: present(row) });
        return Response.json({ project: present(updated) });
      }
    }
    return Response.json({ project: present(row) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取任务失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    const { id } = await context.params;
    const body = await request.json() as PatchDraftBody;
    if (!body.step || !body.data || typeof body.draftVersion !== "number") return Response.json({ error: "缺少草稿步骤、数据或版本" }, { status: 400 });

    const db = getDb();
    const owner = ownerId(request);
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "draft") return Response.json({ error: "任务已经开始制作，不能再修改草稿" }, { status: 409 });
    if (row.draftVersion !== body.draftVersion) return Response.json({ error: "草稿已在其他页面更新，请刷新后重试" }, { status: 409 });

    const input = JSON.parse(row.inputJson) as Record<string, unknown>;
    let draftStep = row.draftStep;
    let title = row.title;

    if (body.step === "references") {
      const references = body.data.references;
      if (!Array.isArray(references) || references.length > 10 || (body.advance && references.length < 1)) return Response.json({ error: "参考视频数量必须为 1～10 个" }, { status: 400 });
      for (const reference of references as Array<Record<string, unknown>>) {
        if (reference.kind === "file") {
          if (typeof reference.uploadId !== "string") return Response.json({ error: "存在尚未上传完成的参考视频" }, { status: 400 });
          const [upload] = await db.select().from(uploads).where(and(eq(uploads.id, reference.uploadId), eq(uploads.ownerId, owner), eq(uploads.projectId, id), eq(uploads.status, "ready"))).limit(1);
          if (!upload) return Response.json({ error: "参考视频不存在、未完成或不属于当前项目" }, { status: 400 });
        } else if (reference.kind !== "url" || typeof reference.url !== "string" || (!/^https?:\/\//i.test(reference.url) && !reference.url.startsWith("demo://"))) {
          return Response.json({ error: "参考链接格式无效" }, { status: 400 });
        }
      }
      input.references = references;
      draftStep = body.advance ? "requirements" : "references";
    }

    if (body.step === "requirements") {
      const topicMode = body.data.topicMode;
      const topic = typeof body.data.topic === "string" ? body.data.topic.trim() : "";
      const audience = typeof body.data.audience === "string" ? body.data.audience.trim() : "";
      const goal = typeof body.data.goal === "string" ? body.data.goal.trim() : "";
      if (!audience || !goal || (topicMode === "manual" && !topic)) return Response.json({ error: "请完整填写主题、内容目标和目标观众" }, { status: 400 });
      Object.assign(input, body.data, { topic, audience, goal });
      title = topicMode === "manual" ? topic : "AI 自动主题 · 参考灵感融合";
      draftStep = body.advance ? "settings" : "requirements";
    }

    if (body.step === "settings") {
      if (!["抖音", "小红书"].includes(String(body.data.platform)) || Number(body.data.duration) !== 15 || !String(body.data.style ?? "").trim()) return Response.json({ error: "MVP 当前固定生成 15 秒成片，请检查平台、时长或风格" }, { status: 400 });
      if (body.advance && body.data.rightsConfirmed !== true) return Response.json({ error: "必须确认素材使用权" }, { status: 400 });
      Object.assign(input, body.data, { ratio: "9:16" });
      input.quote = calculateCostQuote(Array.isArray(input.references) ? input.references.length : 0, Number(body.data.duration));
      input.costConfirmed = false;
      delete input.costConfirmedAt;
      draftStep = body.advance ? "quote" : "settings";
    }

    if (body.step === "quote") {
      if (row.draftStep !== "quote") return Response.json({ error: "请先完成成片设置并获取成本预估" }, { status: 409 });
      if (body.data.accepted !== true) return Response.json({ error: "请先确认预计平台成本" }, { status: 400 });
      const quote = calculateCostQuote(Array.isArray(input.references) ? input.references.length : 0, Number(input.duration));
      if (body.data.quoteVersion !== quote.version) return Response.json({ error: "成本预估已更新，请刷新后重新确认" }, { status: 409 });
      input.quote = quote;
      input.costConfirmed = true;
      input.costConfirmedAt = new Date().toISOString();
      draftStep = "quote";
    }

    const [updated] = await db.update(projects).set({ title, draftStep, draftVersion: row.draftVersion + 1, inputJson: JSON.stringify(input), updatedAt: new Date().toISOString() }).where(and(eq(projects.id, id), eq(projects.ownerId, owner), eq(projects.draftVersion, row.draftVersion))).returning();
    if (!updated) return Response.json({ error: "草稿已被更新，请刷新后重试" }, { status: 409 });
    return Response.json({ project: present(updated) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "草稿保存失败" }, { status: 500 });
  }
}
