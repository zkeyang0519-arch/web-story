"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { calculateCostQuote, type CostQuote } from "@/lib/cost";
import {
  VIDEO_DURATION_OPTIONS,
  VIDEO_FPS_OPTIONS,
  VIDEO_MODEL_KEYS,
  VIDEO_MODEL_PROFILES,
  VIDEO_RATIOS,
  formatVideoDimensions,
  getSupportedResolutions,
  getVideoDimensions,
  getVideoModelProfile,
  isVideoFps,
  isVideoModelKey,
  isVideoRatio,
  isVideoResolution,
  segmentDurations,
  type VideoFps,
  type VideoModelKey,
  type VideoRatio,
  type VideoResolution,
} from "@/lib/video-config";

type ReferenceItem = {
  id: string;
  kind: "file" | "url";
  name: string;
  url?: string;
  file?: File;
  size?: number;
  priority: boolean;
  emphasis: string[];
  uploadId?: string;
  resolvedUrl?: string;
  directVideo?: boolean;
  status?: "pending" | "processing" | "ready" | "failed";
  progress?: number;
  statusText?: string;
  error?: string;
};

type ActivityEvent = { id: string; phase: string; message: string; createdAt: string; level?: "info" | "success" | "warning" | "error" };
type DiagnosticLog = {
  id: string;
  createdAt: string;
  stage: string;
  operation: string;
  status: string;
  message: string;
  model?: string;
  durationMs?: number;
  providerResponseId?: string;
  providerStatus?: string;
  errorCode?: string;
  validationErrors?: string[];
  responseExcerpt?: string;
};

type ProjectResult = {
  videoUrl?: string;
  qualityScore?: number;
  actualCost?: number | null;
  concept?: string;
  hook?: string;
  segmentCount?: number;
  actualDuration?: number;
  specification?: {
    duration: number;
    model: VideoModelKey;
    modelLabel: string;
    ratio: VideoRatio;
    resolution: VideoResolution;
    dimensions: string;
    fps: VideoFps;
  };
  segments?: Array<{ id: string; order: number; duration: number; qualityScore?: number }>;
};

type Project = {
  id: string;
  title: string;
  status: string;
  draftStep: "references" | "requirements" | "settings" | "quote" | "locked";
  draftVersion: number;
  progress: number;
  runMode: "demo" | "production";
  pipelinePhase?: string | null;
  reviewRevision?: number | null;
  review?: { selectedHighlightIds?: string[] } | null;
  keyframeUrl?: string | null;
  keyframeModel?: string | null;
  keyframeSize?: string | null;
  storyboardImages?: Array<{ frameId: string; order: number; url?: string | null; model?: string | null; size?: string | null }>;
  activity?: ActivityEvent[];
  error?: { code?: string; message?: string; recoverable?: boolean; stage?: string; model?: string; attempts?: number } | null;
  recovery?: {
    retryable: boolean;
    failedAt: string;
    message: string;
    attempts: Array<{ model: string; strategy: string; status: string; errors: string[]; createdAt: string }>;
  } | null;
  stepRecovery?: { retryable: boolean; stage: string; resumePhase: string; failedAt: string; message: string; model?: string } | null;
  diagnostics?: DiagnosticLog[];
  videoProduction?: {
    totalDuration: number;
    segmentCount: number;
    activeSegmentIndex: number;
    completedCount: number;
    segments: Array<{
      order: number;
      startSec: number;
      endSec: number;
      duration: number;
      title: string;
      narrativeGoal: string;
      transitionOut: string;
      status: string;
    }>;
  } | null;
  createdAt: string;
  updatedAt: string;
  input: {
    duration: number;
    ratio?: VideoRatio;
    resolution?: VideoResolution;
    fps?: VideoFps;
    videoModel?: VideoModelKey;
    platform: string;
    audience: string;
    goal: string;
    topicMode?: "manual" | "ai";
    topic?: string;
    style?: string;
    company?: string;
    mustInclude?: string;
    mustAvoid?: string;
    cta?: string;
    rightsConfirmed?: boolean;
    quote?: CostQuote;
    costConfirmed?: boolean;
    costConfirmedAt?: string;
    references: ReferenceItem[];
  };
  result?: ProjectResult | null;
};

type SystemInfo = {
  mode: "demo" | "production";
  provider: string;
  model: string;
  storage: boolean;
  ready?: boolean;
  missing?: string[];
};

const MAX_MULTIMODAL_VIDEO_BYTES = 50 * 1024 * 1024;

type StudioView = "references" | "brief" | "spec" | "quote" | "progress" | "result";

const processSteps = [
  { key: "receive", label: "接收并校验参考素材", detail: "确认文件、链接与素材权限", end: 6 },
  { key: "preprocess", label: "方舟文件预处理", detail: "上传并准备画面与声音轨道", end: 18 },
  { key: "understand", label: "逐条视频创意提炼", detail: "每条只保留2～3个有效创意点与高光点", end: 30 },
  { key: "select", label: "人工勾选创意高光", detail: "未勾选内容不会进入创意融合", end: 34 },
  { key: "creative", label: "Great Writer 融合新创意", detail: "仅依据勾选内容生成一篇可修改的原创故事", end: 40 },
  { key: "image_plan", label: "Visual Skills 分镜与资产确认", detail: "确认四幕分镜、总体提示词、必要资产与连续性", end: 50 },
  { key: "storyboard", label: "Seedream 连贯分镜生成", detail: "按选定画幅生成并归档4张关键画面", end: 72 },
  { key: "canvas", label: "画布连接与人工确认", detail: "锁定顺序、动作与3个转场", end: 74 },
  { key: "segment", label: "AI 规划视频片段", detail: "按总时长拆成若干个4～15秒片段", end: 76 },
  { key: "render", label: "逐段生成与质量检查", detail: "前一段尾帧会承接下一段首帧", end: 96 },
  { key: "assemble", label: "自动融合完整成片", detail: "按时间轴合并所有已确认片段", end: 99 },
  { key: "deliver", label: "总检、归档与交付", detail: "校验完整成片并提供下载", end: 101 },
] as const;

const goals = ["品牌种草", "传播表达", "剧情故事", "知识解释", "情绪氛围", "视觉展示"];
const styles = ["真实生活感", "电影叙事", "清透商业", "快速网感", "克制高级"];
const emphasisOptions = ["开头", "节奏", "故事", "画面", "反转", "声音"];

function uid(prefix = "ref") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(value = 0) {
  if (!value) return "链接素材";
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function videoContentType(file: File) {
  if (file.type === "video/mp4" || file.type === "video/quicktime" || file.type === "video/webm") return file.type;
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  if (/\.webm$/i.test(file.name)) return "video/webm";
  return "video/mp4";
}

async function uploadPartWithRetry(url: string, chunk: Blob, attempts = 3) {
  let lastError = new Error("分片上传失败");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: "PUT", body: chunk });
      const result = await response.json().catch(() => null) as { part?: { partNumber: number; etag: string }; error?: string } | null;
      if (response.ok && result?.part) return result.part;
      lastError = new Error(result?.error ?? "分片上传失败");
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

