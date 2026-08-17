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
  | "awaiting_review"
  | "needs_action"
  | "failed"
  | "cancelled";

type PipelineBindings = {
  ARK_API_KEY?: string;
  ARK_ANALYSIS_MODEL?: string;
  ARK_REVIEW_MODEL?: string;
  ARK_CREATIVE_FALLBACK_MODELS?: string;
  ARK_IMAGE_MODEL?: string;
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

export type CreativeCard = {
  schema_version?: "creative_card.v1";
  brief_topic?: string;
  theme?: string;
  concept?: string;
  hook?: string;
  story_arc?: string;
  shot_plan?: Array<Record<string, unknown>>;
  visual_style?: string;
  audio_plan?: string;
  seedance_prompt?: string;
  quality_risks?: string[];
  source_trace?: Array<{ source_index: number; adopted_elements: string[] }>;
  constraint_trace?: { must_include: string[]; must_avoid: string[] };
};

export type CreativeAttempt = {
  model: string;
  strategy: "primary" | "repair" | "fallback";
  status: "accepted" | "invalid" | "request_error";
  errors: string[];
  createdAt: string;
  responseStatus?: string;
  rawExcerpt?: string;
};

export type PipelineDiagnosticLog = {
  id: string;
  createdAt: string;
  stage: string;
  operation: string;
  status: "started" | "succeeded" | "invalid" | "request_error";
  message: string;
  model?: string;
  attempt?: number;
  durationMs?: number;
  providerResponseId?: string;
  providerStatus?: string;
  errorCode?: string;
  validationErrors?: string[];
  responseExcerpt?: string;
};

export type StoryboardFrame = {
  id: string;
  order: number;
  time_range: string;
  title: string;
  narrative_goal: string;
  prompt: string;
  motion: string;
};

export type ImagePlan = {
  continuity_anchor: string;
  frames: StoryboardFrame[];
};

export type StoryboardImage = {
  frameId: string;
  order: number;
  sourceUrl: string;
  objectKey: string;
  size?: string;
  model?: string;
  cost: number;
  generatedAt: string;
};

export type QualityReport = {
  passed: boolean;
  brief_alignment: number;
  visual_consistency: number;
  constraint_coverage: number;
  issues: string[];
  summary: string;
};

export type CanvasPlan = {
  frames: Array<{ frameId: string; order: number; motion: string }>;
  transitions: Array<{ fromFrameId: string; toFrameId: string; description: string }>;
  confirmedAt?: string;
};

export type PipelineActivityEvent = {
  id: string;
  phase: string;
  message: string;
  createdAt: string;
  level?: "info" | "success" | "warning" | "error";
};

export type ArkPipelineState = {
  phase:
    | "ingesting"
    | "waiting_file"
    | "synthesizing"
    | "creative_recovery"
    | "awaiting_creative_review"
    | "planning_images"
    | "awaiting_image_plan"
    | "generating_images"
    | "reviewing_images"
    | "awaiting_canvas_review"
    | "submitting_video"
    | "polling_video"
    | "reviewing_video";
  revision: number;
  referenceIndex: number;
  analyses: Array<Record<string, unknown>>;
  currentFileId?: string;
  creative?: CreativeCard;
  creativeAttempts?: CreativeAttempt[];
  creativeRecovery?: {
    retryable: true;
    failedAt: string;
    message: string;
  };
  stepRecovery?: {
    retryable: true;
    stage: string;
    resumePhase: ArkPipelineState["phase"];
    failedAt: string;
    message: string;
    model?: string;
  };
  diagnostics?: PipelineDiagnosticLog[];
  imagePlan?: ImagePlan;
  storyboardImages?: StoryboardImage[];
  imageQuality?: QualityReport;
  videoQuality?: QualityReport;
  canvas?: CanvasPlan;
  approvals?: {
    creativeAt?: string;
    imagePlanAt?: string;
    canvasAt?: string;
  };
  taskId?: string;
  candidateVideoUrl?: string;
  videoUsageTokens?: number;
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
  error?: {
    code: string;
    message: string;
    recoverable?: boolean;
    stage?: string;
    model?: string;
    attempts?: number;
  } | null;
};

type ArkResponse = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
    status?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

class CreativeSynthesisFailure extends Error {
  attempts: CreativeAttempt[];

  constructor(message: string, attempts: CreativeAttempt[]) {
    super(message);
    this.name = "CreativeSynthesisFailure";
    this.attempts = attempts;
  }
}

class PipelineStepFailure extends Error {
  diagnostic: PipelineDiagnosticLog;

  constructor(message: string, diagnostic: Omit<PipelineDiagnosticLog, "id" | "createdAt">) {
    super(message);
    this.name = "PipelineStepFailure";
    this.diagnostic = { ...diagnostic, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  }
}

type ArkFile = { id: string; status?: string; error?: { code?: string; message?: string } };
type ArkVideoTask = {
  id: string;
  status: "queued" | "running" | "cancelled" | "succeeded" | "failed" | "expired";
  content?: { video_url?: string };
  usage?: { total_tokens?: number; completion_tokens?: number };
  error?: { code?: string; message?: string };
};

type ArkImageResponse = {
  model?: string;
  data?: Array<{ url?: string; size?: string }>;
  usage?: { generated_images?: number; total_tokens?: number };
};

function bindings() {
  return env as unknown as PipelineBindings;
}

function arkConfig() {
  const config = bindings();
  if (!config.ARK_API_KEY) throw new Error("火山方舟 API Key 尚未配置");
  const analysisModel = config.ARK_ANALYSIS_MODEL || "doubao-seed-2-0-lite-260428";
  const reviewModel = config.ARK_REVIEW_MODEL || "doubao-seed-2-1-pro-260628";
  const configuredFallbacks = (config.ARK_CREATIVE_FALLBACK_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    apiKey: config.ARK_API_KEY,
    analysisModel,
    reviewModel,
    creativeFallbackModels: configuredFallbacks.length ? configuredFallbacks : [analysisModel],
    imageModel: config.ARK_IMAGE_MODEL || "doubao-seedream-5-0-lite-260128",
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
    return {
      status: "ingesting",
      progress: 4,
      providerJobId: `mock_${input.projectId}`,
      state: withEvent({ phase: "ingesting", revision: 1, referenceIndex: 0, analyses: [] }, "prepare", "演示任务已创建，开始读取参考素材"),
    };
  }
  return {
    status: "ingesting",
    progress: 4,
    providerJobId: `ark_${input.projectId}`,
    state: withEvent({ phase: "ingesting", revision: 1, referenceIndex: 0, analyses: [] }, "prepare", "制作任务已创建，开始读取参考素材"),
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
    if (!args.state) return failure("PipelineStateMissing", "演示制作状态缺失，请重新创建任务");
    return advanceDemoPipeline(args.input, args.state);
  }
  if (!args.state) return failure("PipelineStateMissing", "真实制作状态缺失，请重新创建任务");

  try {
    return await advanceArkPipeline(args.input, args.state, args.ownerId);
  } catch (error) {
    if (error instanceof CreativeSynthesisFailure) {
      const attempts = [...(args.state.creativeAttempts ?? []), ...error.attempts];
      const message = "创意融合连续未通过结构校验；已保留全部参考视频解析，可仅重试创意融合";
      const recoveryState = withEvent({
        ...args.state,
        phase: "creative_recovery",
        currentFileId: undefined,
        creativeAttempts: attempts,
        creativeRecovery: {
          retryable: true,
          failedAt: new Date().toISOString(),
          message,
        },
      }, "creative_recovery", `${message}（已尝试 ${error.attempts.length} 次）`, "error");
      return {
        status: "needs_action",
        progress: 34,
        state: recoveryState,
        error: {
          code: "CreativeStructureInvalid",
          message,
          recoverable: true,
          stage: "creative_synthesis",
          model: error.attempts.at(-1)?.model ?? arkConfig().reviewModel,
          attempts: error.attempts.length,
        },
      };
    }
    if (error instanceof PipelineStepFailure) {
      const message = `${error.diagnostic.stage}未返回可用的结构化结果；当前阶段已暂停，可查看诊断日志后仅重试本步骤`;
      const recoveryState = withEvent({
        ...args.state,
        diagnostics: appendDiagnostic(args.state.diagnostics, error.diagnostic),
        stepRecovery: {
          retryable: true,
          stage: error.diagnostic.stage,
          resumePhase: args.state.phase,
          failedAt: new Date().toISOString(),
          message,
          model: error.diagnostic.model,
        },
      }, "step_recovery", message, "error");
      return {
        status: "needs_action",
        progress: progressForPhase(args.state.phase),
        state: recoveryState,
        error: {
          code: "StructuredOutputInvalid",
          message,
          recoverable: true,
          stage: error.diagnostic.stage,
          model: error.diagnostic.model,
          attempts: 1,
        },
      };
    }
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

    throw new Error(`参考 ${state.referenceIndex + 1} 没有取得可解析的视频文件，请上传原视频后重试`);
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
    const synthesis = await synthesizeCreative(input, state.analyses);
    return {
      status: "awaiting_review",
      progress: 38,
      state: withEvent({
        ...state,
        revision: (state.revision ?? 1) + 1,
        phase: "awaiting_creative_review",
        creative: synthesis.creative,
        creativeAttempts: [...(state.creativeAttempts ?? []), ...synthesis.attempts],
        creativeRecovery: undefined,
        currentFileId: undefined,
      }, "creative_review", `参考解析与融合创意已完成，等待你确认：${synthesis.creative.theme || synthesis.creative.concept || "原创短视频方案"}`, "success"),
    };
  }

  if (state.phase === "creative_recovery") {
    return { status: "needs_action", progress: 34, state };
  }

  if (state.phase === "awaiting_creative_review" || state.phase === "awaiting_image_plan" || state.phase === "awaiting_canvas_review") {
    return {
      status: "awaiting_review",
      progress: state.phase === "awaiting_creative_review" ? 38 : state.phase === "awaiting_image_plan" ? 48 : 72,
      state,
    };
  }

  if (state.phase === "planning_images") {
    const imagePlan = await planStoryboardImages(input, state.creative ?? {}, state.analyses);
    return {
      status: "awaiting_review",
      progress: 48,
      state: withEvent({ ...state, revision: (state.revision ?? 1) + 1, phase: "awaiting_image_plan", imagePlan }, "image_plan_review", "4 张分镜图片提示词已规划，等待你逐张确认", "success"),
    };
  }

  if (state.phase === "generating_images") {
    if (!state.imagePlan) throw new Error("图片提示词方案缺失");
    const storyboardImages = await generateStoryboardImages(input, state.creative ?? {}, state.imagePlan, ownerId, state.revision);
    return {
      status: "quality_checking",
      progress: 68,
      state: withEvent({ ...state, phase: "reviewing_images", storyboardImages }, "image_quality", "4张分镜图片已生成并归档，正在检查主题一致性、跨图连续性与禁项"),
    };
  }

  if (state.phase === "reviewing_images") {
    if (!state.imagePlan || !state.storyboardImages || state.storyboardImages.length !== 4) throw new Error("分镜图片质检输入不完整");
    const imageQuality = await reviewStoryboardImages(input, state.creative ?? {}, state.imagePlan, state.storyboardImages);
    if (!imageQuality.passed) throw new Error(`分镜图片质量检查未通过：${imageQuality.issues.join("；") || imageQuality.summary}`);
    return {
      status: "awaiting_review",
      progress: 72,
      state: withEvent({ ...state, revision: (state.revision ?? 1) + 1, phase: "awaiting_canvas_review", imageQuality }, "canvas_review", "4 张分镜图片已生成、质量复核通过并归档，等待你确认画布顺序与运动", "success"),
    };
  }

  if (state.phase === "submitting_video") {
    if (!state.imagePlan || !state.storyboardImages || !state.canvas) throw new Error("已确认的分镜画布不完整");
    const task = await createSeedanceTask(input, state.creative ?? {}, state.imagePlan, state.storyboardImages, state.canvas);
    return {
      status: "generating_video",
      progress: 78,
      providerJobId: task.id,
      state: withEvent({ ...state, phase: "polling_video", taskId: task.id }, "seedance_submit", "已按确认画布绑定 4 张参考图，Seedance 2.0 任务已提交"),
    };
  }

  if (state.phase === "reviewing_video") {
    if (!state.candidateVideoUrl) throw new Error("待质检成片地址缺失");
    const videoQuality = await reviewFinalVideo(input, state.creative ?? {}, state.imagePlan, state.canvas, state.candidateVideoUrl);
    if (!videoQuality.passed) {
      return failure("VideoQualityRejected", `成片质量检查未通过：${videoQuality.issues.join("；") || videoQuality.summary}`, { ...state, videoQuality });
    }
    const objectKey = await archiveVideo(input.projectId, ownerId, state.candidateVideoUrl);
    const imageCost = (state.storyboardImages ?? []).reduce((total, image) => total + image.cost, 0);
    const actualCost = state.videoUsageTokens ? Math.round(((state.videoUsageTokens * 46 / 1_000_000) + imageCost) * 10000) / 10000 : null;
    return {
      status: "completed",
      progress: 100,
      providerJobId: state.taskId,
      state: withEvent({ ...state, videoQuality }, "delivery", "成片语义、约束、连续性与文件完整性检查通过并归档", "success"),
      result: {
        videoObjectKey: objectKey,
        videoUrl: `/api/media/${encodeURIComponent(objectKey)}`,
        qualityScore: Math.round((videoQuality.brief_alignment + videoQuality.visual_consistency + videoQuality.constraint_coverage) / 3 * 100),
        actualCost,
        concept: state.creative?.concept ?? state.creative?.theme,
        hook: state.creative?.hook,
      },
    };
  }

  if (!state.taskId) throw new Error("Seedance 任务标识缺失");
  const task = await arkRequest<ArkVideoTask>(`/contents/generations/tasks/${encodeURIComponent(state.taskId)}`);
  if (task.status === "queued") return { status: "generating_video", progress: 82, providerJobId: task.id, state: withEvent(state, "seedance_queue", "Seedance 正在排队，任务状态正常") };
  if (task.status === "running") return { status: "generating_video", progress: 92, providerJobId: task.id, state: withEvent(state, "seedance_render", "Seedance 正在按 4 张分镜与确认的运动画布渲染画面和声音") };
  if (task.status !== "succeeded" || !task.content?.video_url) {
    return failure(task.error?.code || `Seedance${task.status}`, task.error?.message || `视频生成任务状态：${task.status}`, state);
  }

  return {
    status: "quality_checking",
    progress: 96,
    providerJobId: task.id,
    state: withEvent({ ...state, phase: "reviewing_video", candidateVideoUrl: task.content.video_url, videoUsageTokens: task.usage?.total_tokens ?? task.usage?.completion_tokens ?? 0 }, "video_quality", "Seedance 成片已返回，正在进行主题、约束、连续性与瑕疵硬质检"),
  };
}

export function approvePipelineGate(args: {
  state: ArkPipelineState;
  gate: "creative" | "image_plan" | "canvas";
  payload: unknown;
}): PipelineSnapshot {
  const { state, gate } = args;
  const now = new Date().toISOString();

  if (gate === "creative") {
    if (state.phase !== "awaiting_creative_review") throw new Error("当前任务不在创意确认阶段");
    const payload = objectValue(args.payload);
    const analyses = Array.isArray(payload.analyses) ? payload.analyses.map((entry) => objectValue(entry)) : null;
    if (!analyses || analyses.length !== state.analyses.length) throw new Error("参考解析数量与原素材不一致");
    const creative = normalizeCreativeCard(payload.creative);
    return {
      status: "generating_assets",
      progress: 40,
      state: withEvent({
        ...state,
        revision: (state.revision ?? 1) + 1,
        phase: "planning_images",
        analyses,
        creative,
        approvals: { ...state.approvals, creativeAt: now },
      }, "creative_approved", "你已确认参考解析与融合创意，开始规划 4 张分镜图片", "success"),
    };
  }

  if (gate === "image_plan") {
    if (state.phase !== "awaiting_image_plan") throw new Error("当前任务不在图片提示词确认阶段");
    const imagePlan = normalizeImagePlan(args.payload);
    return {
      status: "generating_assets",
      progress: 50,
      state: withEvent({
        ...state,
        revision: (state.revision ?? 1) + 1,
        phase: "generating_images",
        imagePlan,
        storyboardImages: undefined,
        approvals: { ...state.approvals, imagePlanAt: now },
      }, "image_plan_approved", "你已确认 4 张图片提示词，Seedream 开始生成连贯分镜", "success"),
    };
  }

  if (state.phase !== "awaiting_canvas_review") throw new Error("当前任务不在画布确认阶段");
  if (!state.imagePlan || !state.storyboardImages || state.storyboardImages.length !== 4) throw new Error("画布所需图片尚未准备完整");
  const canvas = normalizeCanvasPlan(args.payload, state.imagePlan, state.storyboardImages);
  return {
    status: "generating_video",
    progress: 74,
    state: withEvent({
      ...state,
      revision: (state.revision ?? 1) + 1,
      phase: "submitting_video",
      canvas: { ...canvas, confirmedAt: now },
      approvals: { ...state.approvals, canvasAt: now },
    }, "canvas_approved", "你已确认分镜画布，开始编译并提交 Seedance 2.0", "success"),
  };
}

export function retryCreativeSynthesis(state: ArkPipelineState): PipelineSnapshot {
  const recoverableState = state.phase === "creative_recovery" && state.creativeRecovery?.retryable;
  const legacySynthesisFailure = state.phase === "synthesizing" && state.analyses.length > 0;
  if (!recoverableState && !legacySynthesisFailure) {
    throw new Error("当前任务没有可重试的创意融合步骤");
  }
  if (!state.analyses.length) throw new Error("参考视频解析结果缺失，无法单独重试创意融合");
  return {
    status: "analyzing",
    progress: 32,
    state: withEvent({
      ...state,
      revision: (state.revision ?? 1) + 1,
      phase: "synthesizing",
      creative: undefined,
      creativeRecovery: undefined,
      currentFileId: undefined,
    }, "creative_retry", `已保留 ${state.analyses.length} 条参考解析，仅重新执行创意融合`, "info"),
  };
}

export function retryRecoverableStep(state: ArkPipelineState): PipelineSnapshot {
  const allowed = new Set<ArkPipelineState["phase"]>(["waiting_file", "planning_images", "reviewing_images", "reviewing_video"]);
  const legacyStructuredFailure = allowed.has(state.phase);
  if ((!state.stepRecovery?.retryable && !legacyStructuredFailure) || !allowed.has(state.phase)) {
    throw new Error("当前任务没有可单独重试的流程步骤");
  }
  const statusByPhase: Partial<Record<ArkPipelineState["phase"], PipelineStatus>> = {
    waiting_file: "ingesting",
    planning_images: "generating_assets",
    reviewing_images: "quality_checking",
    reviewing_video: "quality_checking",
  };
  return {
    status: statusByPhase[state.phase] ?? "needs_action",
    progress: progressForPhase(state.phase),
    state: withEvent({
      ...state,
      revision: (state.revision ?? 1) + 1,
      stepRecovery: undefined,
    }, "step_retry", `仅重新执行“${state.stepRecovery?.stage ?? phaseLabel(state.phase)}”，已完成的上游结果保持不变`, "info"),
  };
}

function nextReferenceState(input: PipelineInput, state: ArkPipelineState, analysis: Record<string, unknown>): PipelineSnapshot {
  const nextIndex = state.referenceIndex + 1;
  return {
    status: nextIndex >= input.references.length ? "analyzing" : "ingesting",
    progress: nextIndex >= input.references.length ? 30 : referenceProgress(nextIndex, input.references.length),
    state: {
      phase: nextIndex >= input.references.length ? "synthesizing" : "ingesting",
      revision: state.revision ?? 1,
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
  const prompt = `你是短视频导演和广告创意分析师。完整观看并分析这条参考视频，只记录画面或声音中有证据的内容，只提取可迁移的创意机制，禁止复刻人物、品牌、台词或受版权保护的表达。
请只输出一个合法 JSON 对象，不要 Markdown。字段必须包括：summary（50-200字）、timeline_beats（数组）、hook、creative_mechanism、visual_grammar、camera_and_motion、pacing、audio_design、emotion_curve、reusable_techniques（数组）、seedance_prompt_fragments（数组）、quality_risks（数组）、confidence（0到1）。禁止根据标题或常识补写视频中没有出现的内容。
参考序号：${index + 1}；用户标注重点：${JSON.stringify(reference.emphasis ?? [])}；是否重点参考：${Boolean(reference.priority)}。`;
  const model = arkConfig().analysisModel;
  const startedAt = Date.now();
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "message", role: "user", content: [media, { type: "input_text", text: prompt }] }],
      max_output_tokens: 1800,
      thinking: { type: "disabled" },
    }),
  });
  return parseStructuredResponse(response, {
    stage: `参考视频 ${index + 1} 解析`,
    operation: "reference_analysis",
    model,
    startedAt,
  }, (parsed) => normalizeReferenceAnalysis(parsed, index, reference));
}

