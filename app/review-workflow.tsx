"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Analysis = Record<string, unknown> & {
  source_index?: number;
  source_name?: string;
  summary?: string;
  hook?: string;
  creative_mechanism?: string;
  visual_grammar?: string;
  camera_and_motion?: string;
  pacing?: string;
  audio_design?: string;
  emotion_curve?: string;
  reusable_techniques?: string[];
  confidence?: number;
};

type Creative = {
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

type Frame = {
  id: string;
  order: number;
  time_range: string;
  title: string;
  narrative_goal: string;
  prompt: string;
  motion: string;
};

type ImagePlan = { continuity_anchor: string; frames: Frame[] };
type StoryboardImage = { frameId: string; order: number; url?: string | null; model?: string | null; size?: string | null };
type Canvas = {
  frames: Array<{ frameId: string; order: number; motion: string }>;
  transitions: Array<{ fromFrameId: string; toFrameId: string; description: string }>;
};

type Project = {
  id: string;
  title: string;
  status: string;
  progress: number;
  pipelinePhase?: string | null;
  reviewRevision?: number | null;
  storyboardImages?: StoryboardImage[];
  input: {
    goal?: string;
    audience?: string;
    platform?: string;
    style?: string;
    mustInclude?: string;
    mustAvoid?: string;
    references?: unknown[];
  };
  review?: {
    analyses?: Analysis[];
    creative?: Creative | null;
    imagePlan?: ImagePlan | null;
    canvas?: Canvas | null;
  } | null;
  error?: { message?: string } | null;
};

type ReviewView = "creative" | "images" | "canvas";

const transitionDefaults = [
  "动作匹配硬切，保持主体朝向和光线连续",
  "利用前景遮挡自然切换，延续运动方向",
  "节奏放缓后轻微叠化，稳定收束到结尾",
];

function nextReviewRoute(project: Project) {
  if (project.pipelinePhase === "awaiting_creative_review") return `/projects/${project.id}/creative-review`;
  if (["awaiting_image_plan", "generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/image-plan`;
  if (project.pipelinePhase === "awaiting_canvas_review") return `/projects/${project.id}/canvas`;
  return null;
}

function shotText(shot: Record<string, unknown>) {
  const preferred = shot.user_direction ?? shot.description ?? shot.action ?? shot.content ?? shot.summary;
  return typeof preferred === "string" ? preferred : JSON.stringify(shot, null, 2);
}

export function ReviewWorkflow({ view, projectId }: { view: ReviewView; projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [creative, setCreative] = useState<Creative>({});
  const [imagePlan, setImagePlan] = useState<ImagePlan | null>(null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [loadedFrameIds, setLoadedFrameIds] = useState<Set<string>>(() => new Set());
  const [failedFrameIds, setFailedFrameIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const initializedRevision = useRef<number | null>(null);
  const pollInFlight = useRef(false);

  const hydrateEditors = useCallback((loaded: Project) => {
    const revision = loaded.reviewRevision ?? 0;
    if (initializedRevision.current === revision) return;
    initializedRevision.current = revision;
    if (loaded.review?.analyses) setAnalyses(loaded.review.analyses);
    if (loaded.review?.creative) setCreative(loaded.review.creative);
    if (loaded.review?.imagePlan) {
      setImagePlan(loaded.review.imagePlan);
      const frames = loaded.review.imagePlan.frames.map((frame) => ({ frameId: frame.id, order: frame.order, motion: frame.motion }));
      setCanvas(loaded.review.canvas ?? {
        frames,
        transitions: frames.slice(0, -1).map((frame, index) => ({ fromFrameId: frame.frameId, toFrameId: frames[index + 1].frameId, description: transitionDefaults[index] })),
      });
    }
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
    if (!response.ok || !data?.project) throw new Error(data?.error ?? "无法读取制作任务");
    const loaded = data.project;
    setProject(loaded);
    hydrateEditors(loaded);
    if (["failed", "cancelled"].includes(loaded.status)) {
      router.replace(`/projects/${loaded.id}/progress`);
      return loaded;
    }
    if (loaded.status === "completed") {
      router.replace(`/projects/${loaded.id}/delivery`);
      return loaded;
    }
    const activeImageGeneration = view === "images" && ["generating_images", "reviewing_images"].includes(loaded.pipelinePhase ?? "");
    if (loaded.status !== "awaiting_review" && !activeImageGeneration) {
      router.replace(`/projects/${loaded.id}/progress`);
      return loaded;
    }
    const destination = nextReviewRoute(loaded);
    const currentPath = view === "creative" ? "creative-review" : view === "images" ? "image-plan" : "canvas";
    const keepFinishedImagesVisible = view === "images" && loaded.pipelinePhase === "awaiting_canvas_review";
    if (destination && !keepFinishedImagesVisible && !destination.endsWith(`/${currentPath}`)) router.replace(destination);
    return loaded;
  }, [hydrateEditors, projectId, router, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((error) => setMessage(error instanceof Error ? error.message : "任务读取失败"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (view !== "images" || !["generating_images", "reviewing_images"].includes(project?.pipelinePhase ?? "")) return;
    const timer = window.setInterval(async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "图片生成状态更新失败");
      } finally {
        pollInFlight.current = false;
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [load, project?.pipelinePhase, router, view]);

  async function approve(gate: "creative" | "image_plan" | "canvas", payload: unknown) {
    if (!project || project.reviewRevision == null) throw new Error("确认版本尚未准备好，请刷新后重试");
    const response = await fetch(`/api/projects/${project.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gate, revision: project.reviewRevision, payload }),
    });
    const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
    if (!response.ok || !data?.project) throw new Error(data?.error ?? "确认失败");
    initializedRevision.current = null;
    setProject(data.project);
    hydrateEditors(data.project);
    setDirty(false);
    return data.project;
  }

  async function confirmCreative() {
    setSubmitting(true); setMessage("");
    try {
      if (!analyses.length || !creative.theme?.trim() || !creative.concept?.trim() || !creative.hook?.trim() || !creative.story_arc?.trim()) throw new Error("请完整确认参考解析、主题、创意、开场钩子和故事结构");
      const updated = await approve("creative", { analyses, creative });
      router.push(`/projects/${updated.id}/progress`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "创意确认失败"); }
    finally { setSubmitting(false); }
  }

  async function confirmImagePlan() {
    setSubmitting(true); setMessage("");
    try {
      if (!imagePlan || imagePlan.frames.length !== 4 || imagePlan.frames.some((frame) => !frame.prompt.trim() || !frame.motion.trim())) throw new Error("4张图片的提示词和运动说明都必须填写");
      await approve("image_plan", imagePlan);
    } catch (error) { setMessage(error instanceof Error ? error.message : "图片提示词确认失败"); }
    finally { setSubmitting(false); }
  }

  async function confirmCanvas() {
    setSubmitting(true); setMessage("");
    try {
      if (!canvas || canvas.frames.some((frame) => !frame.motion.trim()) || canvas.transitions.some((transition) => !transition.description.trim())) throw new Error("每个镜头动作和每段转场都必须填写");
      const updated = await approve("canvas", canvas);
      router.push(`/projects/${updated.id}/progress`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "画布确认失败"); }
    finally { setSubmitting(false); }
  }

  if (!project) return <ReviewLoading label={view === "creative" ? "正在载入解析与创意" : view === "images" ? "正在载入图片方案" : "正在载入分镜画布"} error={message} onRetry={() => { setMessage(""); load().catch((error) => setMessage(error instanceof Error ? error.message : "任务读取失败")); }} />;
  const step = view === "creative" ? 1 : view === "images" ? 2 : 3;
  const generatingImages = view === "images" && ["generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "");
  const imagesReady = view === "images" && project.pipelinePhase === "awaiting_canvas_review";
  const imageByFrame = new Map((project.storyboardImages ?? []).map((image) => [image.frameId, image]));
  const allImagesAvailable = (project.storyboardImages?.length ?? 0) === 4 && project.storyboardImages!.every((image) => Boolean(image.url)) && loadedFrameIds.size === 4 && failedFrameIds.size === 0;

  return (
    <main className="review-shell" onChange={() => setDirty(true)}>
      <header className="review-topbar"><div className="review-brand"><span><i /><i /></span><strong>镜流</strong><em>JINGLIU</em></div><div className="review-project"><span>制作任务</span><strong>{project.title}</strong></div><button onClick={() => { if (!dirty || window.confirm("当前修改尚未确认，离开后会丢失。确定查看进程吗？")) router.push(`/projects/${project.id}/progress`); }}>查看进程</button></header>
      <nav className="review-track" aria-label="制作确认步骤">
        {["解析与创意", "图片提示词", "分镜画布", "视频生成"].map((label, index) => <div className={index + 1 < step ? "done" : index + 1 === step ? "active" : "pending"} key={label}><span>{index + 1 < step ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><i /></div>)}
      </nav>

      {view === "creative" && (
        <>
          <section className="review-hero"><div><p>CHECKPOINT 01 / CREATIVE</p><h1>先确认系统看懂了，<br /><em>再允许它继续创作。</em></h1><span>每条参考解析和最终融合创意都可以修改。你确认之前，不会生成图片。</span></div><ReviewPauseNote /></section>
          <section className="creative-review-grid">
            <div className="analysis-column">
              <div className="review-section-head"><span>REFERENCE READS</span><h2>逐条参考解析</h2><p>这里必须来自真实视频画面与声音；有偏差请直接改正。</p></div>
              {analyses.map((analysis, index) => <article className="analysis-paper" key={`${analysis.source_index ?? index}`}>
                <div className="paper-head"><span>REF {String(index + 1).padStart(2, "0")}</span><strong>{analysis.source_name ?? `参考视频 ${index + 1}`}</strong><small>置信度 {Math.round(Number(analysis.confidence ?? 0) * 100)}%</small></div>
                <EditableArea label="视频内容摘要" value={String(analysis.summary ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, summary: value } : item))} />
                <div className="two-review-fields"><EditableArea label="开场钩子" value={String(analysis.hook ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, hook: value } : item))} /><EditableArea label="可迁移创意机制" value={String(analysis.creative_mechanism ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, creative_mechanism: value } : item))} /></div>
                <div className="analysis-tags"><span>{analysis.visual_grammar || "待确认视觉语言"}</span><span>{analysis.pacing || "待确认节奏"}</span><span>{analysis.audio_design || "待确认声音"}</span></div>
                <details className="analysis-details"><summary>展开并修改完整解析</summary><div className="two-review-fields"><EditableArea label="视觉语言" value={String(analysis.visual_grammar ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, visual_grammar: value } : item))} /><EditableArea label="镜头与运动" value={String(analysis.camera_and_motion ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, camera_and_motion: value } : item))} /><EditableArea label="节奏" value={String(analysis.pacing ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, pacing: value } : item))} /><EditableArea label="声音设计" value={String(analysis.audio_design ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, audio_design: value } : item))} /><EditableArea label="情绪曲线" value={String(analysis.emotion_curve ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, emotion_curve: value } : item))} /></div></details>
              </article>)}
            </div>
            <aside className="fusion-editor">
              <div className="review-section-head"><span>ONE FINAL IDEA</span><h2>融合后的唯一创意</h2><p>下游图片与视频只以这份确认稿为准。</p></div>
              <label><span>主题</span><input value={creative.theme ?? ""} onChange={(event) => setCreative((item) => ({ ...item, theme: event.target.value }))} /></label>
              <EditableArea label="一句话创意" value={creative.concept ?? ""} onChange={(value) => setCreative((item) => ({ ...item, concept: value }))} />
              <EditableArea label="前2秒钩子" value={creative.hook ?? ""} onChange={(value) => setCreative((item) => ({ ...item, hook: value }))} />
              <EditableArea label="15秒故事结构" value={creative.story_arc ?? ""} onChange={(value) => setCreative((item) => ({ ...item, story_arc: value }))} />
              <div className="two-review-fields"><EditableArea label="视觉风格" value={creative.visual_style ?? ""} onChange={(value) => setCreative((item) => ({ ...item, visual_style: value }))} /><EditableArea label="声音方向" value={creative.audio_plan ?? ""} onChange={(value) => setCreative((item) => ({ ...item, audio_plan: value }))} /></div>
              <div className="shot-review-list"><span>镜头方向</span>{(creative.shot_plan ?? []).map((shot, index) => <label key={index}><b>{String(index + 1).padStart(2, "0")}</b><textarea value={shotText(shot)} rows={2} onChange={(event) => setCreative((item) => ({ ...item, shot_plan: (item.shot_plan ?? []).map((entry, entryIndex) => entryIndex === index ? { user_direction: event.target.value } : entry) }))} /></label>)}</div>
              <ConstraintCard project={project} />
            </aside>
          </section>
          <DecisionBar message={message} disabled={submitting} detail={`已解析 ${analyses.length} 个参考 · 确认后开始规划4张图片`} label={submitting ? "正在保存确认稿" : "确认解析与创意，规划图片 →"} onClick={confirmCreative} />
        </>
      )}

      {view === "images" && imagePlan && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 02 / IMAGE PROMPTS</p><h1>{imagesReady ? "四张分镜已经生成。" : generatingImages ? "正在生成四张连贯分镜。" : "先审提示词，"}<br /><em>{imagesReady ? "检查画面，再进入画布。" : generatingImages ? "完成后会在本页回填。" : "再花钱生成图片。"}</em></h1><span>{imagesReady ? "占位框已经替换为真实图片；确认无误后进入下一页连接动作和转场。" : generatingImages ? "占位框会在 Seedream 返回并归档后替换为真实图片。" : "每张卡上方是9:16画面位置，下方提示词可以逐张修改。"}</span></div><ReviewPauseNote active={generatingImages} /></section>
          <section className="continuity-editor"><span>CONTINUITY BIBLE</span><label>四张图共同保持<input value={imagePlan.continuity_anchor} readOnly={generatingImages || imagesReady} onChange={(event) => setImagePlan((plan) => plan ? { ...plan, continuity_anchor: event.target.value } : plan)} /></label></section>
          <section className="prompt-card-grid">
            {imagePlan.frames.map((frame, index) => {
              const generated = imageByFrame.get(frame.id);
              return <article className={`prompt-card ${generated?.url ? "has-image" : ""}`} key={frame.id}>
                <div className="prompt-visual">
                  {generated?.url ? <Image src={generated.url} alt={`分镜 ${frame.order}：${frame.title}`} fill sizes="(max-width: 700px) 90vw, 24vw" unoptimized onLoad={() => setLoadedFrameIds((items) => new Set(items).add(frame.id))} onError={() => { setFailedFrameIds((items) => new Set(items).add(frame.id)); setMessage(`分镜 ${frame.order} 图片加载失败，任务已停止进入下一步`); }} /> : <div className={`empty-frame ${generatingImages ? "is-generating" : ""}`}><span>{generatingImages ? "SEEDREAM" : `FRAME ${String(frame.order).padStart(2, "0")}`}</span><strong>{generatingImages ? "正在生成连贯组图" : "图片占位符"}</strong><i>{generatingImages ? "主体 · 构图 · 光线 · 连续性" : "确认提示词后生成"}</i></div>}
                  <div className="frame-meta"><span>{frame.time_range}</span><strong>{generated?.url ? "✓ 已生成" : generatingImages ? "生成中" : "待确认"}</strong></div>
                </div>
                <div className="prompt-copy"><span>FRAME {String(frame.order).padStart(2, "0")} · {frame.title}</span><strong>{frame.narrative_goal}</strong><label>图片提示词<textarea rows={9} value={frame.prompt} readOnly={generatingImages || imagesReady} onChange={(event) => setImagePlan((plan) => plan ? { ...plan, frames: plan.frames.map((item, itemIndex) => itemIndex === index ? { ...item, prompt: event.target.value } : item) } : plan)} /></label><label>画面运动<input value={frame.motion} readOnly={generatingImages || imagesReady} onChange={(event) => setImagePlan((plan) => plan ? { ...plan, frames: plan.frames.map((item, itemIndex) => itemIndex === index ? { ...item, motion: event.target.value } : item) } : plan)} /></label></div>
              </article>;
            })}
          </section>
          {!generatingImages && !imagesReady && <DecisionBar message={message} disabled={submitting} detail="4张组图预计平台成本 ￥0.88 · 确认后立即调用 Seedream" label={submitting ? "正在锁定提示词" : "确认提示词，生成4张图片 →"} onClick={confirmImagePlan} />}
          {imagesReady && <DecisionBar message={message} disabled={!allImagesAvailable} detail={allImagesAvailable ? "4张真实图片已加载并归档 · 下一页确认动作顺序与3个转场" : "正在验证4张图片是否完整可见"} label="图片无误，进入分镜画布 →" onClick={() => router.push(`/projects/${project.id}/canvas`)} />}
          {generatingImages && <div className="generation-dock" aria-live="polite"><span /><div><strong>Seedream 正在生成、质检并归档4张图片</strong><p>{message || "请保持本页打开；失败会立即停止并显示具体错误。"}</p></div></div>}
        </>
      )}

      {view === "canvas" && imagePlan && canvas && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 03 / MOTION CANVAS</p><h1>把四张图连成一条，<br /><em>确认后才生成视频。</em></h1><span>这里锁定图片顺序、每段动作与三处转场。Seedance 只接收这份已确认画布。</span></div><ReviewPauseNote /></section>
          <section className="canvas-board">
            <div className="canvas-ruler"><span>00:00</span><i /><span>00:15</span></div>
            <div className="canvas-sequence">
              {canvas.frames.map((canvasFrame, index) => {
                const frame = imagePlan.frames.find((item) => item.id === canvasFrame.frameId);
                const generated = imageByFrame.get(canvasFrame.frameId);
                return <div className="canvas-unit" key={canvasFrame.frameId}>
                  <article className="canvas-node"><div className="canvas-image">{generated?.url ? <Image src={generated.url} alt={`画布镜头 ${index + 1}`} fill sizes="(max-width: 820px) 70vw, 260px" unoptimized onLoad={() => setLoadedFrameIds((items) => new Set(items).add(canvasFrame.frameId))} onError={() => { setFailedFrameIds((items) => new Set(items).add(canvasFrame.frameId)); setMessage(`画布镜头 ${index + 1} 图片加载失败，不能提交视频`); }} /> : <div className="missing-frame">图片未归档</div>}<span>SHOT {String(index + 1).padStart(2, "0")}</span></div><div className="canvas-node-copy"><strong>{frame?.title}</strong><small>{frame?.time_range} · {frame?.narrative_goal}</small><label>动作与运镜<textarea rows={3} value={canvasFrame.motion} onChange={(event) => setCanvas((item) => item ? { ...item, frames: item.frames.map((entry, entryIndex) => entryIndex === index ? { ...entry, motion: event.target.value } : entry) } : item)} /></label></div></article>
                  {index < canvas.transitions.length && <div className="canvas-edge"><div><i /><span>→</span><i /></div><label>转场 {index + 1}<textarea rows={3} value={canvas.transitions[index].description} onChange={(event) => setCanvas((item) => item ? { ...item, transitions: item.transitions.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry) } : item)} /></label></div>}
                </div>;
              })}
            </div>
          </section>
          <section className="canvas-summary"><div><span>4</span><p>参考图片<br /><small>全部绑定给 Seedance</small></p></div><div><span>3</span><p>确认转场<br /><small>按画布顺序执行</small></p></div><div><span>15s</span><p>最终时长<br /><small>9:16 · 1080p</small></p></div><strong>顺序固定为已确认的叙事时间轴；如需换内容，请返回新建任务，避免旧素材静默污染。</strong></section>
          <DecisionBar message={message} disabled={submitting || !allImagesAvailable} detail={allImagesAvailable ? "确认后将立即编译4张参考图并提交 Seedance 2.0" : "4张图片必须全部成功加载，才能提交视频"} label={submitting ? "正在锁定画布" : "确认画布，开始生成视频 →"} onClick={confirmCanvas} />
        </>
      )}
    </main>
  );
}

function EditableArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="editable-area"><span>{label}</span><textarea rows={4} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ConstraintCard({ project }: { project: Project }) {
  return <div className="constraint-card"><span>LOCKED BRIEF</span><dl><div><dt>受众</dt><dd>{project.input.audience || "未填写"}</dd></div><div><dt>目标</dt><dd>{project.input.goal || "未填写"}</dd></div><div><dt>必须出现</dt><dd>{project.input.mustInclude || "无额外要求"}</dd></div><div><dt>禁止出现</dt><dd>{project.input.mustAvoid || "无额外要求"}</dd></div></dl></div>;
}

function ReviewPauseNote({ active = false }: { active?: boolean }) {
  return <div className={`review-pause-note ${active ? "active" : ""}`}><span>{active ? "LIVE" : "PAUSED"}</span><strong>{active ? "图片生成已启动" : "下游调用已暂停"}</strong><p>{active ? "生成失败会停止，不会进入画布或视频。" : "只有本页明确确认，任务才会继续。"}</p></div>;
}

function DecisionBar({ message, disabled, detail, label, onClick }: { message: string; disabled: boolean; detail: string; label: string; onClick: () => void }) {
  return <div className="decision-bar"><div><span>HUMAN APPROVAL REQUIRED</span><strong>{detail}</strong>{message && <p role="alert">{message}</p>}</div><button disabled={disabled} onClick={onClick}>{label}</button></div>;
}

function ReviewLoading({ label, error, onRetry }: { label: string; error?: string; onRetry: () => void }) {
  return <main className="review-shell review-loading"><div><span /><strong>{error || label}</strong><p>{error ? "任务没有继续执行，请重新连接或返回进度页查看。" : "正在恢复已保存的确认版本…"}</p>{error && <button onClick={onRetry}>重新连接</button>}</div></main>;
}
