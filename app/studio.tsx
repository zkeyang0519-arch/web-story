"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
};

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
  draftStep: "references" | "requirements" | "settings" | "locked";
  draftVersion: number;
  progress: number;
  runMode: "demo" | "production";
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

type StudioView = "references" | "brief" | "spec" | "progress" | "result";

const stages = [
  { key: "ingesting", label: "处理参考视频", short: "参考" },
  { key: "analyzing", label: "分析创意", short: "创意" },
  { key: "generating_assets", label: "准备视觉素材", short: "视觉" },
  { key: "generating_video", label: "生成视频镜头", short: "镜头" },
  { key: "quality_checking", label: "质检和优化", short: "质检" },
  { key: "post_processing", label: "完成配音与剪辑", short: "剪辑" },
] as const;

const stageIndex: Record<string, number> = {
  ingesting: 0,
  analyzing: 1,
  planning: 1,
  generating_assets: 2,
  generating_video: 3,
  quality_checking: 4,
  post_processing: 5,
  final_checking: 5,
  completed: 6,
};

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
    generating_assets: { eyebrow: "视觉预制中", title: "正在统一人物、场景与光线", detail: "先准备关键画面与镜头连续性，降低直接生成视频的随机性。" },
    generating_video: { eyebrow: "Seedance 2.0 生成中", title: "镜头正在逐条进入监看台", detail: "高风险镜头会生成备选版本，系统自动保留质量更高的一条。" },
    quality_checking: { eyebrow: "质量门检查中", title: "发现问题会只重做局部镜头", detail: "检查主体一致性、运动合理性、文字、节奏与画面瑕疵。" },
    post_processing: { eyebrow: "最后装配", title: "正在完成声音、字幕与节奏", detail: "配音、环境声、版权安全音乐和字幕统一完成后进入终检。" },
    final_checking: { eyebrow: "最终检查", title: "离交付只差最后一道门", detail: "验证成片规格、音画同步、黑帧与文件完整性。" },
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
        if (input.references) setReferences(input.references.map((item) => ({ ...item, file: undefined })));
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
        if (["references", "brief", "spec"].includes(view) && loaded.status !== "draft") {
          router.replace(loaded.status === "completed" ? `/projects/${loaded.id}/delivery` : `/projects/${loaded.id}/progress`);
          return;
        }
        if (view === "brief" && loaded.draftStep === "references") router.replace(`/projects/${loaded.id}/references`);
        if (view === "spec" && loaded.draftStep === "references") router.replace(`/projects/${loaded.id}/references`);
        if (view === "spec" && loaded.draftStep === "requirements") router.replace(`/projects/${loaded.id}/requirements`);
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

  const addFiles = useCallback((files: FileList | File[]) => {
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
      id: uid(), kind: "file" as const, name: file.name, file, size: file.size, priority: false, emphasis: ["节奏", "画面"],
    }));
    setReferences((items) => [...items, ...next]);
  }, [references.length]);

  function addUrl() {
    const value = urlDraft.trim();
    if (!value) return;
    if (references.length >= 10) return setMessage("最多添加 10 个参考视频。 ");
    if (!/^https?:\/\//i.test(value) && !value.startsWith("demo://")) {
      return setMessage("请输入完整的抖音或小红书分享链接。 ");
    }
    const source = /xiaohongshu|xhslink/i.test(value) ? "小红书参考" : /douyin/i.test(value) ? "抖音参考" : "视频链接";
    setReferences((items) => [...items, { id: uid(), kind: "url", name: `${source} ${items.length + 1}`, url: value, priority: false, emphasis: ["开头", "节奏"] }]);
    setUrlDraft("");
    setMessage("");
  }

  function loadDemoReferences() {
    setReferences([
      { id: uid(), kind: "url", name: "示例参考 · 清晨咖啡", url: "demo://morning-coffee", priority: true, emphasis: ["开头", "画面"] },
      { id: uid(), kind: "url", name: "示例参考 · 城市节奏", url: "demo://city-rhythm", priority: false, emphasis: ["节奏", "声音"] },
      { id: uid(), kind: "url", name: "示例参考 · 产品特写", url: "demo://product-detail", priority: false, emphasis: ["画面", "反转"] },
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
    return items.map((item) => ({ id: item.id, kind: item.kind, name: item.name, url: item.url, size: item.size, priority: item.priority, emphasis: item.emphasis, uploadId: item.uploadId }));
  }

  async function patchDraft(step: "references" | "requirements" | "settings", data: Record<string, unknown>, advance = false) {
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

  async function uploadReference(item: ReferenceItem) {
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
      const percent = Math.min(99, Math.round((start / item.file.size) * 100));
      setSubmitLabel(`上传 ${item.name} · ${percent}%`);
      parts.push(await uploadPartWithRetry(`/api/uploads/${id}/parts/${partNumber}`, chunk));
    }

    setSubmitLabel(`校验 ${item.name} · 100%`);
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
    setSubmitting(true);
    try {
      const normalized: ReferenceItem[] = references.map((item) => ({ ...item }));
      for (let index = 0; index < references.length; index += 1) {
        const item = normalized[index];
        setSubmitLabel(item.file ? `上传参考 ${index + 1}/${references.length}` : `检查参考 ${index + 1}/${references.length}`);
        const uploaded = await uploadReference(item);
        normalized[index] = { id: item.id, kind: item.kind, name: item.name, url: item.url, size: item.size, priority: item.priority, emphasis: item.emphasis, uploadId: uploaded.uploadId };
        setReferences([...normalized]);
        if (item.file) await patchDraft("references", { references: serializableReferences(normalized) });
      }
      await patchDraft("references", { references: serializableReferences(normalized) }, true);
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

  async function startProduction() {
    setMessage("");
    if (!references.length) return setMessage("请先添加至少一个参考视频。 ");
    if (!audience.trim()) return setMessage("请填写目标观众。 ");
    if (topicMode === "manual" && !topic.trim()) return setMessage("请填写视频主题，或改为由 AI 自动提出。 ");
    if (!rightsConfirmed) return setMessage("请先确认素材使用权。 ");

    setSubmitting(true);
    try {
      setSubmitLabel("创建制作任务");
      const requestKey = uid("req");
      await patchDraft("settings", { platform, duration, ratio: "9:16", style, rightsConfirmed }, true);
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
      setSubmitLabel("开始制片");
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
  const currentStage = project ? Math.min(stageIndex[project.status] ?? 0, 6) : 0;
  const currentCopy = project ? statusCopy(project.status) : statusCopy("ingesting");
  const shotTotal = duration === 15 ? 6 : duration === 30 ? 9 : 14;
  const shotsDone = project ? Math.min(shotTotal, Math.max(0, Math.round((project.progress - 42) / 58 * shotTotal))) : 0;
  const canBriefContinue = references.length > 0 && Boolean(audience.trim()) && (topicMode === "ai" || Boolean(topic.trim()));
  const canStart = canBriefContinue && rightsConfirmed;
  const title = topicMode === "manual" && topic.trim() ? topic.trim() : "AI 将根据参考视频自动定题";
  const modelLabel = system.model || "Seedance 2.0 Standard";
  const createStep = view === "references" ? 1 : view === "brief" ? 2 : 3;
  const pageCopy = view === "references"
    ? { eyebrow: "STEP 01 / REFERENCE", first: "先给我看，", second: "你喜欢什么。", lead: "添加参考视频并标记你喜欢的部分。完成后，再进入创作要求。" }
    : view === "brief"
      ? { eyebrow: "STEP 02 / CREATIVE BRIEF", first: "说清楚，", second: "这条视频要打动谁。", lead: "确定主题来源、内容目标和目标观众，然后再确认最终成片规格。" }
      : { eyebrow: "STEP 03 / PRODUCTION SPEC", first: "最后确认，", second: "成片怎么交付。", lead: "确认平台、时长、画面风格与素材权利后，系统才会正式开始制作。" };
  const nextAction = view === "references" ? continueFromReferences : view === "brief" ? continueFromBrief : startProduction;
  const nextDisabled = view === "references" ? references.length === 0 : view === "brief" ? !canBriefContinue : !canStart;
  const nextLabel = submitting ? submitLabel : view === "references" ? "下一步：创作要求" : view === "brief" ? "下一步：成片设置" : "开始制片";

  if (projectId && ["references", "brief", "spec"].includes(view) && !project) {
    return <ProjectLoading system={system} label="正在恢复制片草稿" />;
  }

  if ((view === "progress" || view === "result") && !project) {
    return <ProjectLoading system={system} label={view === "progress" ? "正在载入制作任务" : "正在载入成片"} />;
  }

  if (view === "progress" && project) {
    return (
      <main className="studio-shell progress-shell">
        <Topbar system={system} compact />
        <section className="progress-head wrap">
          <div>
            <button className="text-button" onClick={() => router.push("/")}>← 返回制片单</button>
            <p className="eyebrow">任务 {project.id.slice(0, 8).toUpperCase()}</p>
            <h1>正在制作视频</h1>
            <p>任务会在后台继续运行，你可以安全离开此页面。</p>
          </div>
          <div className="run-chip"><span className="live-dot" /> {project.runMode === "demo" ? "演示管线" : "生产管线"}</div>
        </section>

        <section className="monitor-grid wrap">
          <aside className="stage-rail" aria-label="制作阶段">
            <div className="section-kicker">制作轨道</div>
            {stages.map((stage, index) => {
              const state = index < currentStage ? "done" : index === currentStage ? "active" : "pending";
              return (
                <div className={`stage-item ${state}`} key={stage.key}>
                  <span className="stage-index">{state === "done" ? "✓" : String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{stage.label}</strong><small>{state === "done" ? "已完成" : state === "active" ? "正在进行" : "等待"}</small></span>
                </div>
              );
            })}
          </aside>

          <div className="portrait-monitor is-processing">
            <div className="monitor-topline"><span>MONITOR A</span><span>9:16 · 24 FPS</span></div>
            <div className="focus-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            <div className="processing-orbit" aria-hidden="true"><span /><span /><span /></div>
            <div className="monitor-copy">
              <span>{currentCopy.eyebrow}</span>
              <strong>{currentCopy.title}</strong>
              <p>{currentCopy.detail}</p>
            </div>
            <div className="monitor-timecode">00:{String(Math.min(59, elapsedTick)).padStart(2, "0")}:12</div>
          </div>

          <aside className="run-inspector">
            <div className="section-kicker">实时监看</div>
            <div className="big-progress"><strong>{currentStage >= 6 ? 6 : currentStage}</strong><span>/ 6 阶段完成</span></div>
            <div className="meter" aria-label={`整体进度 ${project.progress}%`}><span style={{ width: `${project.progress}%` }} /></div>
            <dl className="run-stats">
              <div><dt>已用时间</dt><dd>{formatElapsed(project.createdAt)}</dd></div>
              <div><dt>参考可用</dt><dd>{project.input.references.length} / {project.input.references.length}</dd></div>
              <div><dt>镜头通过</dt><dd>{shotsDone} / {shotTotal}</dd></div>
              <div><dt>平台成本</dt><dd>{project.runMode === "demo" ? "￥0.00" : "计算中"}</dd></div>
            </dl>
            <div className="status-note">
              <span className="note-mark">{project.status === "quality_checking" ? "↻" : "i"}</span>
              <p>{project.status === "quality_checking" ? "发现画面问题时，系统会自动优化局部镜头。" : "现在不需要操作。制作完成后会自动进入交付页。"}</p>
            </div>
            <details className="diagnostics">
              <summary>管理员诊断</summary>
              <div><span>生成模型</span><strong>{modelLabel}</strong></div>
              <div><span>任务模式</span><strong>{project.runMode === "demo" ? "Mock Provider" : "Volcengine"}</strong></div>
              <div><span>状态码</span><strong>{project.status}</strong></div>
            </details>
          </aside>
        </section>

        <section className="contact-sheet wrap">
          <div className="contact-title"><span>SHOT CONTACT SHEET</span><span>{shotsDone}/{shotTotal} READY</span></div>
          <div className="shot-strip">
            {Array.from({ length: shotTotal }).map((_, index) => {
              const ready = index < shotsDone;
              const active = index === shotsDone && currentStage >= 3 && currentStage < 6;
              return <div className={`shot-card shot-${index % 4} ${ready ? "ready" : ""} ${active ? "active" : ""}`} key={index}>
                <span>SHOT {String(index + 1).padStart(2, "0")}</span>
                <i>{ready ? "✓ 已通过" : active ? "生成中" : "等待"}</i>
              </div>;
            })}
          </div>
        </section>
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
        {["参考素材", "创作要求", "成片设置"].map((label, index) => {
          const step = index + 1;
          const state = step < createStep ? "done" : step === createStep ? "active" : "pending";
          return <div className={`wizard-step ${state}`} key={label}><span>{state === "done" ? "✓" : String(step).padStart(2, "0")}</span><strong>{label}</strong><i /></div>;
        })}
      </nav>
      <section className="hero wrap">
        <div className="hero-copy">
          {view !== "references" && <button className="step-back" onClick={() => router.push(view === "brief" ? `/projects/${activeProjectId}/references` : `/projects/${activeProjectId}/requirements`)}>← 返回上一步</button>}
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
                  <div className="emphasis-row"><span>偏好</span>{emphasisOptions.map((entry) => <button className={item.emphasis.includes(entry) ? "selected" : ""} key={entry} onClick={() => toggleEmphasis(item.id, entry)}>{entry}</button>)}</div>
                </div>
                <div className="reference-actions"><button className={item.priority ? "priority active" : "priority"} onClick={() => togglePriority(item.id)}>{item.priority ? "★ 重点" : "☆ 设为重点"}</button><button className="remove" aria-label={`移除 ${item.name}`} onClick={() => setReferences((items) => items.filter((entry) => entry.id !== item.id))}>×</button></div>
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
        </div>

        <aside className="production-dock">
          <div className="dock-top"><span>第 {createStep} / 3 步</span><small>PRODUCTION FLOW</small></div>
          <div className="spec-monitor"><div className="monitor-gridlines" /><span>9:16</span><strong>{duration}<i>SEC</i></strong><small>1080 × 1920</small></div>
          <div className="dock-title"><span>创作主题</span><strong>{title}</strong></div>
          <dl className="spec-list"><div><dt>平台</dt><dd>{platform}</dd></div><div><dt>目标</dt><dd>{goal}</dd></div><div><dt>风格</dt><dd>{style}</dd></div><div><dt>生成模型</dt><dd>{modelLabel}</dd></div></dl>
          <div className="cost-box"><div><span>预计平台成本</span><strong>{system.mode === "demo" ? "演示任务 ￥0" : "按真实用量回填"}</strong></div><p>生产模式会在提交前显示估算区间，完成后以平台返回用量为准。</p></div>
          {view === "spec" && <label className="rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span aria-hidden="true">✓</span><p>我确认有权将所提交的素材用于内部分析和视频制作。</p></label>}
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