const CREATIVE_TOOL_NAME = "submit_creative_card";
const CREATIVE_TOOL = {
  type: "function",
  name: CREATIVE_TOOL_NAME,
  description: "提交唯一、可拍摄、可追溯到参考素材的15秒短视频创意卡",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version", "brief_topic", "theme", "concept", "hook", "story_arc", "shot_plan",
      "visual_style", "audio_plan", "quality_risks", "source_trace", "constraint_trace",
    ],
    properties: {
      schema_version: { type: "string", enum: ["creative_card.v1"] },
      brief_topic: { type: "string", description: "用户手动主题必须原样填写；AI主题模式则填写最终选定主题" },
      theme: { type: "string" },
      concept: { type: "string" },
      hook: { type: "string", description: "前2秒可以被直接拍摄或生成的视觉钩子" },
      story_arc: { type: "string" },
      shot_plan: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["order", "start_ms", "end_ms", "scene", "action", "camera", "audio", "source_indices"],
          properties: {
            order: { type: "integer", minimum: 1, maximum: 4 },
            start_ms: { type: "integer", minimum: 0, maximum: 14999 },
            end_ms: { type: "integer", minimum: 1, maximum: 15000 },
            scene: { type: "string" },
            action: { type: "string" },
            camera: { type: "string" },
            audio: { type: "string" },
            source_indices: { type: "array", items: { type: "integer", minimum: 1 }, uniqueItems: true },
          },
        },
      },
      visual_style: { type: "string" },
      audio_plan: { type: "string" },
      quality_risks: { type: "array", items: { type: "string" } },
      source_trace: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source_index", "adopted_elements"],
          properties: {
            source_index: { type: "integer", minimum: 1 },
            adopted_elements: { type: "array", minItems: 1, items: { type: "string" } },
          },
        },
      },
      constraint_trace: {
        type: "object",
        additionalProperties: false,
        required: ["must_include", "must_avoid"],
        properties: {
          must_include: { type: "array", items: { type: "string" } },
          must_avoid: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

async function synthesizeCreative(input: PipelineInput, analyses: Array<Record<string, unknown>>) {
  const config = arkConfig();
  const fallbackModel = config.creativeFallbackModels.find((model) => model !== config.reviewModel) ?? config.analysisModel;
  const attemptPlan: Array<{ model: string; strategy: CreativeAttempt["strategy"] }> = [
    { model: config.reviewModel, strategy: "primary" },
    { model: config.reviewModel, strategy: "repair" },
    { model: fallbackModel, strategy: "fallback" },
  ];
  const attempts: CreativeAttempt[] = [];
  let previousRaw = "";
  let previousErrors: string[] = [];

  for (const attempt of attemptPlan) {
    const createdAt = new Date().toISOString();
    try {
      const response = await arkRequest<ArkResponse>("/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: attempt.model,
          input: creativeSynthesisPrompt(input, analyses, attempt.strategy === "repair" ? { raw: previousRaw, errors: previousErrors } : undefined),
          tools: [CREATIVE_TOOL],
          max_output_tokens: 5000,
          thinking: { type: "disabled" },
        }),
      });
      const extracted = extractCreativeCandidate(response);
      previousRaw = extracted.raw;
      const validated = extracted.value
        ? validateGeneratedCreativeCard(extracted.value, input, analyses.length)
        : { errors: extracted.errors };
      previousErrors = validated.errors;
      if ("creative" in validated && validated.creative) {
        attempts.push({
          model: attempt.model,
          strategy: attempt.strategy,
          status: "accepted",
          errors: [],
          createdAt,
          responseStatus: response.status,
        });
        return { creative: validated.creative, attempts };
      }
      attempts.push({
        model: attempt.model,
        strategy: attempt.strategy,
        status: "invalid",
        errors: previousErrors.slice(0, 20),
        createdAt,
        responseStatus: response.status,
        rawExcerpt: clipText(previousRaw, 4000),
      });
    } catch (error) {
      previousErrors = [error instanceof Error ? error.message : "创意融合请求失败"];
      attempts.push({
        model: attempt.model,
        strategy: attempt.strategy,
        status: "request_error",
        errors: previousErrors,
        createdAt,
      });
    }
  }

  throw new CreativeSynthesisFailure("创意融合模型连续未返回符合 creative_card.v1 的结果", attempts);
}

