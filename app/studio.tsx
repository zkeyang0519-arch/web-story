"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { calculateCostQuote, type CostQuote } from "@/lib/cost";

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

type ProjectResult = {
  videoUrl?: string;
  qualityScore?: number;
  actualCost?: number | null;
  concept?: string;
  hook?: string;
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
  keyframeUrl?: string | null;
  keyframeModel?: string | null;
  keyframeSize?: string | null;
  activity?: ActivityEvent[];
  error?: { code?: string; message?: string } | null;
  createdAt: string;
  updatedAt: string;
  input: {
    duration: number;
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
};

type StudioView = "references" | "brief" | "spec" | "quote" | "progress" | "result";

const processSteps = [
  { key: "receive", label: "接收并校验参考素材", detail: "确认文件、链接与素材权限", end: 6 },
  { key: "preprocess", label: "方舟文件预处理", detail: "上传并准备画面与声音轨道", end: 18 },
  { key: "understand", label: "逐条视频内容解析", detail: "提取高光、节奏与创意机制", end: 30 },
  { key: "creative", label: "创意融合与剧本生成", detail: "收敛唯一创意和15秒剧本", end: 42 },
  { key: "keyframe", label: "Seedream 首帧生成", detail: "生成并归档9:16关键视觉", end: 57 },
  { key: "prompt", label: "图生视频提示词装配", detail: "绑定首帧和动作时间轴", end: 64 },
  { key: "submit", label: "提交 Seedance 2.0", detail: "以关键帧为首帧创建视频任务", end: 69 },
  { key: "render", label: "渲染画面、动作与声音", detail: "实时查询 Seedance 任务状态", end: 92 },
  { key: "deliver", label: "质量校验、归档与交付", detail: "下载成片并校验文件完整性", end: 101 },
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

function statusCopy(status: string) {
  const copy: Record<string, { eyebrow: string; title: string; detail: string }> = {
    ingesting: { eyebrow: "正在建立素材语境", title: "先看懂参考，再开始创作", detail: "提取节奏、画面语言与创意钩子，过滤水印、片尾和无效片段。" },
    analyzing: { eyebrow: "创意中枢工作中", title: "比较创意，并收敛成一个方向", detail: "Seed 视觉解析与高质量复核模型会提取、比较并融合创意，只把最终结论交给生成环节。" },
    generating_assets: { eyebrow: "Seedream 关键帧生成中", title: "正在把剧本变成首帧画面", detail: "生成9:16关键视觉并归档，完成后作为 Seedance 图生视频的首帧。" },
    generating_video: { eyebrow: "Seedance 2.0 生成中", title: "镜头正在逐条进入监看台", detail: "高风险镜头会生成备选版本，系统自动保留质量更高的一条。" },
    quality_checking: { eyebrow: "质量门检查中", title: "发现问题会只重做局部镜头", detail: "检查主体一致性、运动合理性、文字、节奏与画面瑕疵。" },
    post_processing: { eyebrow: "最后装配", title: "正在完成声音、字幕与节奏", detail: "配音、环境声、版权安全音乐和字幕统一完成后进入终检。" },
    final_checking: { eyebrow: "最终检查", title: "离交付只差最后一道门", detail: "验证成片规格、音画同步、黑帧与文件完整性。" },
    failed: { eyebrow: "任务已停止", title: "制作过程遇到错误", detail: "后续步骤已经停止，请查看右侧实时输出和错误说明。" },
    cancelled: { eyebrow: "任务已结束", title: "这次制作已被取消", detail: "系统不会继续调用模型或生成视频。" },
  };
  return copy[status] ?? copy.ingesting;
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
  const [style, setStyle] = useState("真实生活感");
  const [company, setCompany] = useState("");
  const [mustInclude, setMustInclude] = useState("");
  const [mustAvoid, setMustAvoid] = useState("");
  const [cta, setCta] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [costAccepted, setCostAccepted] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [system, setSystem] = useState<SystemInfo>({ mode: "demo", provider: "演示适配器", model: "Seedance 2.0 Standard", storage: false });
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
        if (input.duration) setDuration(input.duration);
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
      return validType && file.size > 0;
    });
    if (accepted.length !== Array.from(files).length) {
      setMessage("部分文件未添加：仅支持有效的 MP4、MOV 或 WebM 视频。 ");
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
      await patchDraft("settings", { platform, duration, ratio: "9:16", style, rightsConfirmed }, true);
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
      await patchDraft("quote", { accepted: true, quoteVersion: calculateCostQuote(references.length, duration).version }, true);
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

  function resetProduction() {
    setProject(null);
    setIsPlaying(true);
    router.push("/");
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
    const manifest = {
      projectId: project.id,
      title: project.title,
      status: project.status,
      specification: { resolution: "1080 × 1920", fps: 24, duration: project.input.duration, format: "MP4" },
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
  const isStopped = Boolean(project && ["failed", "cancelled"].includes(project.status));
  const currentProcessIndex = project?.status === "completed" ? processSteps.length : Math.max(0, processSteps.findIndex((step) => (project?.progress ?? 0) < step.end));
  const processDoneCount = project?.status === "completed" ? processSteps.length : currentProcessIndex;
  const currentCopy = project ? statusCopy(project.status) : statusCopy("ingesting");
  const shotTotal = duration === 15 ? 6 : duration === 30 ? 9 : 14;
  const shotsDone = project ? Math.min(shotTotal, Math.max(0, Math.round((project.progress - 42) / 58 * shotTotal))) : 0;
  const canBriefContinue = references.length > 0 && Boolean(audience.trim()) && (topicMode === "ai" || Boolean(topic.trim()));
  const canStart = canBriefContinue && rightsConfirmed;
  const currentQuote = calculateCostQuote(references.length, duration);
  const quote = project?.input.quote?.version === currentQuote.version ? project.input.quote : currentQuote;
  const title = topicMode === "manual" && topic.trim() ? topic.trim() : "AI 将根据参考视频自动定题";
  const modelLabel = system.model || "Seedance 2.0 Standard";
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
    const activity = project.activity?.length ? project.activity : [{ id: "current", phase: project.pipelinePhase ?? project.status, message: currentCopy.detail, createdAt: project.updatedAt, level: isStopped ? "error" as const : "info" as const }];
    return (
      <main className="studio-shell progress-shell">
        <Topbar system={system} compact />
        <section className="progress-head wrap">
          <div>
            <button className="text-button" onClick={() => router.push("/")}>← 返回制片单</button>
            <p className="eyebrow">任务 {project.id.slice(0, 8).toUpperCase()}</p>
            <h1>{isStopped ? project.status === "cancelled" ? "任务已结束" : "制作已停止" : "正在制作视频"}</h1>
            <p>{isStopped ? "系统已停止后续步骤，请查看错误并重新输入。" : "任务会在后台继续运行，你可以安全离开此页面。"}</p>
          </div>
          <div className={`run-chip ${isStopped ? "stopped" : ""}`}><span className="live-dot" /> {isStopped ? "任务已停止" : project.runMode === "demo" ? "演示管线" : "生产管线"}</div>
        </section>

        {isStopped && <section className="run-error wrap" role="alert"><div><span>{project.status === "cancelled" ? "CANCELLED" : "FAILED"}</span><strong>{project.error?.message || (project.status === "cancelled" ? "任务已由用户结束" : "制作过程中发生错误")}</strong><p>不会继续执行任何后续模型任务。请重新检查素材、链接或创作要求后再提交。</p></div><button onClick={() => router.push("/")}>重新输入并创建新任务 →</button></section>}

        <section className="monitor-grid wrap">
          <aside className="stage-rail" aria-label="制作阶段">
            <div className="section-kicker">制作轨道</div>
            {processSteps.map((stage, index) => {
              const state = index < currentProcessIndex ? "done" : index === currentProcessIndex ? isStopped ? "failed" : "active" : "pending";
              return (
                <div className={`stage-item ${state}`} key={stage.key}>
                  <span className="stage-index">{state === "done" ? "✓" : state === "failed" ? "!" : String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{stage.label}</strong><small>{state === "done" ? "已完成" : state === "active" ? `正在进行 · ${stage.detail}` : state === "failed" ? "失败并停止" : `等待 · ${stage.detail}`}</small></span>
                </div>
              );
            })}
          </aside>

          <div className={`portrait-monitor is-processing ${project.keyframeUrl ? "has-keyframe" : ""}`}>
            <div className="monitor-topline"><span>MONITOR A</span><span>9:16 · 24 FPS</span></div>
            {project.keyframeUrl && <Image className="keyframe-preview" src={project.keyframeUrl} alt="Seedream 生成的首帧关键视觉" fill sizes="(max-width: 820px) 62vh, 390px" unoptimized />}
            <div className="focus-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            {!project.keyframeUrl && <div className="processing-orbit" aria-hidden="true"><span /><span /><span /></div>}
            {project.pipelinePhase === "generating_keyframe" && !project.keyframeUrl && <div className="keyframe-live"><i /><span>SEEDREAM</span><strong>正在生成首帧关键视觉</strong><small>主体 · 场景 · 构图 · 光线</small></div>}
            {project.keyframeUrl && <div className="keyframe-ready"><span>KEYFRAME READY</span><small>{project.keyframeModel ?? "Seedream 5.0 Lite"} · {project.keyframeSize ?? "2K"}</small></div>}
            <div className={`monitor-copy ${project.keyframeUrl ? "over-keyframe" : ""}`}>
              <span>{currentCopy.eyebrow}</span>
              <strong>{currentCopy.title}</strong>
              <p>{currentCopy.detail}</p>
            </div>
            <div className="monitor-timecode">00:{String(Math.min(59, elapsedTick)).padStart(2, "0")}:12</div>
          </div>

          <aside className="run-inspector">
            <div className="section-kicker">实时监看</div>
            <div className="big-progress"><strong>{processDoneCount}</strong><span>/ {processSteps.length} 步完成</span></div>
            <div className="meter" aria-label={`整体进度 ${project.progress}%`}><span style={{ width: `${project.progress}%` }} /></div>
            <dl className="run-stats">
              <div><dt>已用时间</dt><dd>{formatElapsed(project.createdAt)}</dd></div>
              <div><dt>参考可用</dt><dd>{project.input.references.length} / {project.input.references.length}</dd></div>
              <div><dt>镜头通过</dt><dd>{shotsDone} / {shotTotal}</dd></div>
              <div><dt>平台成本</dt><dd>{project.runMode === "demo" ? "￥0.00" : "计算中"}</dd></div>
            </dl>
            <div className="status-note">
              <span className="note-mark">{isStopped ? "!" : project.status === "quality_checking" ? "↻" : "i"}</span>
              <p>{isStopped ? "任务已经终止，不会继续消耗模型额度。请返回重新检查输入后创建新任务。" : project.status === "quality_checking" ? "发现画面问题时，系统会自动优化局部镜头。" : "现在不需要操作。制作完成后会自动进入交付页。"}</p>
            </div>
            <div className="live-stream" aria-live="polite">
              <div className="stream-head"><span>实时输出</span><i>{isStopped ? "STOPPED" : "LIVE"}</i></div>
              <div className="stream-lines">
                {activity.slice(-10).map((event) => <div className={`stream-line ${event.level ?? "info"}`} key={event.id}><time>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><p>{event.message}</p></div>)}
                {!isStopped && <div className="stream-cursor"><span />等待下一条状态更新</div>}
              </div>
            </div>
            <details className="diagnostics">
              <summary>管理员诊断</summary>
              <div><span>生成模型</span><strong>{modelLabel}</strong></div>
              <div><span>任务模式</span><strong>{project.runMode === "demo" ? "Mock Provider" : "Volcengine"}</strong></div>
              <div><span>状态码</span><strong>{project.status}</strong></div>
            </details>
          </aside>
        </section>

        {!isStopped && <section className="contact-sheet wrap">
          <div className="contact-title"><span>SHOT CONTACT SHEET</span><span>{shotsDone}/{shotTotal} READY</span></div>
          <div className="shot-strip">
            {Array.from({ length: shotTotal }).map((_, index) => {
              const ready = index < shotsDone;
              const active = index === shotsDone && currentProcessIndex >= 6 && currentProcessIndex < processSteps.length;
              return <div className={`shot-card shot-${index % 4} ${ready ? "ready" : ""} ${active ? "active" : ""}`} key={index}>
                <span>SHOT {String(index + 1).padStart(2, "0")}</span>
                <i>{ready ? "✓ 已通过" : active ? "生成中" : "等待"}</i>
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
            <div className="portrait-monitor delivery-monitor" onClick={toggleVideo} role="button" tabIndex={0} aria-label={isPlaying ? "暂停视频" : "播放视频"} onKeyDown={(event) => event.key === "Enter" && toggleVideo()}>
              {hasVideo ? (
                <video ref={videoRef} src={project.result?.videoUrl} autoPlay muted loop playsInline onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
              ) : (
                <div className={`demo-film ${isPlaying ? "playing" : "paused"}`}>
                  <div className="demo-sun" /><div className="demo-product" /><div className="demo-caption"><span>把寻常的一天</span><strong>过成自己的作品</strong></div>
                </div>
              )}
              <div className="monitor-topline"><span>FINAL MASTER</span><span>1080 × 1920</span></div>
              <button className="play-control" onClick={(event) => { event.stopPropagation(); toggleVideo(); }}>{isPlaying ? "Ⅱ" : "▶"}</button>
              <div className="delivery-timecode">00:00 / 00:{project.input.duration}</div>
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
            <button className="secondary-action" onClick={downloadManifest}>下载制作清单 <span>↘</span></button>
            <button className="quiet-action" onClick={resetProduction}>重新生成一个版本</button>

            <dl className="delivery-specs">
              <div><dt>时长</dt><dd>{project.input.duration} 秒</dd></div>
              <div><dt>规格</dt><dd>1080 × 1920 · 24 fps</dd></div>
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
              <div className="upload-mark">↑</div><div><strong>拖入参考视频</strong><span>MP4 / MOV / WebM · 大文件自动分片上传</span></div><button onClick={() => fileInput.current?.click()}>选择文件</button>
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
            <div className="two-fields"><div className="field"><span>发布平台</span><div className="segmented">{["抖音", "小红书"].map((item) => <button className={platform === item ? "active" : ""} key={item} onClick={() => setPlatform(item)}>{item}</button>)}</div></div><div className="field"><span>成片时长</span><div className="segmented"><button className="active" onClick={() => setDuration(15)}>15s</button></div></div></div>
            <div className="field"><span>画面风格</span><div className="choice-grid styles">{styles.map((item) => <button className={style === item ? "active" : ""} key={item} onClick={() => setStyle(item)}>{item}</button>)}</div></div>
            <div className="locked-specs"><div><span>画幅</span><strong>9:16 竖屏</strong></div><div><span>清晰度</span><strong>1080 × 1920</strong></div><div><span>帧率</span><strong>24 fps</strong></div><div><span>模型</span><strong>{modelLabel}</strong></div></div>
          </section>}

          {view === "quote" && <section className="form-section step-form-section quote-form-section">
            <div className="section-heading"><span className="section-number">04</span><div><h2>成本确认</h2><p>以下为真实平台成本预估，不包含销售利润。</p></div></div>
            <div className="quote-total"><span>本次预计平台成本</span><strong>￥{quote.totalMin.toFixed(2)} <i>—</i> ￥{quote.totalMax.toFixed(2)}</strong><p>实际金额以火山方舟任务完成后返回的用量为准。</p></div>
            <div className="quote-breakdown">
              <div><span><b>01</b>参考视频 AI 解析</span><strong>￥{quote.analysis.min.toFixed(2)} — ￥{quote.analysis.max.toFixed(2)}</strong><small>{quote.referenceCount} 个参考视频 · 解析高光、节奏与创意机制</small></div>
              <div><span><b>02</b>Seedream 首帧关键视觉</span><strong>￥{quote.keyframe.min.toFixed(2)}</strong><small>1 张 · 9:16 · 2K · 用作 Seedance 图生视频首帧</small></div>
              <div><span><b>03</b>Seedance 视频生成</span><strong>￥{quote.generation.min.toFixed(2)} — ￥{quote.generation.max.toFixed(2)}</strong><small>{quote.model} · {quote.duration} 秒 · 9:16 · 1080p</small></div>
              <div><span><b>04</b>成片归档与存储</span><strong>￥{quote.storage.min.toFixed(2)} — ￥{quote.storage.max.toFixed(2)}</strong><small>下载、完整性校验并保存到对象存储</small></div>
            </div>
            <div className="quote-gate"><span>尚未启动任何 AI 视频解析或生成</span><p>点击确认后才会依次启动参考解析、创意融合和 Seedance 生成。任一步失败都会立即停止。</p></div>
          </section>}
        </div>

        <aside className="production-dock">
          <div className="dock-top"><span>第 {createStep} / 4 步</span><small>PRODUCTION FLOW</small></div>
          <div className="spec-monitor"><div className="monitor-gridlines" /><span>9:16</span><strong>{duration}<i>SEC</i></strong><small>1080 × 1920</small></div>
          <div className="dock-title"><span>创作主题</span><strong>{title}</strong></div>
          <dl className="spec-list"><div><dt>平台</dt><dd>{platform}</dd></div><div><dt>目标</dt><dd>{goal}</dd></div><div><dt>风格</dt><dd>{style}</dd></div><div><dt>生成模型</dt><dd>{modelLabel}</dd></div></dl>
          <div className="cost-box"><div><span>预计平台成本</span><strong>￥{quote.totalMin.toFixed(2)}—￥{quote.totalMax.toFixed(2)}</strong></div><p>{view === "quote" ? "等待你确认；当前尚未启动 AI 视频解析。" : "进入成本确认页后，确认才会启动解析与生成。"}</p></div>
          {view === "spec" && <label className="rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span aria-hidden="true">✓</span><p>我确认有权将所提交的素材用于内部分析和视频制作。</p></label>}
          {view === "quote" && <label className="rights-check cost-confirm"><input type="checkbox" checked={costAccepted} onChange={(event) => setCostAccepted(event.target.checked)} /><span aria-hidden="true">✓</span><p>我已了解预计平台成本区间，同意确认后开始解析参考视频并生成成片。</p></label>}
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
  return <header className={`topbar ${compact ? "compact" : ""}`}><div className="wrap topbar-inner"><div className="brand"><span className="brand-mark"><i /><i /></span><strong>镜流</strong><em>JINGLIU</em></div><nav aria-label="产品导航"><span className="active">新建视频</span><span>制作记录</span></nav><div className={`system-state ${system.mode}`}><span /><strong>{system.mode === "demo" ? "演示环境" : "生产环境"}</strong><small>{system.mode === "demo" ? "接口待配置" : "服务正常"}</small></div></div></header>;
}

function ProjectLoading({ system, label }: { system: SystemInfo; label: string }) {
  return <main className="studio-shell loading-shell"><Topbar system={system} compact /><div className="project-loading"><span className="live-dot" /><strong>{label}</strong><p>正在从项目记录恢复当前步骤…</p></div></main>;
}
