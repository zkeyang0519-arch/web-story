import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects, uploads } from "@/db/schema";
import { hydratePipelineInput, readPipeline, type ArkPipelineState } from "@/lib/pipeline";
import { calculateCostQuote } from "@/lib/cost";
import { presentProject } from "@/lib/project-view";
import {
  VIDEO_DURATION_OPTIONS,
  validateVideoSpec,
  type VideoSpec,
} from "@/lib/video-config";

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

function savedVideoSpec(input: Record<string, unknown>): VideoSpec {
  const validation = validateVideoSpec({
    duration: typeof input.duration === "number" ? input.duration : 15,
    videoModel: typeof input.videoModel === "string" ? input.videoModel : "seedance-2.0-standard",
    ratio: typeof input.ratio === "string" ? input.ratio : "9:16",
    resolution: typeof input.resolution === "string" ? input.resolution : "1080p",
    fps: typeof input.fps === "number" ? input.fps : 24,
  });
  if (validation.ok) return validation.spec;
  return {
    duration: 15,
    videoModel: "seedance-2.0-standard",
    ratio: "9:16",
    resolution: "1080p",
    fps: 24,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await context.params;
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId(request)))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });

    if (!["draft", "awaiting_review", "needs_action", "completed", "failed", "cancelled"].includes(row.status)) {
      const pipelineState = row.pipelineJson ? JSON.parse(row.pipelineJson) as ArkPipelineState & { _lock?: { token: string; until: number } } : null;
      if (pipelineState?._lock && pipelineState._lock.until > Date.now()) return Response.json({ project: presentProject(row) });
      const unlockedState = pipelineState ? { ...pipelineState } : null;
      if (unlockedState) delete unlockedState._lock;
      const lockToken = crypto.randomUUID();
      const lockedJson = unlockedState ? JSON.stringify({ ...unlockedState, _lock: { token: lockToken, until: Date.now() + 600_000 } }) : null;
      let lockedRow = row;
      if (row.runMode === "production" && row.pipelineJson && lockedJson) {
        const [acquired] = await db.update(projects).set({ pipelineJson: lockedJson }).where(and(
          eq(projects.id, id),
          eq(projects.ownerId, ownerId(request)),
          eq(projects.pipelineJson, row.pipelineJson),
        )).returning();
        if (!acquired) return Response.json({ project: presentProject(row) });
        lockedRow = acquired;
      }
      const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
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
          row.runMode === "production" && lockedJson ? eq(projects.pipelineJson, lockedRow.pipelineJson ?? lockedJson) : eq(projects.status, row.status),
        )).returning();
        if (!updated) return Response.json({ project: presentProject(row) });
        return Response.json({ project: presentProject(updated) });
      }
    }
    return Response.json({ project: presentProject(row) });
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
      if (!["抖音", "小红书"].includes(String(body.data.platform)) || !String(body.data.style ?? "").trim()) {
        return Response.json({ error: "请检查发布平台与画面风格" }, { status: 400 });
      }
      const videoSpec = validateVideoSpec({
        duration: body.data.duration,
        videoModel: body.data.videoModel,
        ratio: body.data.ratio,
        resolution: body.data.resolution,
        fps: body.data.fps,
      });
      if (!videoSpec.ok || !(VIDEO_DURATION_OPTIONS as readonly number[]).includes(Number(body.data.duration))) {
        const details = videoSpec.ok ? "成片时长不在可选范围内" : videoSpec.errors.join("；");
        return Response.json({ error: `视频规格无效：${details}` }, { status: 400 });
      }
      if (body.advance && body.data.rightsConfirmed !== true) return Response.json({ error: "必须确认素材使用权" }, { status: 400 });
      Object.assign(input, body.data, videoSpec.spec);
      input.quote = calculateCostQuote(
        Array.isArray(input.references) ? input.references.length : 0,
        videoSpec.spec.duration,
        videoSpec.spec.videoModel,
        videoSpec.spec.resolution,
      );
      input.costConfirmed = false;
      delete input.costConfirmedAt;
      draftStep = body.advance ? "quote" : "settings";
    }

    if (body.step === "quote") {
      if (row.draftStep !== "quote") return Response.json({ error: "请先完成成片设置并获取成本预估" }, { status: 409 });
      if (body.data.accepted !== true) return Response.json({ error: "请先确认预计平台成本" }, { status: 400 });
      const videoSpec = savedVideoSpec(input);
      const quote = calculateCostQuote(
        Array.isArray(input.references) ? input.references.length : 0,
        videoSpec.duration,
        videoSpec.videoModel,
        videoSpec.resolution,
      );
      if (body.data.quoteVersion !== quote.version) return Response.json({ error: "成本预估已更新，请刷新后重新确认" }, { status: 409 });
      input.quote = quote;
      input.costConfirmed = true;
      input.costConfirmedAt = new Date().toISOString();
      draftStep = "quote";
    }

    const [updated] = await db.update(projects).set({ title, draftStep, draftVersion: row.draftVersion + 1, inputJson: JSON.stringify(input), updatedAt: new Date().toISOString() }).where(and(eq(projects.id, id), eq(projects.ownerId, owner), eq(projects.draftVersion, row.draftVersion))).returning();
    if (!updated) return Response.json({ error: "草稿已被更新，请刷新后重试" }, { status: 409 });
    return Response.json({ project: presentProject(updated) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "草稿保存失败" }, { status: 500 });
  }
}