function creativeSynthesisPrompt(
  input: PipelineInput,
  analyses: Array<Record<string, unknown>>,
  repair?: { raw: string; errors: string[] },
) {
  const compactAnalyses = analyses.map((analysis) => ({
    source_index: analysis.source_index,
    source_name: analysis.source_name,
    summary: analysis.summary,
    hook: analysis.hook,
    creative_mechanism: analysis.creative_mechanism,
    visual_grammar: analysis.visual_grammar,
    camera_and_motion: analysis.camera_and_motion,
    pacing: analysis.pacing,
    audio_design: analysis.audio_design,
    emotion_curve: analysis.emotion_curve,
    reusable_techniques: analysis.reusable_techniques,
    quality_risks: analysis.quality_risks,
    confidence: analysis.confidence,
    priority: analysis.priority,
  }));
  const brief = {
    topicMode: input.topicMode,
    topic: input.topic,
    goal: input.goal,
    audience: input.audience,
    platform: input.platform,
    duration: input.duration,
    ratio: input.ratio,
    style: input.style,
    company: input.company,
    mustInclude: input.mustInclude,
    mustAvoid: input.mustAvoid,
    cta: input.cta,
  };
  const repairBlock = repair
    ? `\n上一次返回没有通过校验。只修复列出的错误，不得改变用户主题或明确约束。\n校验错误：${JSON.stringify(repair.errors)}\n上一次返回：${clipText(repair.raw, 8000)}`
    : "";
  return `你是资深短视频创意总监。比较、筛选并融合参考视频中可迁移的创意机制，只形成一个原创方案。你必须调用 ${CREATIVE_TOOL_NAME}，不得输出普通文本或 Markdown。
硬要求：前2秒有明确视觉钩子；9:16竖屏；总时长严格${input.duration}秒；恰好4个连续镜头，时间轴从0毫秒连续覆盖到${input.duration * 1000}毫秒；主体、场景、光线连续；动作必须能由 Seedance 2.0 稳定生成；不照搬参考人物、品牌、原台词或受保护表达。用户为手动主题时，brief_topic 必须逐字等于用户主题。存在多条有效参考时，source_trace 至少采用2个不同来源。constraint_trace 必须逐项原样列出用户的必备和禁用内容。不要在这一步编写 Seedance 最终提示词。
用户简报：${JSON.stringify(brief)}
参考解析：${JSON.stringify(compactAnalyses)}${repairBlock}`;
}

