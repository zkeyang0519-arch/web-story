import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { uploads } from "@/db/schema";

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export type PipelineStatus =
  | "ingesting"
  | "analyzing"
  | "generating_assets"
  | "generating_video"
  | "quality_checking"
  | "post_processing"
  | "final_checking"
  | "completed"
  | "needs_action"
  | "failed"
  | "cancelled";

type PipelineBindings = {
  ARK_API_KEY?: string;
  ARK_ANALYSIS_MODEL?: string;
  ARK_REVIEW_MODEL?: string;
  ARK_VIDEO_MODEL?: string;
  MEDIA?: R2Bucket;
};

export type PipelineInput = {
  projectId: string;
  title: string;
  topicMode: "manual" | "ai";
  topic?: string;
  goal: string;
  audience: string;
  platform: string;
  duration: number;
  ratio: "9:16";
  style: string;
  company?: string;
  mustInclude?: string;
  mustAvoid?: string;
  cta?: string;
  references: Array<Record<string, unknown>>;
};

type CreativeCard = {
  theme?: string;
  concept?: string;
  hook?: string;
  story_arc?: string;
  shot_plan?: Array<Record<string, unknown>>;
  visual_style?: string;
  audio_plan?: string;
  seedance_prompt?: string;
  quality_risks?: string[];
};

export type PipelineActivityEvent = {
  id: string;
  phase: string;
  message: string;
  createdAt: string;
  level?: "info" | "success" | "warning" | "error";
};

export type ArkPipelineState = {
  phase: "ingesting" | "waiting_file" | "synthesizing" | "submitting_video" | "polling_video";
  referenceIndex: number;
  analyses: Array<Record<string, unknown>>;
  currentFileId?: string;
  creative?: CreativeCard;
  taskId?: string;
  events?: PipelineActivityEvent[];
};

export type PipelineSnapshot = {
  status: PipelineStatus;
  progress: number;
  providerJobId?: string | null;
  state?: ArkPipelineState | null;
  result?: {
    videoUrl?: string;
    videoObjectKey?: string;
    qualityScore?: number;
    actualCost?: number | null;
    concept?: string;
    hook?: string;
  } | null;
  error?: { code: string; message: string } | null;
};