function formatElapsed(createdAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

const ratioLabels: Record<VideoRatio, string> = {
  "16:9": "16:9 横屏",
  "4:3": "4:3 横屏",
  "1:1": "1:1 方形",
  "3:4": "3:4 竖屏",
  "9:16": "9:16 竖屏",
  "21:9": "21:9 超宽屏",
};

function resolveProjectVideoSpec(input?: Project["input"]) {
  const videoModel = input?.videoModel && isVideoModelKey(input.videoModel)
    ? input.videoModel
    : "seedance-2.0-standard";
  const profile = getVideoModelProfile(videoModel);
  const ratio = input?.ratio && isVideoRatio(input.ratio) ? input.ratio : "9:16";
  const resolution = input?.resolution && isVideoResolution(input.resolution) && profile.resolutions.includes(input.resolution)
    ? input.resolution
    : profile.defaultResolution;
  const fps = input?.fps && isVideoFps(input.fps) ? input.fps : 24;
  const duration = VIDEO_DURATION_OPTIONS.includes((input?.duration ?? 15) as (typeof VIDEO_DURATION_OPTIONS)[number])
    ? input?.duration ?? 15
    : 15;
  return { duration, videoModel, ratio, resolution, fps };
}

function videoRatioNumber(ratio: VideoRatio) {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}

function monitorRatioStyle(ratio: VideoRatio): CSSProperties {
  return {
    aspectRatio: ratio.replace(":", " / "),
    "--video-ratio": String(videoRatioNumber(ratio)),
  } as CSSProperties;
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusCopy(status: string, phase?: string | null) {
  const copy: Record<string, { eyebrow: string; title: string; detail: string }> = {
    ingesting: { eyebrow: "正在建立素材语境", title: "先提炼高光，再开始创作", detail: "每条参考提取2～3个有效创意点与高光点，过滤水印、片尾、重复展示和无效过渡。" },
    awaiting_inspiration_review: { eyebrow: "等待你选择灵感", title: "创意点与高光点已经列好", detail: "先勾选真正想采用的内容；确认后 Great Writer 才会开始融合全新创意。" },
    analyzing: { eyebrow: "已选灵感融合中", title: "只用你勾选的内容生成新创意", detail: "Great Writer 正在重组已选机制，未勾选内容不会进入故事。" },
    generating_assets: { eyebrow: "Visual Skills 分镜中", title: "正在把主故事拆成四幕分镜与可编辑资产", detail: "分镜提示词会同步写入总体提示词；资产确认后再生成连续关键帧。" },
    generating_asset_images: { eyebrow: "Seedream 资产图生成中", title: "正在逐项生成真实资产图", detail: "每张图严格对应一个已确认资产 ID；完成后会用原卡片排版替换占位图供你复核。" },
    awaiting_asset_image_review: { eyebrow: "等待资产图确认", title: "真实资产图已经回填", detail: "请在原资产卡位置检查人物、产品、物品与环境；确认后才规划四幕分镜。" },
    generating_video: { eyebrow: "Seedance 2.0 生成中", title: "镜头正在逐条进入监看台", detail: "高风险镜头会生成备选版本，系统自动保留质量更高的一条。" },
    planning_video_segments: { eyebrow: "AI 分段规划中", title: "正在把完整故事拆成连续片段", detail: "系统会按总时长规划若干个4～15秒片段，并为每段写出叙事目标与承接动作。" },
    submitting_video: { eyebrow: "片段准备提交", title: "正在提交当前视频片段", detail: "首段使用已确认分镜，后续片段会继承上一段尾帧，保持主体与动作连续。" },
    polling_video: { eyebrow: "Seedance 逐段生成中", title: "当前片段正在渲染", detail: "每段生成后先独立质检；通过后才会进入下一段。" },
    reviewing_video: { eyebrow: "片段质量检查中", title: "正在检查当前片段", detail: "核对故事目标、主体连续性与用户约束，通过后归档并继续下一段。" },
    assembling_video: { eyebrow: "完整成片融合中", title: "正在把所有片段合成一个视频", detail: "已通过质检的视频片段会按时间轴无重编码融合，再进入最终交付。" },
    quality_checking: { eyebrow: "质量门检查中", title: "正在核对主题、连续性与禁项", detail: "检查主体一致性、动作、文字、节奏和用户约束；不通过会立即停止，不交付偏题成片。" },
    post_processing: { eyebrow: "最后装配", title: "正在完成声音、字幕与节奏", detail: "配音、环境声、版权安全音乐和字幕统一完成后进入终检。" },
    final_checking: { eyebrow: "最终检查", title: "离交付只差最后一道门", detail: "验证成片规格、音画同步、黑帧与文件完整性。" },
    awaiting_review: { eyebrow: "等待你的确认", title: "制作已安全暂停", detail: "请检查当前内容；只有你确认后，系统才会继续调用下游模型。" },
    needs_action: { eyebrow: "需要你的操作", title: "参考解析已保留，Great Writer 故事需要重试", detail: "系统不会重新上传或解析视频；确认后只重新执行故事生成。" },
    failed: { eyebrow: "任务已停止", title: "制作过程遇到错误", detail: "后续步骤已经停止，请查看右侧实时输出和错误说明。" },
    cancelled: { eyebrow: "任务已结束", title: "这次制作已被取消", detail: "系统不会继续调用模型或生成视频。" },
  };
  return copy[phase ?? ""] ?? copy[status] ?? copy.ingesting;
}

function reviewRoute(project: Project) {
  if (["awaiting_inspiration_review", "awaiting_creative_review"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/creative-review`;
  if (["planning_images", "awaiting_image_plan", "generating_asset_images", "awaiting_asset_image_review", "planning_storyboard", "generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/creative-card`;
  if (project.pipelinePhase === "awaiting_canvas_review") return `/projects/${project.id}/canvas`;
  if (["planning_video_segments", "submitting_video", "polling_video", "reviewing_video", "assembling_video"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/progress`;
  return null;
}

export function Studio({ view = "references", projectId }: { view?: StudioView; projectId?: string }) {
  const router = useRouter();
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [topicMode, setTopicMode] = useState<"manual" | "ai">("ai");
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("品牌种草");
  const [audience, setAudience] = useState("20～35 岁，关注品质生活与效率的城市用户");
  const [platform, setPlatform] = useState("抖音");
  const [duration, setDuration] = useState(15);
  const [videoModel, setVideoModel] = useState<VideoModelKey>("seedance-2.0-standard");
  const [ratio, setRatio] = useState<VideoRatio>("9:16");
  const [resolution, setResolution] = useState<VideoResolution>("1080p");
  const [fps, setFps] = useState<VideoFps>(24);
  const [style, setStyle] = useState("真实生活感");
  const [company, setCompany] = useState("");
  const [mustInclude, setMustInclude] = useState("");
  const [mustAvoid, setMustAvoid] = useState("");
  const [cta, setCta] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [costAccepted, setCostAccepted] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [system, setSystem] = useState<SystemInfo>({ mode: "demo", provider: "演示适配器", model: "Seedance 2.0 Standard", storage: false, ready: true, missing: [] });
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState("开始制片");
  const [message, setMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsedTick, setElapsedTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const draftCreateStarted = useRef(false);
  const draftVersionRef = useRef(1);
  const pollInFlight = useRef(false);
  const activeProjectId = project?.id ?? projectId;

  useEffect(() => {
    fetch("/api/system")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setSystem(data as SystemInfo))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (view !== "references" || projectId || draftCreateStarted.current) return;
    draftCreateStarted.current = true;
    const requestKey = uid("draft");
    fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": requestKey },
      body: JSON.stringify({ action: "draft", requestKey }),
    })
      .then(async (response) => {
        const data = await response.json() as { project?: Project; error?: string };
        if (!response.ok || !data.project) throw new Error(data.error ?? "草稿创建失败");
        setProject(data.project);
        draftVersionRef.current = data.project.draftVersion;
        router.replace(`/projects/${data.project.id}/references`);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "草稿创建失败，请刷新重试。"));
  }, [projectId, router, view]);

  useEffect(() => {
    if (!activeProjectId) return;
    fetch(`/api/projects/${activeProjectId}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const loaded = (data as { project?: Project } | null)?.project;
        if (!loaded) return;
        setProject(loaded);
        draftVersionRef.current = loaded.draftVersion;
        const input = loaded.input;
        if (input.references) setReferences(input.references.map((item) => ({ ...item, file: undefined, status: "ready", progress: 100, statusText: item.kind === "file" ? "上传完成" : "链接检查完成" })));
        if (input.topicMode) setTopicMode(input.topicMode);
        if (typeof input.topic === "string") setTopic(input.topic);
        if (input.goal) setGoal(input.goal);
        if (input.audience) setAudience(input.audience);
        if (input.platform) setPlatform(input.platform);
        const loadedSpec = resolveProjectVideoSpec(input);
        setDuration(loadedSpec.duration);
        setVideoModel(loadedSpec.videoModel);
        setRatio(loadedSpec.ratio);
        setResolution(loadedSpec.resolution);
        setFps(loadedSpec.fps);
        if (input.style) setStyle(input.style);
        if (typeof input.company === "string") setCompany(input.company);
        if (typeof input.mustInclude === "string") setMustInclude(input.mustInclude);
        if (typeof input.mustAvoid === "string") setMustAvoid(input.mustAvoid);
        if (typeof input.cta === "string") setCta(input.cta);
        if (typeof input.rightsConfirmed === "boolean") setRightsConfirmed(input.rightsConfirmed);
        setCostAccepted(false);
        if (["references", "brief", "spec", "quote"].includes(view) && loaded.status !== "draft") {
          router.replace(loaded.status === "completed" ? `/projects/${loaded.id}/delivery` : `/projects/${loaded.id}/progress`);
          return;
        }
        if (view === "brief" && loaded.draftStep === "references") router.replace(`/projects/${loaded.id}/references`);
        if (view === "spec" && loaded.draftStep === "references") router.replace(`/projects/${loaded.id}/references`);
        if (view === "spec" && loaded.draftStep === "requirements") router.replace(`/projects/${loaded.id}/requirements`);
        if (view === "quote" && loaded.draftStep === "references") router.replace(`/projects/${loaded.id}/references`);
        if (view === "quote" && loaded.draftStep === "requirements") router.replace(`/projects/${loaded.id}/requirements`);
        if (view === "quote" && loaded.draftStep === "settings") router.replace(`/projects/${loaded.id}/settings`);
        if (view === "progress" && loaded.status === "draft") {
          const draftRoute = loaded.draftStep === "requirements" ? "requirements" : loaded.draftStep === "settings" ? "settings" : loaded.draftStep === "quote" ? "quote" : "references";
          router.replace(`/projects/${loaded.id}/${draftRoute}`);
        }
        if (view === "progress" && loaded.status === "awaiting_review") {
          const destination = reviewRoute(loaded);
          if (destination) router.replace(destination);
        }
        if (view === "progress" && loaded.status === "completed") router.replace(`/projects/${loaded.id}/delivery`);
        if (view === "result" && loaded.status !== "completed") router.replace(`/projects/${loaded.id}/progress`);
      })
      .catch(() => undefined);
  }, [activeProjectId, router, view]);

  useEffect(() => {
    if (view !== "progress" || !activeProjectId) return;
    const timer = window.setInterval(async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      setElapsedTick((value) => value + 1);
      try {
        const response = await fetch(`/api/projects/${activeProjectId}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { project: Project };
        setProject(data.project);
        draftVersionRef.current = data.project.draftVersion;
        if (data.project.status === "awaiting_review") {
          const destination = reviewRoute(data.project);
          if (destination) router.replace(destination);
        }
        if (data.project.status === "completed") router.replace(`/projects/${data.project.id}/delivery`);
      } catch {
        // The persisted project stays visible while a transient poll fails.
      } finally {
        pollInFlight.current = false;
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeProjectId, router, view]);

  function addFiles(files: FileList | File[]) {
    setMessage("");
    const current = references.length;
    const accepted = Array.from(files).filter((file) => {
      const validType = file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
      return validType && file.size > 0 && file.size <= MAX_MULTIMODAL_VIDEO_BYTES;
    });
    if (accepted.length !== Array.from(files).length) {
      setMessage("部分文件未添加：仅支持有效的 MP4、MOV 或 WebM，且单条不能超过 50MB。 ");
    }
    const next = accepted.slice(0, Math.max(0, 10 - current)).map((file) => ({
      id: uid(), kind: "file" as const, name: file.name, file, size: file.size, priority: false, emphasis: ["节奏", "画面"], status: "pending" as const, progress: 0, statusText: "等待上传",
    }));
    setReferences((items) => [...items, ...next]);
    next.forEach((item) => void processFileReference(item));
  }

  async function addUrl() {
    const value = urlDraft.trim();
    if (!value) return;
    if (references.length >= 10) return setMessage("最多添加 10 个参考视频。 ");
    if (!/^https?:\/\//i.test(value) && !value.startsWith("demo://")) {
      return setMessage("请输入完整的抖音或小红书分享链接。 ");
    }
    const source = /xiaohongshu|xhslink/i.test(value) ? "小红书参考" : /douyin/i.test(value) ? "抖音参考" : "视频链接";
    const item: ReferenceItem = { id: uid(), kind: "url", name: `${source} ${references.length + 1}`, url: value, priority: false, emphasis: ["开头", "节奏"], status: value.startsWith("demo://") ? "ready" : "processing", progress: value.startsWith("demo://") ? 100 : 12, statusText: value.startsWith("demo://") ? "示例已就绪" : "正在检查链接" };
    setReferences((items) => [...items, item]);
    setUrlDraft("");
    setMessage("");
    if (!value.startsWith("demo://")) await parseLinkReference(item);
  }

  function loadDemoReferences() {
    setReferences([
      { id: uid(), kind: "url", name: "示例参考 · 清晨咖啡", url: "demo://morning-coffee", priority: true, emphasis: ["开头", "画面"], status: "ready", progress: 100, statusText: "示例已就绪" },
      { id: uid(), kind: "url", name: "示例参考 · 城市节奏", url: "demo://city-rhythm", priority: false, emphasis: ["节奏", "声音"], status: "ready", progress: 100, statusText: "示例已就绪" },
      { id: uid(), kind: "url", name: "示例参考 · 产品特写", url: "demo://product-detail", priority: false, emphasis: ["画面", "反转"], status: "ready", progress: 100, statusText: "示例已就绪" },
    ]);
    setTopicMode("ai");
    setGoal("品牌种草");
    setAudience("20～35 岁，关注品质生活与效率的城市用户");
    setRightsConfirmed(true);
    setMessage("");
  }

  function togglePriority(id: string) {
    setReferences((items) => {
      const count = items.filter((item) => item.priority).length;
      return items.map((item) => item.id === id ? { ...item, priority: item.priority ? false : count < 3 } : item);
    });
  }

  function toggleEmphasis(id: string, value: string) {
    setReferences((items) => items.map((item) => item.id === id ? {
      ...item,
      emphasis: item.emphasis.includes(value) ? item.emphasis.filter((entry) => entry !== value) : [...item.emphasis, value],
    } : item));
  }

  function changeVideoModel(nextModel: VideoModelKey) {
    const profile = getVideoModelProfile(nextModel);
    setVideoModel(nextModel);
    setResolution((current) => profile.resolutions.includes(current) ? current : profile.defaultResolution);
  }

  function serializableReferences(items = references) {
    return items.map((item) => ({ id: item.id, kind: item.kind, name: item.name, url: item.url, resolvedUrl: item.resolvedUrl, directVideo: item.directVideo, size: item.size, priority: item.priority, emphasis: item.emphasis, uploadId: item.uploadId }));
  }

  function updateReference(id: string, patch: Partial<ReferenceItem>) {
    setReferences((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function processFileReference(item: ReferenceItem) {
    updateReference(item.id, { status: "processing", progress: 2, statusText: "准备上传", error: undefined });
    try {
      const uploaded = await uploadReference(item, (progress, statusText) => updateReference(item.id, { status: "processing", progress, statusText }));
      updateReference(item.id, { status: "ready", progress: 100, statusText: "上传完成并校验", uploadId: uploaded.uploadId, error: undefined });
    } catch (error) {
      updateReference(item.id, { status: "failed", statusText: "上传失败", error: error instanceof Error ? error.message : "上传失败" });
    }
  }

  async function parseLinkReference(item: ReferenceItem) {
    if (!activeProjectId || !item.url) {
      updateReference(item.id, { status: "failed", statusText: "链接检查失败", error: "草稿尚未准备好" });
      return;
    }
    updateReference(item.id, { status: "processing", progress: 18, statusText: "正在检查分享链接", error: undefined });
    try {
      const response = await fetch("/api/references/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, url: item.url }),
      });
      const result = await response.json().catch(() => null) as { reference?: { resolvedUrl?: string; directVideo?: boolean; note?: string }; error?: string } | null;
      if (!response.ok || !result?.reference) throw new Error(result?.error ?? "链接检查失败");
      updateReference(item.id, { status: "ready", progress: 100, statusText: result.reference.note ?? "链接检查完成", resolvedUrl: result.reference.resolvedUrl, directVideo: result.reference.directVideo, error: undefined });
    } catch (error) {
      updateReference(item.id, { status: "failed", progress: 100, statusText: "链接检查失败", error: error instanceof Error ? error.message : "链接检查失败" });
    }
  }

  async function patchDraft(step: "references" | "requirements" | "settings" | "quote", data: Record<string, unknown>, advance = false) {
    if (!activeProjectId) throw new Error("草稿尚未准备好，请稍后重试。");
    const response = await fetch(`/api/projects/${activeProjectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, data, advance, draftVersion: draftVersionRef.current }),
    });
    const result = await response.json() as { project?: Project; error?: string };
    if (!response.ok || !result.project) throw new Error(result.error ?? "草稿保存失败");
    setProject(result.project);
    draftVersionRef.current = result.project.draftVersion;
    return result.project;
  }

  async function uploadReference(item: ReferenceItem, onProgress?: (progress: number, status: string) => void) {
    if (!item.file) return { name: item.name, kind: item.kind, url: item.url, uploadId: item.uploadId, priority: item.priority, emphasis: item.emphasis };
    if (!activeProjectId) throw new Error("草稿尚未准备好，请稍后重试。");
    const startResponse = await fetch("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: activeProjectId,
        filename: item.file.name,
        contentType: videoContentType(item.file),
        byteSize: item.file.size,
      }),
    });
    const started = await startResponse.json().catch(() => null) as { upload?: { id: string; partSize: number }; error?: string } | null;
    if (!startResponse.ok || !started?.upload) {
      throw new Error(started?.error ?? `无法开始上传 ${item.name}`);
    }

    const { id, partSize } = started.upload;
    const partCount = Math.ceil(item.file.size / partSize);
    const parts: { partNumber: number; etag: string }[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const start = (partNumber - 1) * partSize;
      const chunk = item.file.slice(start, Math.min(start + partSize, item.file.size));
      onProgress?.(Math.max(4, Math.round((start / item.file.size) * 90)), `上传分片 ${partNumber}/${partCount}`);
      parts.push(await uploadPartWithRetry(`/api/uploads/${id}/parts/${partNumber}`, chunk));
      onProgress?.(Math.min(94, Math.round((partNumber / partCount) * 90)), `已上传 ${partNumber}/${partCount} 分片`);
    }

    onProgress?.(96, "正在合并并校验文件");
    const completeResponse = await fetch(`/api/uploads/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts }),
    });
    const completed = await completeResponse.json().catch(() => null) as { upload?: { id: string }; error?: string } | null;
    if (!completeResponse.ok || !completed?.upload) {
      throw new Error(completed?.error ?? `完成 ${item.name} 上传失败`);
    }
    return { name: item.name, kind: item.kind, uploadId: completed.upload.id, priority: item.priority, emphasis: item.emphasis };
  }

  async function continueFromReferences() {
    setMessage("");
    if (!references.length) return setMessage("请先添加至少一个参考视频。 ");
    if (references.some((item) => item.status !== "ready")) return setMessage("请等待所有视频上传或链接检查完成。 ");
    setSubmitting(true);
    try {
      setSubmitLabel("保存参考素材");
      await patchDraft("references", { references: serializableReferences(references) }, true);
      router.push(`/projects/${activeProjectId}/requirements`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "参考视频处理失败，请重试。 ");
    } finally {
      setSubmitting(false);
      setSubmitLabel("下一步：创作要求");
    }
  }

  async function continueFromBrief() {
    setMessage("");
    if (!references.length) return router.push(activeProjectId ? `/projects/${activeProjectId}/references` : "/");
    if (!audience.trim()) return setMessage("请填写目标观众。 ");
    if (topicMode === "manual" && !topic.trim()) return setMessage("请填写视频主题，或改为由 AI 自动提出。 ");
    setSubmitting(true);
    try {
      await patchDraft("requirements", { topicMode, topic: topic.trim(), goal, audience: audience.trim(), company: company.trim(), mustInclude: mustInclude.trim(), mustAvoid: mustAvoid.trim(), cta: cta.trim() }, true);
      router.push(`/projects/${activeProjectId}/settings`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创作要求保存失败，请重试。 ");
    } finally {
      setSubmitting(false);
    }
  }

  async function continueFromSpec() {
    setMessage("");
    if (!references.length) return setMessage("请先添加至少一个参考视频。 ");
    if (!audience.trim()) return setMessage("请填写目标观众。 ");
    if (topicMode === "manual" && !topic.trim()) return setMessage("请填写视频主题，或改为由 AI 自动提出。 ");
    if (!rightsConfirmed) return setMessage("请先确认素材使用权。 ");

    setSubmitting(true);
    try {
      setSubmitLabel("计算平台成本");
      await patchDraft("settings", { platform, duration, videoModel, ratio, resolution, fps, style, rightsConfirmed }, true);
      router.push(`/projects/${activeProjectId}/quote`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "成本预估失败，请重试。 ");
    } finally {
      setSubmitting(false);
      setSubmitLabel("查看成本");
    }
  }

  async function confirmCostAndStart() {
    setMessage("");
    if (!costAccepted) return setMessage("请先确认预计平台成本。 ");
    if (!project) return setMessage("成本预估尚未准备好，请刷新重试。 ");
    setSubmitting(true);
    try {
      setSubmitLabel("确认并创建任务");
      const requestKey = uid("req");
      await patchDraft("quote", { accepted: true, quoteVersion: calculateCostQuote(references.length, duration, videoModel, resolution).version }, true);
      if (!activeProjectId) throw new Error("草稿尚未准备好，请稍后重试。");
      const response = await fetch(`/api/projects/${activeProjectId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify({ requestKey, draftVersion: draftVersionRef.current }),
      });
      const data = await response.json() as { error?: string; project: Project };
      if (!response.ok) throw new Error(data.error ?? "任务创建失败");
      setProject(data.project);
      window.localStorage.setItem("jingliu:last-project", data.project.id);
      router.push(`/projects/${data.project.id}/progress`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务创建失败，请重试。 ");
    } finally {
      setSubmitting(false);
      setSubmitLabel("确认成本并开始");
    }
  }

  async function retryCreativeOnly() {
    if (!project || !["needs_action", "failed"].includes(project.status) || !["creative_recovery", "synthesizing"].includes(project.pipelinePhase ?? "")) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/retry-creative`, { method: "POST" });
      const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      if (!response.ok || !data?.project) throw new Error(data?.error ?? "无法重新启动 Great Writer 故事生成");
      setProject(data.project);
      const destination = reviewRoute(data.project);
      if (destination) router.push(destination);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Great Writer 故事重试失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function retryCurrentStep() {
    if (!project || !["needs_action", "failed"].includes(project.status)) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/retry-step`, { method: "POST" });
      const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      if (!response.ok || !data?.project) throw new Error(data?.error ?? "无法重新启动当前步骤");
      setProject(data.project);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "当前步骤重试失败");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadProcessLog() {
    if (!project) return;
    const payload = {
      projectId: project.id,
      status: project.status,
      phase: project.pipelinePhase,
      error: project.error,
      activity: project.activity ?? [],
      diagnostics: project.diagnostics ?? [],
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jingliu-${project.id.slice(0, 8)}-process-log.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function startNewVideo() {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    const requestKey = uid("draft");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify({ action: "draft", requestKey }),
      });
      const data = await response.json() as { project?: Project; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error ?? "新视频草稿创建失败");
      window.localStorage.setItem("jingliu:last-project", data.project.id);
      window.location.assign(`/projects/${data.project.id}/references`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新视频草稿创建失败，请重试。");
      setSubmitting(false);
    }
  }

  function toggleVideo() {
    const element = videoRef.current;
    if (!element) return setIsPlaying((value) => !value);
    if (element.paused) {
      element.play().catch(() => undefined);
      setIsPlaying(true);
    } else {
      element.pause();
      setIsPlaying(false);
    }
  }

  function downloadManifest() {
    if (!project) return;
    const projectSpec = resolveProjectVideoSpec(project.input);
    const projectDimensions = formatVideoDimensions(projectSpec.ratio, projectSpec.resolution);
    const manifest = {
      projectId: project.id,
      title: project.title,
      status: project.status,
      specification: {
        duration: projectSpec.duration,
        model: getVideoModelProfile(projectSpec.videoModel).label,
        ratio: projectSpec.ratio,
        resolution: projectSpec.resolution,
        dimensions: projectDimensions,
        fps: projectSpec.fps,
        segmentCount: project.result?.segmentCount ?? segmentDurations(projectSpec.duration).length,
        segmentDurations: project.result?.segments?.map((segment) => segment.duration) ?? segmentDurations(projectSpec.duration),
        format: "MP4",
      },
      creative: project.result,
      generatedAt: project.updatedAt,
      note: project.runMode === "demo" ? "演示任务：接入生产模型后将由此处交付真实 MP4。" : undefined,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.title || "镜流成片"}-制作清单.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const priorityCount = references.filter((item) => item.priority).length;
  const referencesReady = references.length > 0 && references.every((item) => item.status === "ready");
  const referencesProcessing = references.some((item) => item.status === "pending" || item.status === "processing");
  const needsHighlightSelectionRecovery = Boolean(project
    && project.status === "failed"
    && project.pipelinePhase === "synthesizing"
    && !(project.review?.selectedHighlightIds?.length)
    && project.error?.message?.includes("没有已勾选"));
  const needsCreativeRecovery = Boolean(project && (
    (project.status === "needs_action" && project.pipelinePhase === "creative_recovery")
    || (project.status === "failed" && project.pipelinePhase === "synthesizing" && project.error?.code === "ArkPipelineError")
  ));
  const recoverableStepPhases = ["ingesting", "waiting_file", "planning_images", "generating_asset_images", "planning_storyboard", "generating_images", "reviewing_images", "planning_video_segments", "submitting_video", "polling_video", "reviewing_video", "assembling_video"];
  const needsStepRecovery = Boolean(project && (
    (project.status === "needs_action" && (project.stepRecovery?.retryable || recoverableStepPhases.includes(project.pipelinePhase ?? "")))
    || (project.status === "failed" && recoverableStepPhases.includes(project.pipelinePhase ?? ""))
  ));
  const regeneratesStoryboard = Boolean(project && (
    project.pipelinePhase === "generating_images"
    || (project.pipelinePhase === "reviewing_images" && (
      project.stepRecovery?.resumePhase === "generating_images"
      || project.activity?.some((event) => event.phase === "failed" && event.message.includes("分镜图片质量检查未通过"))
    ))
  ));
  const isStopped = Boolean(project && ["failed", "cancelled"].includes(project.status) && !needsCreativeRecovery && !needsStepRecovery);
  const isPaused = isStopped || needsCreativeRecovery || needsStepRecovery;
  const currentProcessIndex = project?.status === "completed"
    ? processSteps.length
    : needsHighlightSelectionRecovery
      ? Math.max(0, processSteps.findIndex((step) => step.key === "select"))
      : Math.max(0, processSteps.findIndex((step) => (project?.progress ?? 0) < step.end));
  const processDoneCount = project?.status === "completed" ? processSteps.length : currentProcessIndex;
  const currentCopy = project ? statusCopy(project.status, project.pipelinePhase) : statusCopy("ingesting");
  const selectedProfile = getVideoModelProfile(videoModel);
  const selectedDimensions = getVideoDimensions(ratio, resolution);
  const selectedDimensionLabel = `${selectedDimensions.width} × ${selectedDimensions.height}`;
  const selectedSegmentDurations = segmentDurations(duration);
  const projectSpec = resolveProjectVideoSpec(project?.input);
  const projectProfile = getVideoModelProfile(projectSpec.videoModel);
  const projectDimensionLabel = formatVideoDimensions(projectSpec.ratio, projectSpec.resolution);
  const projectSegmentDurations = segmentDurations(projectSpec.duration);
  const displaySegments = project?.videoProduction?.segments?.length
    ? project.videoProduction.segments
    : projectSegmentDurations.map((segmentDuration, index) => ({
      order: index + 1,
      startSec: projectSegmentDurations.slice(0, index).reduce((sum, item) => sum + item, 0),
      endSec: projectSegmentDurations.slice(0, index + 1).reduce((sum, item) => sum + item, 0),
      duration: segmentDuration,
      title: `视频片段 ${index + 1}`,
      narrativeGoal: "等待 AI 完成分段规划",
      transitionOut: index === projectSegmentDurations.length - 1 ? "结尾收束" : "尾帧承接下一段",
      status: "planned",
    }));
  const segmentTotal = project?.videoProduction?.segmentCount ?? project?.result?.segmentCount ?? projectSegmentDurations.length;
  const segmentProgress = project ? Math.max(0, Math.min(1, (project.progress - 76) / 19)) : 0;
  const segmentsDone = project?.videoProduction?.completedCount ?? (project?.progress && project.progress >= 96
    ? segmentTotal
    : Math.min(segmentTotal, Math.floor(segmentProgress * segmentTotal)));
  const activeSegmentIndex = project?.videoProduction?.activeSegmentIndex ?? (project && project.progress >= 76 && project.progress < 96
    ? Math.min(segmentTotal - 1, Math.floor(segmentProgress * segmentTotal))
    : -1);
  const canBriefContinue = references.length > 0 && Boolean(audience.trim()) && (topicMode === "ai" || Boolean(topic.trim()));
  const canStart = canBriefContinue && rightsConfirmed;
  const currentQuote = calculateCostQuote(references.length, duration, videoModel, resolution);
  const savedQuote = project?.input.quote;
  const quote = savedQuote?.version === currentQuote.version
    && savedQuote.duration === duration
    && savedQuote.modelKey === videoModel
    && savedQuote.resolution === resolution
    ? savedQuote
    : currentQuote;
  const title = topicMode === "manual" && topic.trim() ? topic.trim() : "AI 将根据参考视频自动定题";
  const modelLabel = selectedProfile.label;
  const createStep = view === "references" ? 1 : view === "brief" ? 2 : view === "spec" ? 3 : 4;
  const pageCopy = view === "references"
    ? { eyebrow: "STEP 01 / REFERENCE", first: "先给我看，", second: "你喜欢什么。", lead: "添加参考视频并标记你喜欢的部分。完成后，再进入创作要求。" }
    : view === "brief"
      ? { eyebrow: "STEP 02 / CREATIVE BRIEF", first: "说清楚，", second: "这条视频要打动谁。", lead: "确定主题来源、内容目标和目标观众，然后再确认最终成片规格。" }
      : view === "spec"
        ? { eyebrow: "STEP 03 / PRODUCTION SPEC", first: "确定规格，", second: "再计算成本。", lead: "确认平台、时长、画面风格与素材权利。下一页先展示成本，不会启动视频解析。" }
        : { eyebrow: "STEP 04 / COST APPROVAL", first: "先看成本，", second: "确认后才开工。", lead: "下面是本次解析与生成的预计平台成本。只有你明确确认后，系统才会开始解析参考视频。" };
  const nextAction = view === "references" ? continueFromReferences : view === "brief" ? continueFromBrief : view === "spec" ? continueFromSpec : confirmCostAndStart;
  const nextDisabled = view === "references" ? !referencesReady : view === "brief" ? !canBriefContinue : view === "spec" ? !canStart : !costAccepted;
  const nextLabel = submitting ? submitLabel : view === "references" ? referencesProcessing ? "等待素材处理完成" : "下一步：创作要求" : view === "brief" ? "下一步：成片设置" : view === "spec" ? "下一步：查看成本" : "确认成本并开始";

  if (projectId && ["references", "brief", "spec", "quote"].includes(view) && !project) {
    return <ProjectLoading system={system} label="正在恢复制片草稿" />;
  }

  if ((view === "progress" || view === "result") && !project) {
    return <ProjectLoading system={system} label={view === "progress" ? "正在载入制作任务" : "正在载入成片"} />;
  }

  if (view === "progress" && project) {
    const activity = project.activity?.length ? project.activity : [{ id: "current", phase: project.pipelinePhase ?? project.status, message: currentCopy.detail, createdAt: project.updatedAt, level: isPaused ? "error" as const : "info" as const }];
    return (
      <main className="studio-shell progress-shell">
        <Topbar system={system} compact />
        <section className="progress-head wrap">
          <div>
            <button className="text-button" onClick={() => router.push("/")}>← 返回制片单</button>
            <p className="eyebrow">任务 {project.id.slice(0, 8).toUpperCase()}</p>
            <h1>{needsHighlightSelectionRecovery ? "创意高光正在等待你勾选" : needsCreativeRecovery ? "Great Writer 故事需要重新处理" : needsStepRecovery ? `${project.stepRecovery?.stage ?? "当前步骤"}需要重新处理` : isStopped ? project.status === "cancelled" ? "任务已结束" : "制作已停止" : "正在制作视频"}</h1>
            <p>{needsHighlightSelectionRecovery ? `${project.input.references.length}条参考的候选高光已经保留；进入选择页勾选后才会生成新创意。` : needsCreativeRecovery ? `${project.input.references.length}条参考视频解析已经保留；重试不会重新上传或重新解析素材。` : needsStepRecovery ? "已完成的上游素材和确认结果全部保留；重试只执行当前失败步骤。" : isStopped ? "系统已停止后续步骤，请查看错误并重新输入。" : "任务会在后台继续运行，你可以安全离开此页面。"}</p>
          </div>
          <div className={`run-chip ${isPaused ? "stopped" : ""}`}><span className="live-dot" /> {needsCreativeRecovery || needsStepRecovery ? "等待重试" : isStopped ? "任务已停止" : project.runMode === "demo" ? "演示管线" : "生产管线"}</div>
        </section>

        {isStopped && <section className="run-error wrap" role="alert"><div><span>{project.status === "cancelled" ? "CANCELLED" : "FAILED"}</span><strong>{project.error?.message || (project.status === "cancelled" ? "任务已由用户结束" : "制作过程中发生错误")}</strong><p>不会继续执行任何后续模型任务。请重新检查素材、链接或创作要求后再提交。</p></div><button onClick={() => router.push("/")}>重新输入并创建新任务 →</button></section>}
        {needsCreativeRecovery && <section className="run-error recovery-error wrap" role="alert"><div><span>{needsHighlightSelectionRecovery ? "HIGHLIGHT SELECTION" : "STORY RECOVERY"}</span><strong>{needsHighlightSelectionRecovery ? "候选创意点与高光点已经提取完成，但还没有勾选" : project.error?.message || project.recovery?.message || "Great Writer 故事没有通过结构校验"}</strong><p>{needsHighlightSelectionRecovery ? "点击右侧按钮进入专用选择页。每条参考会展示2～3个候选，可跨视频多选；未选内容不会进入创意融合。" : "单条视频解析结果不会丢失；系统将只重试故事生成，最多执行“同模型修复 + 备用模型”三层兜底。"}</p>{message && <p className="recovery-message">{message}</p>}{!needsHighlightSelectionRecovery && project.recovery?.attempts?.length ? <details className="recovery-attempts"><summary>查看模型与字段错误</summary>{project.recovery.attempts.map((attempt, index) => <div key={`${attempt.createdAt}-${index}`}><b>{attempt.model}</b><span>{attempt.strategy} · {attempt.status}</span>{attempt.errors.slice(0, 5).map((error) => <code key={error}>{error}</code>)}</div>)}</details> : null}</div><button disabled={submitting} onClick={() => void retryCreativeOnly()}>{submitting ? (needsHighlightSelectionRecovery ? "正在打开选择页…" : "正在恢复故事…") : (needsHighlightSelectionRecovery ? "前往勾选创意高光 →" : "仅重试 Great Writer 故事 →")}</button></section>}
        {needsStepRecovery && <section className="run-error recovery-error wrap" role="alert"><div><span>STEP RECOVERY</span><strong>{project.error?.message || project.stepRecovery?.message || "当前步骤没有返回可用结果"}</strong><p>{regeneratesStoryboard ? "质检意见已经保存。系统会保留已确认的故事、资产卡与四幕规划，重新生成四张分镜后自动再次质检。" : `失败阶段：${project.stepRecovery?.stage ?? project.pipelinePhase}；模型：${project.stepRecovery?.model ?? project.error?.model ?? "历史任务未记录具体模型"}。详细响应见右侧“流程诊断日志”。`}</p>{message && <p className="recovery-message">{message}</p>}</div><button disabled={submitting} onClick={() => void retryCurrentStep()}>{submitting ? (regeneratesStoryboard ? "正在重新生成分镜…" : "正在恢复步骤…") : (regeneratesStoryboard ? "按质检意见重新生成分镜 →" : "仅重试当前步骤 →")}</button></section>}

        <section className="monitor-grid wrap">
          <aside className="stage-rail" aria-label="制作阶段">
            <div className="section-kicker">制作轨道</div>
            {processSteps.map((stage, index) => {
              const state = index < currentProcessIndex ? "done" : index === currentProcessIndex ? isPaused ? "failed" : "active" : "pending";
              return (
                <div className={`stage-item ${state}`} key={stage.key}>
                  <span className="stage-index">{state === "done" ? "✓" : state === "failed" ? "!" : String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{stage.label}</strong><small>{state === "done" ? "已完成" : state === "active" ? `正在进行 · ${stage.detail}` : state === "failed" ? "失败并停止" : `等待 · ${stage.detail}`}</small></span>
                </div>
              );
            })}
          </aside>

          <div className={`portrait-monitor is-processing ${project.keyframeUrl ? "has-keyframe" : ""}`} style={monitorRatioStyle(projectSpec.ratio)}>
            <div className="monitor-topline"><span>MONITOR A</span><span>{projectSpec.ratio} · {projectSpec.fps} FPS</span></div>
            {project.keyframeUrl && <Image className="keyframe-preview" src={project.keyframeUrl} alt="Seedream 生成的已确认分镜画面" fill sizes="(max-width: 820px) 62vh, 390px" unoptimized />}
            <div className="focus-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            {!project.keyframeUrl && !isPaused && <div className="processing-orbit" aria-hidden="true"><span /><span /><span /></div>}
            {project.pipelinePhase === "generating_images" && !project.keyframeUrl && !isPaused && <div className="keyframe-live"><i /><span>SEEDREAM</span><strong>正在生成4张连贯分镜</strong><small>主体 · 场景 · 构图 · 光线</small></div>}
            {project.keyframeUrl && <div className="keyframe-ready"><span>STORYBOARD READY</span><small>{project.keyframeModel ?? "Seedream 5.0 Lite"} · 4 FRAMES</small></div>}
            <div className={`monitor-copy ${project.keyframeUrl ? "over-keyframe" : ""}`}>
              <span>{currentCopy.eyebrow}</span>
              <strong>{currentCopy.title}</strong>
              <p>{currentCopy.detail}</p>
            </div>
            <div className="monitor-timecode">{formatClock(Math.min(projectSpec.duration, elapsedTick))} / {formatClock(projectSpec.duration)}</div>
          </div>

          <aside className="run-inspector">
            <div className="section-kicker">实时监看</div>
            <div className="big-progress"><strong>{processDoneCount}</strong><span>/ {processSteps.length} 步完成</span></div>
            <div className="meter" aria-label={`整体进度 ${project.progress}%`}><span style={{ width: `${project.progress}%` }} /></div>
            <dl className="run-stats">
              <div><dt>已用时间</dt><dd>{formatElapsed(project.createdAt)}</dd></div>
              <div><dt>参考可用</dt><dd>{project.input.references.length} / {project.input.references.length}</dd></div>
              <div><dt>视频片段</dt><dd>{segmentsDone} / {segmentTotal}</dd></div>
              <div><dt>当前片段</dt><dd>{activeSegmentIndex >= 0 && displaySegments[activeSegmentIndex] ? `第 ${displaySegments[activeSegmentIndex].order} 段 · ${displaySegments[activeSegmentIndex].duration}s` : project.pipelinePhase === "assembling_video" ? "正在融合全部片段" : "等待 AI 分段"}</dd></div>
              <div><dt>当前规格</dt><dd>{projectDimensionLabel} · {projectSpec.fps} fps</dd></div>
              <div><dt>平台成本</dt><dd>{project.runMode === "demo" ? "￥0.00" : "计算中"}</dd></div>
            </dl>
            <div className="status-note">
               <span className="note-mark">{isPaused ? "!" : project.status === "quality_checking" ? "↻" : "i"}</span>
               <p>{needsHighlightSelectionRecovery ? "参考视频无需重新解析。进入选择页后勾选候选高光，再确认生成新的融合创意。" : needsCreativeRecovery ? "参考解析已安全保留。点击上方按钮后，只会重试 Great Writer 故事生成，不会重复产生视频解析费用。" : needsStepRecovery ? "当前步骤已暂停。下载诊断日志可查看阶段、模型、响应状态、字段错误和脱敏后的模型原文片段。" : isStopped ? "任务已经终止，不会继续执行后续模型步骤。请返回重新检查输入后创建新任务。" : project.status === "quality_checking" ? "正在做交付前硬质检；主题跑偏、主体漂移或命中禁项都会停止交付。" : "现在不需要操作。制作完成后会自动进入交付页。"}</p>
             </div>
             <div className="live-stream" aria-live="polite">
               <div className="stream-head"><span>实时输出</span><i>{needsCreativeRecovery || needsStepRecovery ? "PAUSED" : isStopped ? "STOPPED" : "LIVE"}</i></div>
               <div className="stream-lines">
                 {activity.slice(-10).map((event) => <div className={`stream-line ${event.level ?? "info"}`} key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><p>{event.message}</p></div>)}
                 {!isPaused && <div className="stream-cursor"><span />等待下一条状态更新</div>}
               </div>
             </div>
            <details className="diagnostics">
               <summary>流程诊断日志 · {project.diagnostics?.length ?? 0} 条</summary>
               <div><span>生成模型</span><strong>{projectProfile.label}</strong></div>
               <div><span>任务模式</span><strong>{project.runMode === "demo" ? "Mock Provider" : "Volcengine"}</strong></div>
               <div><span>状态码</span><strong>{project.status}</strong></div>
               {(project.diagnostics ?? []).slice(-10).map((log) => <article className="diagnostic-entry" key={log.id}><header><b>{log.stage}</b><time>{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></header><p>{log.message}</p><dl><div><dt>模型</dt><dd>{log.model ?? "未记录"}</dd></div><div><dt>状态</dt><dd>{log.providerStatus ?? log.status}</dd></div>{typeof log.durationMs === "number" && <div><dt>耗时</dt><dd>{log.durationMs} ms</dd></div>}{log.errorCode && <div><dt>错误码</dt><dd>{log.errorCode}</dd></div>}</dl>{log.validationErrors?.map((error) => <code key={error}>{error}</code>)}{log.responseExcerpt && <details><summary>模型原文片段</summary><pre>{log.responseExcerpt}</pre></details>}</article>)}
               <button className="log-download" onClick={downloadProcessLog}>下载完整流程日志 JSON</button>
             </details>
          </aside>
        </section>

        {!isPaused && <section className="contact-sheet wrap">
          <div className="contact-title"><span>VIDEO SEGMENTS · AI 自动拆分</span><span>{segmentsDone}/{segmentTotal} READY</span></div>
          <div className="shot-strip">
            {displaySegments.map((segment, index) => {
              const ready = segment.status === "archived" || index < segmentsDone;
              const active = ["queued", "running", "reviewing"].includes(segment.status) || (!ready && index === activeSegmentIndex);
              return <div className={`shot-card shot-${index % 4} ${ready ? "ready" : ""} ${active ? "active" : ""}`} key={index} title={`${segment.title}：${segment.narrativeGoal}`}>
                <span>CLIP {String(segment.order).padStart(2, "0")} · {segment.duration}s</span>
                <i>{ready ? "✓ 已质检" : active ? segment.status === "reviewing" ? "质检中" : "生成中" : "等待"}</i>
              </div>;
            })}
          </div>
        </section>}
      </main>
    );
  }

  if (view === "result" && project) {
    const hasVideo = Boolean(project.result?.videoUrl);
    return (
      <main className="studio-shell delivery-shell">
        <Topbar system={system} compact />
        <section className="delivery-head wrap">
          <div><p className="eyebrow">DELIVERY / {project.id.slice(0, 8).toUpperCase()}</p><h1>视频已完成</h1><p>成片已通过质量检查并完成归档。</p></div>
          <div className="pass-badge"><span>✓</span><div><strong>交付门已通过</strong><small>画面 · 声音 · 文件完整性</small></div></div>
        </section>

        <section className="delivery-grid wrap">
          <div className="delivery-player-wrap">
            <div className="portrait-monitor delivery-monitor" style={monitorRatioStyle(projectSpec.ratio)} onClick={toggleVideo} role="button" tabIndex={0} aria-label={isPlaying ? "暂停视频" : "播放视频"} onKeyDown={(event) => event.key === "Enter" && toggleVideo()}>
              {hasVideo ? (
                <video ref={videoRef} src={project.result?.videoUrl} autoPlay muted loop playsInline onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
              ) : (
                <div className={`demo-film ${isPlaying ? "playing" : "paused"}`}>
                  <div className="demo-sun" /><div className="demo-product" /><div className="demo-caption"><span>把寻常的一天</span><strong>过成自己的作品</strong></div>
                </div>
              )}
              <div className="monitor-topline"><span>FINAL MASTER</span><span>{projectDimensionLabel}</span></div>
              <button className="play-control" onClick={(event) => { event.stopPropagation(); toggleVideo(); }}>{isPlaying ? "Ⅱ" : "▶"}</button>
              <div className="delivery-timecode">00:00 / {formatClock(projectSpec.duration)}</div>
            </div>
            {project.runMode === "demo" && <p className="demo-disclosure"><span>演示成片</span> 当前环境未配置生产模型密钥，此样片仅用于验收页面与交付流程。</p>}
          </div>

          <aside className="delivery-panel">
            <div className="section-kicker">成片交付</div>
            <h2>{project.title}</h2>
            <p className="delivery-summary">{project.result?.concept ?? "用真实生活片段承接产品价值，在快节奏开头后转入克制、可信的日常体验。"}</p>
            <button className={`primary-action ${hasVideo ? "" : "is-disabled"}`} disabled={!hasVideo} onClick={() => {
              if (!project.result?.videoUrl) return;
              const anchor = document.createElement("a"); anchor.href = project.result.videoUrl; anchor.download = `${project.title}.mp4`; anchor.click();
            }}>{hasVideo ? "下载 MP4" : "生产模式下下载 MP4"}<span>↓</span></button>
            <button className="new-video-action" disabled={submitting} onClick={startNewVideo}>
              <span><strong>{submitting ? "正在创建新任务…" : "开始生成新视频"}</strong><small>创建独立任务，本次成片与制作记录会保留</small></span><b aria-hidden="true">＋</b>
            </button>
            <button className="secondary-action" onClick={downloadManifest}>下载制作清单 <span>↘</span></button>
            {message && <p className="form-message" role="alert">{message}</p>}

            <dl className="delivery-specs">
              <div><dt>时长</dt><dd>{projectSpec.duration} 秒 · {segmentTotal} 段融合</dd></div>
              <div><dt>规格</dt><dd>{projectDimensionLabel} · {projectSpec.fps} fps</dd></div>
              <div><dt>画幅</dt><dd>{ratioLabels[projectSpec.ratio]}</dd></div>
              <div><dt>模型</dt><dd>{projectProfile.label}</dd></div>
              <div><dt>格式</dt><dd>MP4</dd></div>
              <div><dt>质量检查</dt><dd className="passed">已通过</dd></div>
            </dl>

            <div className="creative-card">
              <span>CREATIVE NOTE</span>
              <strong>{project.result?.hook ?? "前 2 秒：你不是没时间，只是还没找到自己的节奏。"}</strong>
              <p>一个动作切入 → 三段生活节奏 → 产品自然成为转折点 → 收束到可记忆的情绪句。</p>
            </div>

            <div className="cost-row"><span>实际平台成本</span><strong>{project.runMode === "demo" ? "演示任务未产生费用" : project.result?.actualCost ? `￥${project.result.actualCost.toFixed(2)}` : "待回填"}</strong></div>
          </aside>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-shell create-shell">
      <Topbar system={system} />
      <nav className="wizard-bar wrap" aria-label="新建视频步骤">
        {["参考素材", "创作要求", "成片设置", "成本确认"].map((label, index) => {
          const step = index + 1;
          const state = step < createStep ? "done" : step === createStep ? "active" : "pending";
          return <div className={`wizard-step ${state}`} key={label}><span>{state === "done" ? "✓" : String(step).padStart(2, "0")}</span><strong>{label}</strong><i /></div>;
        })}
      </nav>
      <section className="hero wrap">
        <div className="hero-copy">
          {view !== "references" && <button className="step-back" onClick={() => router.push(view === "brief" ? `/projects/${activeProjectId}/references` : view === "spec" ? `/projects/${activeProjectId}/requirements` : `/projects/${activeProjectId}/settings`)}>← 返回上一步</button>}
          <p className="eyebrow">{pageCopy.eyebrow}</p>
          <h1>{pageCopy.first}<br /><em>{pageCopy.second}</em></h1>
          <p className="hero-lead">{pageCopy.lead}</p>
        </div>
        <div className="hero-filmstrip" aria-hidden="true">
          <div className="film-frame frame-a"><span>REFERENCE</span><i>01</i></div>
          <div className="film-frame frame-b"><span>CONCEPT</span><i>02</i></div>
          <div className="film-frame frame-c"><span>MASTER</span><i>03</i></div>
          <div className="film-arrow">→</div>
        </div>
      </section>

      <section className="workspace wrap">
        <div className="brief-column">
          {view === "references" && <section className="form-section step-form-section">
            <div className="section-heading"><span className="section-number">01</span><div><h2>参考内容</h2><p>添加 1～10 个视频，最多标记 3 个重点参考。</p></div><button className="example-button" onClick={loadDemoReferences}>载入示例</button></div>
            <div className={`upload-zone ${isDragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files); }}>
              <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" multiple hidden onChange={(event) => event.target.files && addFiles(event.target.files)} />
              <div className="upload-mark">↑</div><div><strong>拖入参考视频</strong><span>MP4 / MOV / WebM · 单条最多 50MB · 自动分片上传</span></div><button onClick={() => fileInput.current?.click()}>选择文件</button>
            </div>
            <div className="url-row"><span>或</span><input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addUrl()} placeholder="粘贴抖音 / 小红书分享链接" aria-label="参考视频链接" /><button onClick={addUrl}>添加链接</button></div>
            {references.length > 0 && <div className="reference-list">
              <div className="list-meta"><span>已添加 {references.length}/10</span><span>重点参考 {priorityCount}/3</span></div>
              {references.map((item, index) => <article className="reference-item" key={item.id}>
                <div className={`reference-thumb thumb-${index % 4}`}><span>{item.kind === "file" ? "UP" : "URL"}</span><i>{String(index + 1).padStart(2, "0")}</i></div>
                <div className="reference-main"><div className="reference-title"><strong>{item.name}</strong><small>{item.kind === "file" ? formatBytes(item.size) : item.url?.startsWith("demo://") ? "内置示例素材" : "分享链接"}</small></div>
                  <div className={`reference-progress ${item.status ?? "ready"}`} aria-label={`${item.statusText ?? "处理完成"} ${item.progress ?? 100}%`}><div><span>{item.statusText ?? "处理完成"}</span><strong>{item.status === "processing" || item.status === "pending" ? `${item.progress ?? 0}%` : item.status === "failed" ? "需要重试" : "完成"}</strong></div><div className="reference-meter"><i style={{ width: `${item.progress ?? 100}%` }} /></div>{item.error && <small>{item.error}</small>}</div>
                  <div className="emphasis-row"><span>偏好</span>{emphasisOptions.map((entry) => <button className={item.emphasis.includes(entry) ? "selected" : ""} key={entry} onClick={() => toggleEmphasis(item.id, entry)}>{entry}</button>)}</div>
                </div>
                <div className="reference-actions">{item.status === "failed" && <button className="retry" onClick={() => item.kind === "file" ? void processFileReference(item) : void parseLinkReference(item)}>重试</button>}<button className={item.priority ? "priority active" : "priority"} onClick={() => togglePriority(item.id)}>{item.priority ? "★ 重点" : "☆ 设为重点"}</button><button className="remove" aria-label={`移除 ${item.name}`} onClick={() => setReferences((items) => items.filter((entry) => entry.id !== item.id))}>×</button></div>
              </article>)}
            </div>}
          </section>}

          {view === "brief" && <section className="form-section step-form-section">
            <div className="section-heading"><span className="section-number">02</span><div><h2>创作要求</h2><p>告诉系统要对谁说、为什么说。</p></div></div>
            <fieldset className="topic-modes"><legend>主题来源</legend><button className={topicMode === "manual" ? "active" : ""} onClick={() => setTopicMode("manual")}><span>我已有主题</span><small>直接按明确主题创作</small></button><button className={topicMode === "ai" ? "active" : ""} onClick={() => setTopicMode("ai")}><span>由 AI 自动定题</span><small>根据参考视频提出主题</small></button></fieldset>
            {topicMode === "manual" && <label className="field"><span>视频主题</span><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="例如：下班后，也能把生活过得很充实" /></label>}
            {topicMode === "ai" && <div className="ai-topic-note"><span>AI</span><p>系统会比较所有参考的创意点，最终只保留一个最适合当前受众与目标的主题。</p></div>}
            <div className="field"><span>内容目标</span><div className="choice-grid">{goals.map((item) => <button className={goal === item ? "active" : ""} key={item} onClick={() => setGoal(item)}>{item}</button>)}</div></div>
            <label className="field"><span>目标观众</span><textarea value={audience} onChange={(event) => setAudience(event.target.value)} rows={2} placeholder="例如：20～30 岁、刚工作的城市年轻人" /></label>
          </section>}

          {view === "brief" && <section className="form-section advanced-section">
            <button className="advanced-toggle" onClick={() => setAdvanced((value) => !value)}><span><b>+</b><strong>补充要求</strong><small>客户、必备内容、避雷项与结尾引导</small></span><i>{advanced ? "−" : "+"}</i></button>
            {advanced && <div className="advanced-fields"><label className="field"><span>客户 / 产品</span><input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="品牌、产品或服务名称" /></label><div className="two-fields"><label className="field"><span>必须出现</span><textarea value={mustInclude} onChange={(event) => setMustInclude(event.target.value)} rows={3} placeholder="产品卖点、场景、文案…" /></label><label className="field"><span>禁止出现</span><textarea value={mustAvoid} onChange={(event) => setMustAvoid(event.target.value)} rows={3} placeholder="禁用元素、表述、颜色…" /></label></div><label className="field"><span>结尾引导</span><input value={cta} onChange={(event) => setCta(event.target.value)} placeholder="例如：收藏这份周末清单" /></label></div>}
          </section>}

          {view === "spec" && <section className="form-section step-form-section spec-form-section">
            <div className="section-heading"><span className="section-number">03</span><div><h2>成片设置</h2><p>这些设置会冻结到本次生成任务中。</p></div></div>
            <div className="field"><span>发布平台</span><div className="segmented">{["抖音", "小红书"].map((item) => <button className={platform === item ? "active" : ""} key={item} onClick={() => setPlatform(item)}>{item}</button>)}</div></div>
            <div className="spec-select-grid">
              <label className="field spec-select"><span>成片总时长</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{VIDEO_DURATION_OPTIONS.map((item) => <option value={item} key={item}>{item} 秒</option>)}</select><small>AI 将拆为 {selectedSegmentDurations.length} 段：{selectedSegmentDurations.map((item) => `${item}s`).join(" + ")}</small></label>
              <label className="field spec-select"><span>生成模型</span><select value={videoModel} onChange={(event) => isVideoModelKey(event.target.value) && changeVideoModel(event.target.value)}>{VIDEO_MODEL_KEYS.map((key) => <option value={key} key={key}>{VIDEO_MODEL_PROFILES[key].label}</option>)}</select><small>{selectedProfile.description}</small></label>
              <label className="field spec-select"><span>画幅</span><select value={ratio} onChange={(event) => isVideoRatio(event.target.value) && setRatio(event.target.value)}>{VIDEO_RATIOS.map((item) => <option value={item} key={item}>{ratioLabels[item]}</option>)}</select><small>当前画布：{selectedDimensionLabel}</small></label>
              <label className="field spec-select"><span>清晰度</span><select value={resolution} onChange={(event) => isVideoResolution(event.target.value) && setResolution(event.target.value)}>{getSupportedResolutions(videoModel).map((item) => <option value={item} key={item}>{item} · {formatVideoDimensions(ratio, item)}</option>)}</select><small>切换模型时会自动排除不支持的档位</small></label>
              <label className="field spec-select"><span>帧率</span><select value={fps} onChange={(event) => { const value = Number(event.target.value); if (isVideoFps(value)) setFps(value); }}>{VIDEO_FPS_OPTIONS.map((item) => <option value={item} key={item}>{item} fps</option>)}</select><small>Seedance 2.0 当前原生输出帧率</small></label>
            </div>
            <div className="segment-plan-note"><span>AI LONG-FORM PLAN</span><strong>{duration} 秒成片 → {selectedSegmentDurations.length} 个连续视频片段 → 自动融合为 1 个 MP4</strong><p>每段控制在 4～15 秒；上一段尾帧会作为下一段首帧，逐段质检通过后再进行最终融合。</p></div>
            <div className="field"><span>画面风格</span><div className="choice-grid styles">{styles.map((item) => <button className={style === item ? "active" : ""} key={item} onClick={() => setStyle(item)}>{item}</button>)}</div></div>
          </section>}

          {view === "quote" && <section className="form-section step-form-section quote-form-section">
            <div className="section-heading"><span className="section-number">04</span><div><h2>成本确认</h2><p>以下为真实平台成本预估，不包含销售利润。</p></div></div>
            <div className="quote-total"><span>本次预计平台成本</span><strong>￥{quote.totalMin.toFixed(2)} <i>—</i> ￥{quote.totalMax.toFixed(2)}</strong><p>实际金额以火山方舟任务完成后返回的用量为准。</p></div>
            <div className="quote-breakdown">
              <div><span><b>01</b>视频解析、创意规划与双重质检</span><strong>￥{quote.analysis.min.toFixed(2)} — ￥{quote.analysis.max.toFixed(2)}</strong><small>{quote.referenceCount} 个参考 · 解析融合 · 图片质量复核 · 成片语义复核</small></div>
              <div><span><b>02</b>Seedream 资产图与连贯分镜</span><strong>￥{quote.storyboard.min.toFixed(2)}—￥{quote.storyboard.max.toFixed(2)}</strong><small>{quote.storyboard.assetCountMin}～{quote.storyboard.assetCountMax} 张单项资产图 + {quote.storyboard.count} 张四幕分镜 · {ratio}</small></div>
              <div><span><b>03</b>Seedance 分段视频生成</span><strong>￥{quote.generation.min.toFixed(2)} — ￥{quote.generation.max.toFixed(2)}</strong><small>{quote.model} · {quote.duration} 秒 · {quote.segmentCount} 段（{quote.segmentDurations.map((item) => `${item}s`).join(" + ")}）· {ratio} · {quote.resolution}</small></div>
              <div><span><b>04</b>片段融合、成片归档与存储</span><strong>￥{quote.storage.min.toFixed(2)} — ￥{quote.storage.max.toFixed(2)}</strong><small>逐段质检后自动融合为一个 MP4，并校验完整性后保存</small></div>
            </div>
            <div className="quote-gate"><span>尚未启动任何 AI 视频解析或生成</span><p>确认成本后先解析参考；创意小故事、资产拆分、创意卡总览和分镜画布都必须由你逐步确认。任一步失败都会立即停止。</p></div>
          </section>}
        </div>

        <aside className="production-dock">
          <div className="dock-top"><span>第 {createStep} / 4 步</span><small>PRODUCTION FLOW</small></div>
          <div className="spec-monitor" style={monitorRatioStyle(ratio)}><div className="monitor-gridlines" /><span>{ratio}</span><strong>{duration}<i>SEC · {selectedSegmentDurations.length} CLIPS</i></strong><small>{selectedDimensionLabel} · {fps} FPS</small></div>
          <div className="dock-title"><span>创作主题</span><strong>{title}</strong></div>
          <dl className="spec-list"><div><dt>平台</dt><dd>{platform}</dd></div><div><dt>目标</dt><dd>{goal}</dd></div><div><dt>风格</dt><dd>{style}</dd></div><div><dt>生成模型</dt><dd>{modelLabel}</dd></div><div><dt>视频规格</dt><dd>{ratio} · {resolution} · {fps} fps</dd></div><div><dt>AI 分段</dt><dd>{selectedSegmentDurations.length} 段 · 自动融合</dd></div></dl>
          <div className="cost-box"><div><span>预计平台成本</span><strong>￥{quote.totalMin.toFixed(2)}—￥{quote.totalMax.toFixed(2)}</strong></div><p>{view === "quote" ? "等待你确认；当前尚未启动 AI 视频解析。" : "进入成本确认页后，确认才会启动解析与生成。"}</p></div>
          {view === "spec" && <label className="rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span aria-hidden="true">✓</span><p>我确认有权将所提交的素材用于内部分析和视频制作。</p></label>}
          {view === "quote" && <label className="rights-check cost-confirm"><input type="checkbox" checked={costAccepted} onChange={(event) => setCostAccepted(event.target.checked)} /><span aria-hidden="true">✓</span><p>我已了解预计平台成本区间，同意开始解析参考视频；后续仍需逐步确认 Great Writer 故事、Visual Skills 分镜与总体提示词、资产及分镜画布。</p></label>}
          {message && <div className="form-message" role="alert">{message}</div>}
          <button className="start-button" disabled={nextDisabled || submitting || !activeProjectId} onClick={nextAction}><span>{nextLabel}</span><i>→</i></button>
          <p className="dock-footnote">当前步骤保存成功后才会进入下一页。</p>
        </aside>
      </section>
      <footer className="site-footer wrap"><span>镜流 JINGLIU · INTERNAL MVP</span><span>REFERENCE → STORY → FRAME → MASTER</span></footer>
    </main>
  );
}

function Topbar({ system, compact = false }: { system: SystemInfo; compact?: boolean }) {
  const productionReady = system.mode === "production" && system.ready !== false && system.storage;
  const stateClass = system.mode === "production" && !productionReady ? "demo" : system.mode;
  const title = system.mode === "demo" ? "演示环境" : productionReady ? "生产环境" : "生产配置未完成";
  const detail = system.mode === "demo"
    ? "接口待配置"
    : productionReady
      ? "服务正常"
      : system.missing?.length
        ? `缺少 ${system.missing.join(", ")}`
        : "存储绑定不可用";
  return <header className={`topbar ${compact ? "compact" : ""}`}><div className="wrap topbar-inner"><div className="brand"><span className="brand-mark"><i /><i /></span><strong>镜流</strong><em>JINGLIU</em></div><nav aria-label="产品导航"><span className="active">新建视频</span><span>制作记录</span></nav><div className={`system-state ${stateClass}`}><span /><strong>{title}</strong><small>{detail}</small></div></div></header>;
}

function ProjectLoading({ system, label }: { system: SystemInfo; label: string }) {
  return <main className="studio-shell loading-shell"><Topbar system={system} compact /><div className="project-loading"><span className="live-dot" /><strong>{label}</strong><p>正在从项目记录恢复当前步骤…</p></div></main>;
}