function extractCreativeCandidate(response: ArkResponse): { raw: string; value?: Record<string, unknown>; errors: string[] } {
  if (response.status && response.status !== "completed") {
    return { raw: "", errors: [`响应状态不是 completed：${response.status}${response.incomplete_details?.reason ? `（${response.incomplete_details.reason}）` : ""}`] };
  }
  const call = (response.output ?? []).find((item) => item.type === "function_call" && item.name === CREATIVE_TOOL_NAME);
  const raw = call
    ? typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {})
    : responseText(response);
  if (!raw.trim()) return { raw, errors: [`模型没有调用 ${CREATIVE_TOOL_NAME}，也没有返回可解析内容`] };
  const parsed = tryParseModelJson(raw);
  return parsed.value ? { raw, value: parsed.value, errors: [] } : { raw, errors: [parsed.error ?? "返回内容不是合法 JSON"] };
}

const IMAGE_PLAN_TOOL_NAME = "submit_image_plan";
const IMAGE_PLAN_TOOL = {
  type: "function",
  name: IMAGE_PLAN_TOOL_NAME,
  description: "提交严格4张、时间连续的9:16分镜图片提示词方案",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["continuity_anchor", "frames"],
    properties: {
      continuity_anchor: { type: "string" },
      frames: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["order", "time_range", "title", "narrative_goal", "prompt", "motion"],
          properties: {
            order: { type: "integer", minimum: 1, maximum: 4 },
            time_range: { type: "string" },
            title: { type: "string" },
            narrative_goal: { type: "string" },
            prompt: { type: "string" },
            motion: { type: "string" },
          },
        },
      },
    },
  },
} as const;

async function planStoryboardImages(input: PipelineInput, creative: CreativeCard, analyses: Array<Record<string, unknown>>): Promise<ImagePlan> {
  const prompt = `你是电影分镜导演和 Seedream 图片提示词专家。根据已经由用户确认的参考解析和唯一创意，为15秒9:16短视频规划严格4张、角色与美术连续的关键分镜图。四张图必须共同覆盖开场钩子、发展、转折和收束，不得改变主题、产品、受众、风格或必备内容。用户确认后的文本优先级最高。
用户简报：${JSON.stringify({ topic: input.topic, goal: input.goal, audience: input.audience, style: input.style, company: input.company, mustInclude: input.mustInclude, mustAvoid: input.mustAvoid, cta: input.cta })}
用户确认后的参考解析：${JSON.stringify(analyses)}
已确认创意：${JSON.stringify(creative)}
你必须调用 ${IMAGE_PLAN_TOOL_NAME}，不得输出普通文本或 Markdown。frames 必须恰好4项，order必须为1到4，时间段必须连续覆盖0到15秒。`;
  const model = arkConfig().reviewModel;
  const startedAt = Date.now();
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [IMAGE_PLAN_TOOL],
      max_output_tokens: 5000,
      thinking: { type: "disabled" },
    }),
  });
  return parseStructuredResponse(response, {
    stage: "4张分镜图片提示词规划",
    operation: "image_prompt_planning",
    model,
    startedAt,
    toolName: IMAGE_PLAN_TOOL_NAME,
  }, normalizeImagePlan);
}

async function generateStoryboardImages(
  input: PipelineInput,
  creative: CreativeCard,
  imagePlan: ImagePlan,
  ownerId: string,
  revision: number,
) {
  const frameLines = imagePlan.frames.map((frame) => `图${frame.order}（${frame.time_range}，${frame.title}）：${frame.prompt}`).join("\n");
  const brandVisualRequired = Boolean(input.company?.trim()) || /品牌|包装|logo|标识|文字/i.test(input.mustInclude ?? "");
  const textPolicy = brandVisualRequired
    ? `如画面包含已授权品牌“${input.company || "用户指定品牌"}”或产品包装，只能准确保持用户要求的外观与标识，不得杜撰其他品牌或文字`
    : "禁止任何文字、字幕、logo和水印";
  const prompt = `生成严格4张彼此独立的9:16竖屏高质量分镜组图，按顺序输出，不要拼成一张图。四张图属于同一条15秒短视频，必须保持同一主体身份、面部或产品外观、服装、核心场景、美术风格、色彩和光线连续。整体视觉风格严格遵循：${creative.visual_style || input.style}。
连续性圣经：${imagePlan.continuity_anchor}
创意主句：${creative.concept || creative.theme || input.topic || input.goal}
${frameLines}
全局规则：${textPolicy}；禁止边框、分屏、拼贴；禁止出现“${input.mustAvoid || "畸形手部、重复肢体、模糊主体"}”。每张都是单一完整画面，并为对应运镜预留空间。`;
  const response = await arkRequest<ArkImageResponse>("/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: arkConfig().imageModel,
      prompt,
      size: "1440x2560",
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
      response_format: "url",
      watermark: false,
    }),
  });
  const outputs = (response.data ?? []).filter((item): item is { url: string; size?: string } => Boolean(item.url));
  if (outputs.length !== 4) throw new Error(`Seedream 应返回4张分镜图，实际返回${outputs.length}张，任务已停止`);
  return Promise.all(outputs.map(async (output, index) => ({
    frameId: imagePlan.frames[index].id,
    order: index + 1,
    sourceUrl: output.url,
    objectKey: await archiveImage(input.projectId, ownerId, output.url, revision, index + 1),
    size: output.size,
    model: response.model ?? arkConfig().imageModel,
    cost: 0.22,
    generatedAt: new Date().toISOString(),
  })));
}