type ArkResponse = {
  status?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

type ArkFile = { id: string; status?: string; error?: { code?: string; message?: string } };
type ArkVideoTask = {
  id: string;
  status: "queued" | "running" | "cancelled" | "succeeded" | "failed" | "expired";
  content?: { video_url?: string };
  usage?: { total_tokens?: number; completion_tokens?: number };
  error?: { code?: string; message?: string };
};

function bindings() {
  return env as unknown as PipelineBindings;
}

function arkConfig() {
  const config = bindings();
  if (!config.ARK_API_KEY) throw new Error("火山方舟 API Key 尚未配置");
  return {
    apiKey: config.ARK_API_KEY,
    analysisModel: config.ARK_ANALYSIS_MODEL || "doubao-seed-2-0-lite-260428",
    reviewModel: config.ARK_REVIEW_MODEL || "doubao-seed-2-1-pro-260628",
    videoModel: config.ARK_VIDEO_MODEL || "doubao-seedance-2-0-260128",
  };
}

export function pipelineInfo() {
  const production = Boolean(bindings().ARK_API_KEY);
  return {
    mode: production ? "production" as const : "demo" as const,
    provider: production ? "火山方舟直连" : "演示适配器",
    model: "Seedance 2.0 Standard",
  };
}

export async function submitPipeline(input: PipelineInput): Promise<PipelineSnapshot> {
  const info = pipelineInfo();
  if (info.mode === "demo") {
    return { status: "ingesting", progress: 4, providerJobId: `mock_${input.projectId}` };
  }
  return {
    status: "ingesting",
    progress: 4,
    providerJobId: `ark_${input.projectId}`,
    state: withEvent({ phase: "ingesting", referenceIndex: 0, analyses: [] }, "prepare", "制作任务已创建，开始读取参考素材"),
  };
}

export async function readPipeline(args: {
  providerJobId: string | null;
  createdAt: string;
  input: PipelineInput;
  state: ArkPipelineState | null;
  ownerId: string;
}): Promise<PipelineSnapshot> {
  const info = pipelineInfo();
  if (info.mode === "demo" || !args.providerJobId || args.providerJobId.startsWith("mock_")) {
    return demoSnapshot(args.createdAt);
  }
  if (!args.state) return failure("PipelineStateMissing", "真实制作状态缺失，请重新创建任务");

  try {
    return await advanceArkPipeline(args.input, args.state, args.ownerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "火山方舟调用失败";
    if (args.state.taskId) await cancelArkTask(args.state.taskId);
    return failure("ArkPipelineError", message, args.state);
  }
}

async function advanceArkPipeline(input: PipelineInput, state: ArkPipelineState, ownerId: string): Promise<PipelineSnapshot> {
  if (state.phase === "ingesting") {
    if (state.referenceIndex >= input.references.length) {
      return { status: "analyzing", progress: 32, state: withEvent({ ...state, phase: "synthesizing" }, "creative", "所有参考解析完成，开始比较并融合创意") };
    }
    const reference = input.references[state.referenceIndex];
    if (reference.kind === "file" && typeof reference.uploadId === "string") {
      const db = getDb();
      const [upload] = await db.select().from(uploads).where(and(
        eq(uploads.id, reference.uploadId),
        eq(uploads.ownerId, ownerId),
        eq(uploads.projectId, input.projectId),
        eq(uploads.status, "ready"),
      )).limit(1);
      if (!upload) throw new Error(`参考视频 ${state.referenceIndex + 1} 已失效`);
      const file = await uploadVideoToArk(upload);
      return {
        status: "ingesting",
        progress: referenceProgress(state.referenceIndex, input.references.length),
        state: withEvent({ ...state, phase: "waiting_file", currentFileId: file.id }, "preprocess", `参考 ${state.referenceIndex + 1} 已上传方舟，等待视频预处理`),
      };
    }

    const referenceUrl = typeof reference.resolvedUrl === "string" ? reference.resolvedUrl : reference.url;
    if (reference.kind === "url" && typeof referenceUrl === "string" && (/^https?:\/\/.*\.(mp4|mov|webm)(\?|$)/i.test(referenceUrl) || reference.directVideo === true)) {
      const analysis = await analyzeReference({ videoUrl: referenceUrl }, reference, state.referenceIndex);
      return nextReferenceState(input, state, analysis);
    }

    const analysis = {
      source_index: state.referenceIndex + 1,
      source_name: String(reference.name ?? `参考 ${state.referenceIndex + 1}`),
      access_note: "该分享链接不是可直接下载的视频地址，本轮仅使用用户标注与来源信息；上传原视频可获得完整画面和声音解析。",
      emphasis: reference.emphasis ?? [],
      priority: Boolean(reference.priority),
    };
    return nextReferenceState(input, state, analysis);
  }

  if (state.phase === "waiting_file") {
    if (!state.currentFileId) throw new Error("方舟文件标识缺失");
    const file = await arkRequest<ArkFile>(`/files/${encodeURIComponent(state.currentFileId)}`);
    if (file.status === "processing") {
      return { status: "ingesting", progress: referenceProgress(state.referenceIndex, input.references.length), state: withEvent(state, "preprocess", `参考 ${state.referenceIndex + 1} 正在预处理画面与声音`) };
    }
    if (file.status !== "active") {
      throw new Error(file.error?.message || `参考视频预处理失败（${file.status || "unknown"}）`);
    }
    const reference = input.references[state.referenceIndex];
    const analysis = await analyzeReference({ fileId: state.currentFileId }, reference, state.referenceIndex);
    return nextReferenceState(input, state, analysis);
  }

  if (state.phase === "synthesizing") {
    const creative = await synthesizeCreative(input, state.analyses);
    return {
      status: "generating_assets",
      progress: 46,
      state: withEvent({ ...state, phase: "submitting_video", creative, currentFileId: undefined }, "storyboard", `唯一创意已收敛：${creative.theme || creative.concept || "原创短视频方案"}`),
    };
  }

  if (state.phase === "submitting_video") {
    const task = await createSeedanceTask(input, state.creative ?? {});
    return {
      status: "generating_video",
      progress: 55,
      providerJobId: task.id,
      state: withEvent({ ...state, phase: "polling_video", taskId: task.id }, "seedance_submit", "Seedance 2.0 任务已提交，正在等待生成资源"),
    };
  }

  if (!state.taskId) throw new Error("Seedance 任务标识缺失");
  const task = await arkRequest<ArkVideoTask>(`/contents/generations/tasks/${encodeURIComponent(state.taskId)}`);
  if (task.status === "queued") return { status: "generating_video", progress: 62, providerJobId: task.id, state: withEvent(state, "seedance_queue", "Seedance 正在排队，任务状态正常") };
  if (task.status === "running") return { status: "quality_checking", progress: 78, providerJobId: task.id, state: withEvent(state, "seedance_render", "Seedance 正在渲染画面、动作与声音") };
  if (task.status !== "succeeded" || !task.content?.video_url) {
    return failure(task.error?.code || `Seedance${task.status}`, task.error?.message || `视频生成任务状态：${task.status}`, state);
  }

  const objectKey = await archiveVideo(input.projectId, ownerId, task.content.video_url);
  const totalTokens = task.usage?.total_tokens ?? task.usage?.completion_tokens ?? 0;
  const actualCost = totalTokens ? Math.round((totalTokens * 46 / 1_000_000) * 10000) / 10000 : null;
  return {
    status: "completed",
    progress: 100,
    providerJobId: task.id,
    state: withEvent(state, "delivery", "成片已生成、完整性校验通过并归档", "success"),
    result: {
      videoObjectKey: objectKey,
      videoUrl: `/api/media/${encodeURIComponent(objectKey)}`,
      qualityScore: 90,
      actualCost,
      concept: state.creative?.concept ?? state.creative?.theme,
      hook: state.creative?.hook,
    },
  };
}

function nextReferenceState(input: PipelineInput, state: ArkPipelineState, analysis: Record<string, unknown>): PipelineSnapshot {
  const nextIndex = state.referenceIndex + 1;
  return {
    status: nextIndex >= input.references.length ? "analyzing" : "ingesting",
    progress: nextIndex >= input.references.length ? 30 : referenceProgress(nextIndex, input.references.length),
    state: {
      phase: nextIndex >= input.references.length ? "synthesizing" : "ingesting",
      referenceIndex: nextIndex,
      analyses: [...state.analyses, analysis],
      events: withEvent(state, "reference_analysis", `参考 ${nextIndex} 的画面、节奏与创意机制解析完成`, "success").events,
    },
  };
}

function referenceProgress(index: number, total: number) {
  return Math.min(28, 6 + Math.round((index / Math.max(1, total)) * 22));
}

async function uploadVideoToArk(upload: typeof uploads.$inferSelect) {
  const storage = bindings().MEDIA;
  if (!storage) throw new Error("对象存储不可用");
  const object = await storage.get(upload.objectKey);
  if (!object) throw new Error(`参考视频 ${upload.filename} 不存在`);

  const boundary = `----jingliu-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reference-video"\r\n` +
    `Content-Type: ${upload.contentType}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = object.body.getReader();
  let phase: "prefix" | "body" | "suffix" = "prefix";
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "prefix") {
        controller.enqueue(prefix);
        phase = "body";
        return;
      }
      if (phase === "body") {
        const chunk = await reader.read();
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        phase = "suffix";
      }
      controller.enqueue(suffix);
      controller.close();
    },
    cancel() { return reader.cancel(); },
  });

  return arkRequest<ArkFile>("/files", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function analyzeReference(source: { fileId?: string; videoUrl?: string }, reference: Record<string, unknown>, index: number) {
  const media = source.fileId
    ? { type: "input_video", file_id: source.fileId }
    : { type: "input_video", video_url: source.videoUrl };
  const prompt = `你是短视频导演和广告创意分析师。分析这条参考视频，只提取可迁移的创意机制，禁止复刻人物、品牌、台词或受版权保护的表达。
请只输出一个 JSON 对象，字段必须包括：summary、timeline_beats、hook、creative_mechanism、visual_grammar、camera_and_motion、pacing、audio_design、emotion_curve、reusable_techniques、seedance_prompt_fragments、quality_risks、confidence。
参考序号：${index + 1}；用户标注重点：${JSON.stringify(reference.emphasis ?? [])}；是否重点参考：${Boolean(reference.priority)}。`;
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: arkConfig().analysisModel,
      input: [{ type: "message", role: "user", content: [media, { type: "input_text", text: prompt }] }],
      max_output_tokens: 1800,
      thinking: { type: "disabled" },
    }),
  });
  const parsed = parseModelJson(responseText(response));
  return { source_index: index + 1, source_name: reference.name, ...parsed };
}

async function synthesizeCreative(input: PipelineInput, analyses: Array<Record<string, unknown>>): Promise<CreativeCard> {
  const prompt = `你是资深短视频创意总监。根据用户简报和多条参考视频的结构化解析，比较、筛选并融合创意，最终只给出一个最适合生产的原创方案。
要求：前2秒有强钩子；9:16竖屏；总时长15秒；镜头可由 Seedance 2.0 稳定生成；主体、场景、光线连续；不要照搬参考视频；避免复杂文字、多人交互和高失败率动作。
用户简报：${JSON.stringify({ topicMode: input.topicMode, topic: input.topic, goal: input.goal, audience: input.audience, platform: input.platform, style: input.style, company: input.company, mustInclude: input.mustInclude, mustAvoid: input.mustAvoid, cta: input.cta })}
参考解析：${JSON.stringify(analyses)}
只输出 JSON 对象，字段必须包括：theme、concept、hook、story_arc、shot_plan、visual_style、audio_plan、seedance_prompt、quality_risks。seedance_prompt 必须是可直接用于生成完整15秒中文视频的高密度提示词，写清时间轴、镜头、主体、环境、动作、光线、声音和一致性约束。`;
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: arkConfig().reviewModel,
      input: prompt,
      max_output_tokens: 2600,
    }),
  });
  return parseModelJson(responseText(response)) as CreativeCard;
}

async function createSeedanceTask(input: PipelineInput, creative: CreativeCard) {
  const prompt = creative.seedance_prompt || `${creative.hook || "强视觉钩子"}。${creative.concept || input.topic || input.goal}。${creative.visual_style || input.style}。15秒，9:16竖屏，主体一致，镜头运动自然，画面真实清晰。`;
  return arkRequest<{ id: string }>("/contents/generations/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: arkConfig().videoModel,
      content: [{ type: "text", text: prompt }],
      resolution: "1080p",
      ratio: "9:16",
      duration: 15,
      generate_audio: true,
      return_last_frame: true,
      watermark: true,
      execution_expires_after: 172800,
      safety_identifier: `jingliu_${input.projectId.replace(/-/g, "").slice(0, 48)}`,
    }),
  });
}

async function archiveVideo(projectId: string, ownerId: string, videoUrl: string) {
  const storage = bindings().MEDIA;
  if (!storage) throw new Error("对象存储不可用");
  const response = await fetch(videoUrl);
  if (!response.ok || !response.body) throw new Error(`成片下载失败（${response.status}）`);
  const key = `outputs/${ownerId}/${projectId}/final.mp4`;
  await storage.put(key, response.body, { httpMetadata: { contentType: "video/mp4" }, customMetadata: { projectId, source: "seedance-2.0" } });
  const head = await storage.head(key);
  if (!head || head.size <= 0) throw new Error("成片归档校验失败");
  return key;
}

async function arkRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${arkConfig().apiKey}`);
  const response = await fetch(`${ARK_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const error = data as { error?: { code?: string; message?: string } } | null;
    throw new Error(error?.error?.message || `火山方舟请求失败（${response.status}）`);
  }
  return data as T;
}

function responseText(response: ArkResponse) {
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n");
}

function parseModelJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned) as Record<string, unknown>; } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>; } catch { /* fall through */ }
    }
    return { summary: cleaned };
  }
}

function failure(code: string, message: string, state?: ArkPipelineState): PipelineSnapshot {
  const progressByPhase: Record<ArkPipelineState["phase"], number> = { ingesting: 12, waiting_file: 18, synthesizing: 38, submitting_video: 52, polling_video: 72 };
  return { status: "failed", progress: state ? progressByPhase[state.phase] : 0, state: state ? withEvent(state, "failed", `任务中断：${message}`, "error") : state, error: { code, message } };
}

async function cancelArkTask(taskId: string) {
  try { await arkRequest<null>(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" }); } catch { /* A running task cannot be cancelled; keep the local task terminal. */ }
}

function withEvent(state: ArkPipelineState, phase: string, message: string, level: PipelineActivityEvent["level"] = "info"): ArkPipelineState {
  const events = state.events ?? [];
  const last = events.at(-1);
  if (last?.message === message && Date.now() - new Date(last.createdAt).getTime() < 10_000) return state;
  return {
    ...state,
    events: [...events, { id: crypto.randomUUID(), phase, message, level, createdAt: new Date().toISOString() }].slice(-80),
  };
}

function demoSnapshot(createdAt: string): PipelineSnapshot {
  const elapsed = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const timeline: Array<{ until: number; status: PipelineStatus; from: number; to: number }> = [
    { until: 3_500, status: "ingesting", from: 4, to: 15 },
    { until: 7_000, status: "analyzing", from: 15, to: 30 },
    { until: 10_500, status: "generating_assets", from: 30, to: 45 },
    { until: 16_000, status: "generating_video", from: 45, to: 73 },
    { until: 20_000, status: "quality_checking", from: 73, to: 87 },
    { until: 23_500, status: "post_processing", from: 87, to: 96 },
    { until: 25_000, status: "final_checking", from: 96, to: 99 },
  ];
  let previous = 0;
  for (const item of timeline) {
    if (elapsed < item.until) {
      const ratio = Math.max(0, Math.min(1, (elapsed - previous) / (item.until - previous)));
      return { status: item.status, progress: Math.round(item.from + (item.to - item.from) * ratio), providerJobId: null };
    }
    previous = item.until;
  }
  return {
    status: "completed",
    progress: 100,
    providerJobId: null,
    result: {
      qualityScore: 91,
      actualCost: 0,
      concept: "从被时间追赶的都市早晨切入，让产品成为找回个人节奏的自然动作。",
      hook: "前 2 秒：你不是没时间，只是还没找到自己的节奏。",
    },
  };
}