async function reviewStoryboardImages(input: PipelineInput, creative: CreativeCard, imagePlan: ImagePlan, images: StoryboardImage[]) {
  const media = [...images].sort((a, b) => a.order - b.order).map((image) => ({ type: "input_image", image_url: image.sourceUrl }));
  const prompt = `你是严格的短视频分镜质检导演。逐张检查这4张真实生成图片是否与已确认创意和各自提示词一致，并检查跨图主体/产品/服装/场景/风格连续性、畸形肢体、无关人物、乱码、未授权Logo、用户必备与禁用内容。任何一张明显偏题、连续性崩坏或命中禁项，都必须判定不通过。
用户简报：${JSON.stringify({ topic: input.topic, goal: input.goal, audience: input.audience, company: input.company, mustInclude: input.mustInclude, mustAvoid: input.mustAvoid, style: input.style })}
已确认创意：${JSON.stringify(creative)}
已确认图片方案：${JSON.stringify(imagePlan)}
只输出合法JSON：{"passed":true,"brief_alignment":0.0,"visual_consistency":0.0,"constraint_coverage":0.0,"issues":[],"summary":"结论"}。三个分数范围0到1；只有全部分数不低于0.78且没有硬问题时 passed 才能为 true。`;
  const model = arkConfig().analysisModel;
  const startedAt = Date.now();
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "message", role: "user", content: [...media, { type: "input_text", text: prompt }] }],
      max_output_tokens: 1200,
      thinking: { type: "disabled" },
    }),
  });
  return parseStructuredResponse(response, {
    stage: "分镜图片质量检查",
    operation: "storyboard_quality_review",
    model,
    startedAt,
  }, (parsed) => normalizeQualityReport(parsed, 0.78));
}

async function reviewFinalVideo(
  input: PipelineInput,
  creative: CreativeCard,
  imagePlan: ImagePlan | undefined,
  canvas: CanvasPlan | undefined,
  videoUrl: string,
) {
  const prompt = `你是成片交付质量总监。完整观看这条15秒视频，逐项核对用户简报、人工确认创意、4图方案和运动画布。重点检查：主题是否跑偏、必须内容是否覆盖、禁项是否出现、主体/产品是否连续、动作是否符合物理、转场是否按顺序、画面是否有畸形/乱码/黑帧、声音是否与情绪和动作匹配。只要明显偏题、命中禁项或主体严重漂移，必须判定不通过。
用户简报：${JSON.stringify({ topic: input.topic, goal: input.goal, audience: input.audience, company: input.company, mustInclude: input.mustInclude, mustAvoid: input.mustAvoid, cta: input.cta, style: input.style })}
已确认创意：${JSON.stringify(creative)}
已确认图片方案：${JSON.stringify(imagePlan)}
已确认画布：${JSON.stringify(canvas)}
只输出合法JSON：{"passed":true,"brief_alignment":0.0,"visual_consistency":0.0,"constraint_coverage":0.0,"issues":[],"summary":"结论"}。三个分数范围0到1；只有全部分数不低于0.8且没有硬问题时 passed 才能为 true。`;
  const model = arkConfig().analysisModel;
  const startedAt = Date.now();
  const response = await arkRequest<ArkResponse>("/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [{ type: "message", role: "user", content: [{ type: "input_video", video_url: videoUrl }, { type: "input_text", text: prompt }] }],
      max_output_tokens: 1400,
      thinking: { type: "disabled" },
    }),
  });
  return parseStructuredResponse(response, {
    stage: "最终成片质量检查",
    operation: "video_quality_review",
    model,
    startedAt,
  }, (parsed) => normalizeQualityReport(parsed, 0.8));
}

async function createSeedanceTask(
  input: PipelineInput,
  creative: CreativeCard,
  imagePlan: ImagePlan,
  storyboardImages: StoryboardImage[],
  canvas: CanvasPlan,
) {
  const orderedFrames = [...canvas.frames].sort((a, b) => a.order - b.order);
  const orderedImages = orderedFrames.map((frame) => {
    const image = storyboardImages.find((entry) => entry.frameId === frame.frameId);
    if (!image) throw new Error(`画布镜头 ${frame.order} 缺少已归档图片`);
    return image;
  });
  const oldestGeneratedAt = Math.min(...orderedImages.map((image) => new Date(image.generatedAt).getTime()));
  if (!Number.isFinite(oldestGeneratedAt) || Date.now() - oldestGeneratedAt > 23 * 60 * 60 * 1000) {
    throw new Error("分镜图片的供应商临时地址已超过安全有效期。为避免无效生成，任务已停止，请重新生成图片后再提交视频");
  }
  const timeline = orderedFrames.map((canvasFrame, index) => {
    const planFrame = imagePlan.frames.find((frame) => frame.id === canvasFrame.frameId);
    const transition = canvas.transitions.find((entry) => entry.fromFrameId === canvasFrame.frameId);
    return `${planFrame?.time_range || `镜头${index + 1}`}：@图片${index + 1}，${clipText(planFrame?.narrative_goal || planFrame?.title || "推进故事", 100)}；${clipText(canvasFrame.motion, 120)}${transition ? `；${clipText(transition.description, 80)}` : ""}`;
  }).join("。\n");
  const shotDirections = (creative.shot_plan ?? []).map((shot, index) => `镜头${index + 1}:${clipText(shot.user_direction ?? shot.description ?? shot.action ?? shot, 80)}`).join("；");
  const prompt = clipText(`15秒，9:16竖屏，视觉风格严格遵循“${clipText(creative.visual_style || input.style, 100)}”。主题“${clipText(creative.theme || input.topic || input.goal, 100)}”；创意：${clipText(creative.concept || input.goal, 180)}；结构：${clipText(creative.story_arc || "钩子、发展、转折、收束", 220)}；前2秒：${clipText(creative.hook || "用明确动作建立视觉吸引", 120)}。附件4张图片按@图片1到@图片4的顺序对应四段画面，保持主体身份、产品外观、服装、场景、色彩和光线连续，不新增无关人物、产品或地点。
${timeline}
镜头确认稿：${shotDirections || "按上述四段执行"}。声音：${clipText(creative.audio_plan || "环境声与动作同步", 120)}。客户/产品：${clipText(input.company || "无指定", 80)}。必须出现：${clipText(input.mustInclude || "已确认创意中的核心内容", 180)}。禁止出现：${clipText(input.mustAvoid || "乱码、水印、畸形肢体、主体漂移", 180)}。结尾表达：${clipText(input.cta || "按创意自然收束", 120)}。动作符合物理规律。`, 1800);
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  orderedImages.forEach((image) => content.push({ type: "image_url", image_url: { url: image.sourceUrl }, role: "reference_image" }));
  return arkRequest<{ id: string }>("/contents/generations/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: arkConfig().videoModel,
      content,
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

async function archiveImage(projectId: string, ownerId: string, imageUrl: string, revision: number, index: number) {
  const storage = bindings().MEDIA;
  if (!storage) throw new Error("对象存储不可用");
  const response = await fetch(imageUrl);
  if (!response.ok || !response.body) throw new Error(`关键帧下载失败（${response.status}）`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const key = `outputs/${ownerId}/${projectId}/storyboard/r${revision}/frame-${String(index).padStart(2, "0")}.${extension}`;
  await storage.put(key, response.body, { httpMetadata: { contentType }, customMetadata: { projectId, source: "seedream-5.0-lite", frame: String(index), revision: String(revision) } });
  const head = await storage.head(key);
  if (!head || head.size <= 0) throw new Error(`分镜图 ${index} 归档校验失败`);
  return key;
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

function parseStructuredResponse<T>(
  response: ArkResponse,
  context: { stage: string; operation: string; model: string; startedAt: number; toolName?: string },
  normalize: (value: Record<string, unknown>) => T,
) {
  const toolCall = context.toolName
    ? (response.output ?? []).find((item) => item.type === "function_call" && item.name === context.toolName)
    : null;
  const raw = toolCall
    ? typeof toolCall.arguments === "string" ? toolCall.arguments : JSON.stringify(toolCall.arguments ?? {})
    : responseText(response);
  const common = {
    stage: context.stage,
    operation: context.operation,
    model: context.model,
    durationMs: Date.now() - context.startedAt,
    providerResponseId: response.id,
    providerStatus: response.status,
    responseExcerpt: clipText(raw, 4000),
  };
  if (response.status && response.status !== "completed") {
    const reason = response.incomplete_details?.reason ?? response.status;
    throw new PipelineStepFailure(`模型响应未完成：${reason}`, {
      ...common,
      status: "invalid",
      message: `模型响应未完成：${reason}`,
      errorCode: "MODEL_RESPONSE_INCOMPLETE",
      validationErrors: [`响应状态：${response.status}`, `原因：${reason}`],
    });
  }
  const parsed = tryParseModelJson(raw);
  if (!parsed.value) {
    throw new PipelineStepFailure(parsed.error ?? "返回内容不是合法 JSON", {
      ...common,
      status: "invalid",
      message: parsed.error ?? "返回内容不是合法 JSON",
      errorCode: "INVALID_JSON",
      validationErrors: [parsed.error ?? "返回内容不是合法 JSON"],
    });
  }
  try {
    return normalize(parsed.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "结构字段校验失败";
    throw new PipelineStepFailure(message, {
      ...common,
      status: "invalid",
      message,
      errorCode: "SCHEMA_VALIDATION_FAILED",
      validationErrors: [message],
    });
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("确认内容格式无效");
  return value as Record<string, unknown>;
}

function textValue(value: unknown, field: string, max = 6000) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : JSON.stringify(value);
  if (!text) throw new Error(`${field}不能为空`);
  if (text.length > max) throw new Error(`${field}内容过长`);
  return text;
}

function optionalText(value: unknown, max = 6000) {
  if (value == null || value === "") return undefined;
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (text.length > max) throw new Error("确认内容过长");
  return text || undefined;
}

function textList(value: unknown) {
  if (!Array.isArray(value)) return value == null || value === "" ? [] : [textValue(value, "列表项", 1200)];
  return value.slice(0, 30).map((item) => textValue(item, "列表项", 1200));
}

function normalizeReferenceAnalysis(value: unknown, index: number, reference: Record<string, unknown>) {
  const source = objectValue(value);
  const confidence = Number(source.confidence);
  return {
    source_index: index + 1,
    source_name: String(reference.name ?? `参考 ${index + 1}`),
    summary: textValue(source.summary, "视频摘要", 2000),
    timeline_beats: Array.isArray(source.timeline_beats) ? source.timeline_beats.slice(0, 20) : [],
    hook: textValue(source.hook, "开场钩子", 1200),
    creative_mechanism: textValue(source.creative_mechanism, "创意机制", 2000),
    visual_grammar: textValue(source.visual_grammar, "视觉语言", 2000),
    camera_and_motion: textValue(source.camera_and_motion, "镜头运动", 2000),
    pacing: textValue(source.pacing, "节奏", 1200),
    audio_design: textValue(source.audio_design, "声音设计", 1200),
    emotion_curve: textValue(source.emotion_curve, "情绪曲线", 1200),
    reusable_techniques: textList(source.reusable_techniques),
    seedance_prompt_fragments: textList(source.seedance_prompt_fragments),
    quality_risks: textList(source.quality_risks),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    emphasis: reference.emphasis ?? [],
    priority: Boolean(reference.priority),
  };
}

function normalizeCreativeCard(value: unknown): CreativeCard {
  const source = objectValue(value);
  const shotPlan = Array.isArray(source.shot_plan) ? source.shot_plan.slice(0, 12).map((item) => typeof item === "string" ? { description: item } : objectValue(item)) : [];
  if (shotPlan.length < 3) throw new Error("融合创意至少需要3个可执行镜头");
  const sourceTrace = Array.isArray(source.source_trace) ? source.source_trace.map((item) => {
    const trace = objectValue(item);
    return {
      source_index: Number(trace.source_index),
      adopted_elements: textList(trace.adopted_elements),
    };
  }) : undefined;
  const constraintSource = source.constraint_trace && typeof source.constraint_trace === "object" && !Array.isArray(source.constraint_trace)
    ? source.constraint_trace as Record<string, unknown>
    : null;
  return {
    schema_version: source.schema_version === "creative_card.v1" ? "creative_card.v1" : undefined,
    brief_topic: optionalText(source.brief_topic, 300),
    theme: textValue(source.theme, "创意主题", 300),
    concept: textValue(source.concept, "一句话创意", 1200),
    hook: textValue(source.hook, "前2秒钩子", 600),
    story_arc: textValue(source.story_arc, "故事结构", 2400),
    shot_plan: shotPlan,
    visual_style: textValue(source.visual_style, "视觉风格", 1200),
    audio_plan: textValue(source.audio_plan, "声音方案", 1200),
    seedance_prompt: optionalText(source.seedance_prompt, 6000),
    quality_risks: textList(source.quality_risks),
    source_trace: sourceTrace,
    constraint_trace: constraintSource ? {
      must_include: textList(constraintSource.must_include),
      must_avoid: textList(constraintSource.must_avoid),
    } : undefined,
  };
}

function validateGeneratedCreativeCard(
  value: unknown,
  input: PipelineInput,
  analysisCount: number,
): { creative?: CreativeCard; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { errors: ["/: 必须是 JSON 对象"] };
  }
  const source = value as Record<string, unknown>;
  const allowedTop = new Set([
    "schema_version", "brief_topic", "theme", "concept", "hook", "story_arc", "shot_plan",
    "visual_style", "audio_plan", "quality_risks", "source_trace", "constraint_trace",
  ]);
  for (const key of Object.keys(source)) if (!allowedTop.has(key)) errors.push(`/${key}: 不允许的额外字段`);

  const requiredText = (key: string, max: number) => {
    const valueAtKey = source[key];
    if (typeof valueAtKey !== "string" || !valueAtKey.trim()) errors.push(`/${key}: 必须是非空字符串`);
    else if (valueAtKey.trim().length > max) errors.push(`/${key}: 内容超过${max}字`);
  };
  if (source.schema_version !== "creative_card.v1") errors.push('/schema_version: 必须等于 "creative_card.v1"');
  requiredText("brief_topic", 300);
  requiredText("theme", 300);
  requiredText("concept", 1200);
  requiredText("hook", 600);
  requiredText("story_arc", 2400);
  requiredText("visual_style", 1200);
  requiredText("audio_plan", 1200);
  if (input.topicMode === "manual" && String(source.brief_topic ?? "").trim() !== String(input.topic ?? "").trim()) {
    errors.push("/brief_topic: 必须逐字保留用户手动主题");
  }

  const shots = source.shot_plan;
  if (!Array.isArray(shots) || shots.length !== 4) {
    errors.push("/shot_plan: 必须恰好包含4个镜头");
  } else {
    let expectedStart = 0;
    const shotKeys = new Set(["order", "start_ms", "end_ms", "scene", "action", "camera", "audio", "source_indices"]);
    shots.forEach((shot, index) => {
      const path = `/shot_plan/${index}`;
      if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
        errors.push(`${path}: 必须是对象`);
        return;
      }
      const item = shot as Record<string, unknown>;
      for (const key of Object.keys(item)) if (!shotKeys.has(key)) errors.push(`${path}/${key}: 不允许的额外字段`);
      if (item.order !== index + 1) errors.push(`${path}/order: 必须等于${index + 1}`);
      const start = Number(item.start_ms);
      const end = Number(item.end_ms);
      if (!Number.isInteger(start) || start !== expectedStart) errors.push(`${path}/start_ms: 必须从${expectedStart}毫秒连续开始`);
      if (!Number.isInteger(end) || end <= start || end > input.duration * 1000) errors.push(`${path}/end_ms: 必须是有效的结束毫秒数`);
      if (Number.isInteger(end)) expectedStart = end;
      for (const key of ["scene", "action", "camera", "audio"]) {
        if (typeof item[key] !== "string" || !String(item[key]).trim()) errors.push(`${path}/${key}: 必须是非空字符串`);
      }
      if (!Array.isArray(item.source_indices) || item.source_indices.length < 1 || item.source_indices.some((entry) => !Number.isInteger(entry) || Number(entry) < 1 || Number(entry) > analysisCount)) {
        errors.push(`${path}/source_indices: 必须引用有效的参考序号`);
      }
    });
    if (expectedStart !== input.duration * 1000) errors.push(`/shot_plan: 时间轴必须连续覆盖到${input.duration * 1000}毫秒`);
  }

  if (!Array.isArray(source.quality_risks) || source.quality_risks.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push("/quality_risks: 必须是字符串数组");
  }

  const sourceTrace = source.source_trace;
  const tracedSources = new Set<number>();
  if (!Array.isArray(sourceTrace)) {
    errors.push("/source_trace: 必须是数组");
  } else {
    const traceKeys = new Set(["source_index", "adopted_elements"]);
    sourceTrace.forEach((trace, index) => {
      const path = `/source_trace/${index}`;
      if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
        errors.push(`${path}: 必须是对象`);
        return;
      }
      const item = trace as Record<string, unknown>;
      for (const key of Object.keys(item)) if (!traceKeys.has(key)) errors.push(`${path}/${key}: 不允许的额外字段`);
      const sourceIndex = Number(item.source_index);
      if (!Number.isInteger(sourceIndex) || sourceIndex < 1 || sourceIndex > analysisCount) errors.push(`${path}/source_index: 参考序号无效`);
      else tracedSources.add(sourceIndex);
      if (!Array.isArray(item.adopted_elements) || item.adopted_elements.length < 1 || item.adopted_elements.some((entry) => typeof entry !== "string" || !entry.trim())) {
        errors.push(`${path}/adopted_elements: 至少需要一个可迁移元素`);
      }
    });
    const requiredSourceCount = Math.min(2, analysisCount);
    if (tracedSources.size < requiredSourceCount) errors.push(`/source_trace: 至少需要采用${requiredSourceCount}个不同参考来源`);
  }

  const constraintTrace = source.constraint_trace;
  if (!constraintTrace || typeof constraintTrace !== "object" || Array.isArray(constraintTrace)) {
    errors.push("/constraint_trace: 必须是对象");
  } else {
    const trace = constraintTrace as Record<string, unknown>;
    for (const key of Object.keys(trace)) if (!new Set(["must_include", "must_avoid"]).has(key)) errors.push(`/constraint_trace/${key}: 不允许的额外字段`);
    const includeTrace = Array.isArray(trace.must_include) ? trace.must_include.map((item) => String(item).trim()).filter(Boolean) : [];
    const avoidTrace = Array.isArray(trace.must_avoid) ? trace.must_avoid.map((item) => String(item).trim()).filter(Boolean) : [];
    if (!Array.isArray(trace.must_include)) errors.push("/constraint_trace/must_include: 必须是数组");
    if (!Array.isArray(trace.must_avoid)) errors.push("/constraint_trace/must_avoid: 必须是数组");
    for (const constraint of splitConstraints(input.mustInclude)) {
      if (!includeTrace.includes(constraint)) errors.push(`/constraint_trace/must_include: 缺少必备内容“${constraint}”`);
    }
    for (const constraint of splitConstraints(input.mustAvoid)) {
      if (!avoidTrace.includes(constraint)) errors.push(`/constraint_trace/must_avoid: 缺少禁用内容“${constraint}”`);
    }
  }

  if (errors.length) return { errors };
  try {
    return { creative: normalizeCreativeCard(source), errors: [] };
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : "创意卡规范化失败"] };
  }
}

function splitConstraints(value?: string) {
  return (value ?? "").split(/[，,、；;\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeImagePlan(value: unknown): ImagePlan {
  const source = objectValue(value);
  const rawFrames = source.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length !== 4) throw new Error("图片方案必须恰好包含4张分镜");
  const frames = rawFrames.map((item, index) => {
    const frame = objectValue(item);
    const order = Number(frame.order);
    if (order !== index + 1) throw new Error("图片方案顺序必须为1到4且不能重复");
    return {
      id: `frame_${index + 1}`,
      order,
      time_range: textValue(frame.time_range, `第${order}张时间段`, 80),
      title: textValue(frame.title, `第${order}张标题`, 160),
      narrative_goal: textValue(frame.narrative_goal, `第${order}张叙事作用`, 600),
      prompt: textValue(frame.prompt, `第${order}张图片提示词`, 3600),
      motion: textValue(frame.motion, `第${order}张运动说明`, 1000),
    };
  });
  const ranges = frames.map((frame) => parseTimeRange(frame.time_range));
  if (ranges.some((range) => !range) || ranges[0]?.[0] !== 0 || ranges.at(-1)?.[1] !== 15) throw new Error("4张分镜的时间段必须连续覆盖0到15秒");
  for (let index = 1; index < ranges.length; index += 1) {
    if (!ranges[index - 1] || !ranges[index] || ranges[index - 1]![1] !== ranges[index]![0]) throw new Error("4张分镜的时间段不能重叠或留空");
  }
  return { continuity_anchor: textValue(source.continuity_anchor, "连续性设定", 2400), frames };
}

function normalizeCanvasPlan(value: unknown, imagePlan: ImagePlan, storyboardImages: StoryboardImage[]): CanvasPlan {
  const source = objectValue(value);
  if (!Array.isArray(source.frames) || source.frames.length !== 4) throw new Error("画布必须包含4个图片节点");
  const available = new Set(storyboardImages.map((image) => image.frameId));
  const frames = source.frames.map((item, index) => {
    const frame = objectValue(item);
    const frameId = textValue(frame.frameId, "画布图片标识", 80);
    if (!available.has(frameId) || !imagePlan.frames.some((planFrame) => planFrame.id === frameId)) throw new Error("画布包含无效图片");
    if (frameId !== imagePlan.frames[index].id) throw new Error("MVP画布必须保持已确认的时间轴顺序");
    if (Number(frame.order) !== index + 1) throw new Error("画布顺序必须连续且不能重复");
    return { frameId, order: index + 1, motion: textValue(frame.motion, `镜头${index + 1}运动`, 1000) };
  });
  if (new Set(frames.map((frame) => frame.frameId)).size !== 4) throw new Error("画布不能重复使用同一张图片");
  if (!Array.isArray(source.transitions) || source.transitions.length !== 3) throw new Error("4张图片之间必须设置3个转场");
  const transitions = source.transitions.map((item, index) => {
    const transition = objectValue(item);
    const expectedFrom = frames[index].frameId;
    const expectedTo = frames[index + 1].frameId;
    if (transition.fromFrameId !== expectedFrom || transition.toFrameId !== expectedTo) throw new Error("转场连接与画布顺序不一致");
    return { fromFrameId: expectedFrom, toFrameId: expectedTo, description: textValue(transition.description, `转场${index + 1}`, 600) };
  });
  return { frames, transitions };
}

function normalizeQualityReport(value: unknown, threshold: number): QualityReport {
  const source = objectValue(value);
  const score = (entry: unknown) => {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) throw new Error("质量检查没有返回有效分数");
    return Math.max(0, Math.min(1, parsed));
  };
  const briefAlignment = score(source.brief_alignment);
  const visualConsistency = score(source.visual_consistency);
  const constraintCoverage = score(source.constraint_coverage);
  const issues = textList(source.issues);
  return {
    passed: source.passed === true && issues.length === 0 && briefAlignment >= threshold && visualConsistency >= threshold && constraintCoverage >= threshold,
    brief_alignment: briefAlignment,
    visual_consistency: visualConsistency,
    constraint_coverage: constraintCoverage,
    issues,
    summary: textValue(source.summary, "质量检查结论", 1200),
  };
}

function parseTimeRange(value: string): [number, number] | null {
  const match = value.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? [start, end] : null;
}

function clipText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function tryParseModelJson(text: string): { value?: Record<string, unknown>; error?: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return { value: value as Record<string, unknown> };
    return { error: "返回的 JSON 顶层必须是对象" };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const value = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) return { value: value as Record<string, unknown> };
      } catch { /* fall through */ }
    }
    return { error: "返回内容不是完整、合法的 JSON 对象" };
  }
}

function progressForPhase(phase: ArkPipelineState["phase"]) {
  const progressByPhase: Record<ArkPipelineState["phase"], number> = {
    ingesting: 12,
    waiting_file: 18,
    synthesizing: 34,
    creative_recovery: 34,
    awaiting_creative_review: 38,
    planning_images: 44,
    awaiting_image_plan: 48,
    generating_images: 60,
    reviewing_images: 68,
    awaiting_canvas_review: 72,
    submitting_video: 76,
    polling_video: 88,
    reviewing_video: 96,
  };
  return progressByPhase[phase];
}

function phaseLabel(phase: ArkPipelineState["phase"]) {
  const labels: Partial<Record<ArkPipelineState["phase"], string>> = {
    waiting_file: "参考视频解析",
    planning_images: "4张分镜图片提示词规划",
    reviewing_images: "分镜图片质量检查",
    reviewing_video: "最终成片质量检查",
  };
  return labels[phase] ?? phase;
}

function appendDiagnostic(logs: PipelineDiagnosticLog[] | undefined, entry: PipelineDiagnosticLog) {
  return [...(logs ?? []), entry].slice(-100);
}

function failure(code: string, message: string, state?: ArkPipelineState): PipelineSnapshot {
  return { status: "failed", progress: state ? progressForPhase(state.phase) : 0, state: state ? withEvent(state, "failed", `任务中断：${message}`, "error") : state, error: { code, message } };
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

function advanceDemoPipeline(input: PipelineInput, state: ArkPipelineState): PipelineSnapshot {
  if (state.phase === "ingesting") {
    if (state.referenceIndex >= input.references.length) {
      return { status: "analyzing", progress: 32, state: withEvent({ ...state, phase: "synthesizing" }, "creative", "示例参考解析完成，开始融合创意") };
    }
    const reference = input.references[state.referenceIndex];
    const analysis = {
      source_index: state.referenceIndex + 1,
      source_name: String(reference.name ?? `参考 ${state.referenceIndex + 1}`),
      summary: "示例素材以生活化动作、快速建立情境和清晰产品特写构成短视频节奏。",
      timeline_beats: ["开场动作钩子", "生活场景发展", "产品成为转折", "情绪收束"],
      hook: "用一个反常或利落动作在前2秒建立注意力",
      creative_mechanism: "把日常压力与可感知的体验变化并置",
      visual_grammar: "真实摄影、近景细节与环境中景交替",
      camera_and_motion: "轻推镜配合动作匹配切换",
      pacing: "快开场、稳发展、短收束",
      audio_design: "环境声先行，音乐在转折处进入",
      emotion_curve: "紧张到舒展",
      reusable_techniques: ["动作钩子", "细节特写", "情绪反差"],
      seedance_prompt_fragments: ["主体连续", "动作自然", "光线统一"],
      quality_risks: ["避免照搬参考台词和品牌"],
      confidence: 0.86,
    };
    return nextReferenceState(input, state, analysis);
  }
  if (state.phase === "synthesizing") {
    const creative: CreativeCard = {
      theme: input.topic || "把日常重新调回自己的节奏",
      concept: "用一个被时间追赶的瞬间切入，让产品自然成为生活重新顺畅的转折点。",
      hook: "前2秒用突然停住的动作和近景声音抓住注意力",
      story_arc: "压力开场 → 体验产品 → 节奏舒展 → 情绪与行动号召收束",
      shot_plan: [{ shot: 1 }, { shot: 2 }, { shot: 3 }, { shot: 4 }],
      visual_style: input.style,
      audio_plan: "真实环境声配合克制节奏音乐",
      seedance_prompt: "",
      quality_risks: ["主体和产品外观需跨镜头一致"],
    };
    return { status: "awaiting_review", progress: 38, state: withEvent({ ...state, revision: (state.revision ?? 1) + 1, phase: "awaiting_creative_review", creative }, "creative_review", "示例解析与融合创意已完成，等待确认", "success") };
  }
  if (state.phase === "planning_images") {
    const imagePlan: ImagePlan = {
      continuity_anchor: "同一位都市青年、米白上衣、暖灰室内、清晨侧光、真实电影摄影",
      frames: [
        { id: "frame_1", order: 1, time_range: "0-3秒", title: "动作钩子", narrative_goal: "建立压力与好奇", prompt: "都市青年在清晨桌前突然停住动作，近景，真实电影摄影，暖灰侧光，9:16，无文字", motion: "快速推近后短暂停顿" },
        { id: "frame_2", order: 2, time_range: "3-7秒", title: "体验转折", narrative_goal: "让产品进入情境", prompt: "同一青年自然拿起产品开始使用，中近景，环境和服装保持一致，9:16，无文字", motion: "跟随手部动作平滑横移" },
        { id: "frame_3", order: 3, time_range: "7-11秒", title: "感受展开", narrative_goal: "呈现体验变化", prompt: "同一青年神情舒展，生活空间更有呼吸感，中景，晨光增强，9:16，无文字", motion: "缓慢拉远展示环境" },
        { id: "frame_4", order: 4, time_range: "11-15秒", title: "情绪收束", narrative_goal: "留下记忆与行动感", prompt: "同一青年带着产品走向明亮窗边，背影与侧脸，克制高级，9:16，无文字", motion: "轻微跟拍并稳定停住" },
      ],
    };
    return { status: "awaiting_review", progress: 48, state: withEvent({ ...state, revision: (state.revision ?? 1) + 1, phase: "awaiting_image_plan", imagePlan }, "image_plan_review", "示例图片提示词已规划，等待确认", "success") };
  }
  if (state.phase === "generating_images") {
    const storyboardImages = (state.imagePlan?.frames ?? []).map((frame) => ({ frameId: frame.id, order: frame.order, sourceUrl: "", objectKey: "", model: "Demo Storyboard", size: "1440x2560", cost: 0, generatedAt: new Date().toISOString() }));
    return { status: "awaiting_review", progress: 72, state: withEvent({ ...state, revision: (state.revision ?? 1) + 1, phase: "awaiting_canvas_review", storyboardImages }, "canvas_review", "示例分镜已准备，等待确认画布", "success") };
  }
  if (["awaiting_creative_review", "awaiting_image_plan", "awaiting_canvas_review"].includes(state.phase)) {
    return { status: "awaiting_review", progress: state.phase === "awaiting_creative_review" ? 38 : state.phase === "awaiting_image_plan" ? 48 : 72, state };
  }
  if (state.phase === "submitting_video") {
    return { status: "generating_video", progress: 84, providerJobId: "mock_video", state: withEvent({ ...state, phase: "polling_video", taskId: "mock_video" }, "seedance_submit", "示例画布已提交", "success") };
  }
  return {
    status: "completed",
    progress: 100,
    providerJobId: "mock_video",
    state: withEvent(state, "delivery", "示例流程已完成", "success"),
    result: { qualityScore: 91, actualCost: 0, concept: state.creative?.concept, hook: state.creative?.hook },
  };
}
