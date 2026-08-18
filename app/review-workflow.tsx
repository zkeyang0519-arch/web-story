"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatVideoDimensions,
  segmentDurations,
  VIDEO_MODEL_PROFILES,
  type VideoFps,
  type VideoModelKey,
  type VideoRatio,
  type VideoResolution,
} from "@/lib/video-config";

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
  usable_material_descriptions?: string[];
  creative_opportunities?: string[];
  confidence?: number;
  duration_sec?: number;
  timeline_segments?: ReferenceTimelineSegment[];
};

type ReferenceTimelineSegment = {
  start_sec: number;
  end_sec: number;
  visual_details: string;
  subject_action: string;
  camera: string;
  lighting_and_color: string;
  audio: string;
  edit_transition: string;
  narrative_function: string;
  reusable_detail: string;
};

type Creative = {
  theme?: string;
  concept?: string;
  hook?: string;
  story_options?: CreativeStory[];
  selected_story_id?: string;
  story_arc?: string;
  shot_plan?: DenseShot[];
  visual_style?: string;
  audio_plan?: string;
  seedance_prompt?: string;
  quality_risks?: string[];
  source_trace?: Array<{
    source_index: number;
    source_description: string;
    adopted_elements: string[];
    creative_transformation: string;
    story_usage: string;
  }>;
  assets?: CreativeAsset[];
  writing_trace?: {
    method: "great-writer.creative-writing.v1";
    research_summary: string;
    core_statement: string;
    stress_test: string;
    outline: string;
    self_check: string[];
  };
};

type CreativeStory = { id: string; title: string; setup: string; turn: string; payoff: string };
type DenseShot = { order: number; start_ms: number; end_ms: number; scene: string; action: string; camera: string; audio: string; source_indices: number[] };
type AssetCategory = "person" | "animal" | "product" | "object" | "environment" | "wardrobe" | "other";
type CreativeAsset = {
  id: string;
  category: AssetCategory;
  name: string;
  narrative_role: string;
  description: string;
  continuity_notes: string;
};
type AssetCard = CreativeAsset & { prompt: string };

type Frame = {
  id: string;
  order: number;
  time_range: string;
  title: string;
  narrative_goal: string;
  prompt: string;
  motion: string;
};

type ImagePlan = {
  continuity_anchor: string;
  asset_cards: AssetCard[];
  overview: { title: string; logline: string; story: string; visual_direction: string; asset_relationships: string; cinematic_script: string };
  frames: Frame[];
  confirmation?: { asset_ids: string[]; overview_confirmed: true; confirmed_at: string };
};
type AssetImage = { assetId: string; order: number; url?: string | null; model?: string | null; size?: string | null };
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
  assetImages?: AssetImage[];
  storyboardImages?: StoryboardImage[];
  input: {
    goal?: string;
    audience?: string;
    platform?: string;
    style?: string;
    mustInclude?: string;
    mustAvoid?: string;
    references?: unknown[];
    duration?: number;
    ratio?: VideoRatio;
    resolution?: VideoResolution;
    fps?: VideoFps;
    videoModel?: VideoModelKey;
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

const assetCategoryLabels: Record<AssetCategory, string> = {
  person: "人物",
  animal: "动物",
  product: "产品",
  object: "物品",
  environment: "环境",
  wardrobe: "服装 / 妆发",
  other: "其他必要资产",
};

const assetCategories = Object.keys(assetCategoryLabels) as AssetCategory[];

const videoProgressPhases = [
  "planning_video_segments",
  "submitting_video",
  "polling_video",
  "reviewing_video",
  "assembling_video",
];

function formatTimelineTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function nextReviewRoute(project: Project) {
  if (project.pipelinePhase === "awaiting_creative_review") return `/projects/${project.id}/creative-review`;
  if (["planning_images", "awaiting_image_plan", "generating_asset_images", "awaiting_asset_image_review", "planning_storyboard", "generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/creative-card`;
  if (project.pipelinePhase === "awaiting_canvas_review") return `/projects/${project.id}/canvas`;
  return null;
}

export function ReviewWorkflow({ view, projectId }: { view: ReviewView; projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [creative, setCreative] = useState<Creative>({});
  const [imagePlan, setImagePlan] = useState<ImagePlan | null>(null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [loadedAssetIds, setLoadedAssetIds] = useState<Set<string>>(() => new Set());
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(() => new Set());
  const [loadedFrameIds, setLoadedFrameIds] = useState<Set<string>>(() => new Set());
  const [failedFrameIds, setFailedFrameIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmedAssetIds, setConfirmedAssetIds] = useState<Set<string>>(() => new Set());
  const [overviewConfirmed, setOverviewConfirmed] = useState(false);
  const [storyFeedback, setStoryFeedback] = useState<Record<string, string>>({});
  const [creativeAssetFeedback, setCreativeAssetFeedback] = useState<Record<string, string>>({});
  const [regeneratingCreativeItem, setRegeneratingCreativeItem] = useState<string | null>(null);
  const [assetFeedback, setAssetFeedback] = useState<Record<string, string>>({});
  const [regeneratingAssetId, setRegeneratingAssetId] = useState<string | null>(null);
  const [overviewFeedback, setOverviewFeedback] = useState("");
  const [regeneratingOverview, setRegeneratingOverview] = useState(false);
  const initializedRevision = useRef<number | null>(null);
  const pollInFlight = useRef(false);

  const hydrateEditors = useCallback((loaded: Project) => {
    const revision = loaded.reviewRevision ?? 0;
    if (initializedRevision.current === revision) return;
    initializedRevision.current = revision;
    if (loaded.review?.analyses) setAnalyses(loaded.review.analyses);
    if (loaded.review?.creative) {
      const loadedCreative = loaded.review.creative;
      const selectedStory = (loadedCreative.story_options ?? []).find((story) => story.id === loadedCreative.selected_story_id) ?? loadedCreative.story_options?.[0];
      setCreative({
        ...loadedCreative,
        story_options: selectedStory ? [selectedStory] : [],
        selected_story_id: selectedStory?.id,
      });
    }
    if (loaded.review?.imagePlan) {
      setImagePlan(loaded.review.imagePlan);
      setConfirmedAssetIds(new Set(loaded.review.imagePlan.confirmation?.asset_ids ?? []));
      setOverviewConfirmed(loaded.review.imagePlan.confirmation?.overview_confirmed === true);
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
    if (["failed", "cancelled", "needs_action"].includes(loaded.status)) {
      router.replace(`/projects/${loaded.id}/progress`);
      return loaded;
    }
    if (loaded.status === "completed") {
      router.replace(`/projects/${loaded.id}/delivery`);
      return loaded;
    }
    if (videoProgressPhases.includes(loaded.pipelinePhase ?? "")) {
      router.replace(`/projects/${loaded.id}/progress`);
      return loaded;
    }
    const activeCreativeCardWork = view === "images"
      && ["generating_assets", "quality_checking"].includes(loaded.status)
      && ["planning_images", "generating_asset_images", "planning_storyboard", "generating_images", "reviewing_images"].includes(loaded.pipelinePhase ?? "");
    if (loaded.status !== "awaiting_review" && !activeCreativeCardWork) {
      router.replace(`/projects/${loaded.id}/progress`);
      return loaded;
    }
    const destination = nextReviewRoute(loaded);
    const currentPath = view === "creative" ? "creative-review" : view === "images" ? "creative-card" : "canvas";
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
    if (view !== "images"
      || !["generating_assets", "quality_checking"].includes(project?.status ?? "")
      || !["planning_images", "generating_asset_images", "planning_storyboard", "generating_images", "reviewing_images"].includes(project?.pipelinePhase ?? "")) return;
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
  }, [load, project?.pipelinePhase, project?.status, router, view]);

  async function approve(gate: "creative" | "image_plan" | "asset_images" | "canvas", payload: unknown) {
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

  function updateStory(index: number, field: keyof CreativeStory, value: string) {
    setCreative((item) => {
      const stories = (item.story_options ?? []).map((story, storyIndex) => storyIndex === index ? { ...story, [field]: value } : story);
      const selected = stories.find((story) => story.id === item.selected_story_id);
      return {
        ...item,
        story_options: stories,
        ...(selected && field !== "title" ? { story_arc: `${selected.setup} → ${selected.turn} → ${selected.payoff}` } : {}),
      };
    });
  }

  function updateReferenceTimeline(analysisIndex: number, segmentIndex: number, field: keyof Omit<ReferenceTimelineSegment, "start_sec" | "end_sec">, value: string) {
    setAnalyses((items) => items.map((analysis, currentAnalysisIndex) => currentAnalysisIndex === analysisIndex ? {
      ...analysis,
      timeline_segments: (analysis.timeline_segments ?? []).map((segment, currentSegmentIndex) => currentSegmentIndex === segmentIndex ? { ...segment, [field]: value } : segment),
    } : analysis));
  }

  async function regenerateCreativeReviewItem(kind: "story" | "asset", index: number) {
    const item = kind === "story" ? creative.story_options?.[index] : creative.assets?.[index];
    const feedback = item ? (kind === "story" ? storyFeedback[item.id] : creativeAssetFeedback[item.id])?.trim() ?? "" : "";
    if (!project || project.reviewRevision == null || !item) return;
    if (feedback.length < 2) {
      setMessage(`请先填写至少2个字的${kind === "story" ? "故事" : "资产"}修改意见`);
      return;
    }
    const loadingKey = `${kind}:${item.id}`;
    setRegeneratingCreativeItem(loadingKey);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/revise-creative-item`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, itemId: item.id, feedback, revision: project.reviewRevision, draftCreative: creative, draftAnalyses: analyses }),
      });
      const data = await response.json().catch(() => null) as { item?: CreativeStory | CreativeAsset; revision?: number; error?: string } | null;
      if (!response.ok || !data?.item) throw new Error(data?.error ?? `${kind === "story" ? "故事" : "资产"}重新生成失败`);
      if (kind === "story") {
        const revisedStory = data.item as CreativeStory;
        setCreative((current) => {
          const stories = (current.story_options ?? []).map((story) => story.id === item.id ? revisedStory : story);
          const selected = stories.find((story) => story.id === current.selected_story_id);
          return { ...current, story_options: stories, ...(selected?.id === item.id ? { story_arc: `${selected.setup} → ${selected.turn} → ${selected.payoff}` } : {}) };
        });
        setStoryFeedback((items) => ({ ...items, [item.id]: "" }));
      } else {
        const revisedAsset = data.item as CreativeAsset;
        setCreative((current) => ({ ...current, assets: (current.assets ?? []).map((asset) => asset.id === item.id ? revisedAsset : asset) }));
        setCreativeAssetFeedback((items) => ({ ...items, [item.id]: "" }));
      }
      setDirty(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创意内容重新生成失败");
    } finally {
      setRegeneratingCreativeItem(null);
    }
  }

  function updateAssetCard(index: number, patch: Partial<AssetCard>) {
    const id = imagePlan?.asset_cards[index]?.id;
    setDirty(true);
    setOverviewConfirmed(false);
    if (id) setConfirmedAssetIds((items) => { const next = new Set(items); next.delete(id); return next; });
    setImagePlan((plan) => plan ? { ...plan, asset_cards: plan.asset_cards.map((asset, assetIndex) => assetIndex === index ? { ...asset, ...patch } : asset) } : plan);
  }

  async function regenerateAssetDescription(index: number) {
    const asset = imagePlan?.asset_cards[index];
    const feedback = asset ? assetFeedback[asset.id]?.trim() ?? "" : "";
    if (!project || project.reviewRevision == null || !asset) return;
    if (feedback.length < 2) {
      setMessage("请先填写至少2个字的资产修改意见");
      return;
    }
    setRegeneratingAssetId(asset.id);
    setMessage("");
    try {
      const regeneratingRealImage = project.pipelinePhase === "awaiting_asset_image_review";
      const response = await fetch(`/api/projects/${project.id}/${regeneratingRealImage ? "regenerate-asset-image" : "revise-asset"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: asset.id, feedback, revision: project.reviewRevision, draftImagePlan: imagePlan }),
      });
      const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      if (!response.ok || !data?.project) throw new Error(data?.error ?? (regeneratingRealImage ? "真实资产图重新生成失败" : "资产描述重新生成失败"));
      if (regeneratingRealImage) {
        setLoadedAssetIds((items) => { const next = new Set(items); next.delete(asset.id); return next; });
        setFailedAssetIds((items) => { const next = new Set(items); next.delete(asset.id); return next; });
      }
      initializedRevision.current = null;
      setProject(data.project);
      hydrateEditors(data.project);
      setAssetFeedback((items) => ({ ...items, [asset.id]: "" }));
      setOverviewConfirmed(false);
      setDirty(false);
      if (regeneratingRealImage) setMessage(`已根据意见修改“${asset.name}”并替换这一张真实资产图，请重新检查。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "资产描述重新生成失败");
    } finally {
      setRegeneratingAssetId(null);
    }
  }

  function updateOverview(patch: Partial<ImagePlan["overview"]>) {
    setDirty(true);
    setOverviewConfirmed(false);
    setImagePlan((plan) => plan ? { ...plan, overview: { ...plan.overview, ...patch } } : plan);
  }

  async function regenerateOverview() {
    const feedback = overviewFeedback.trim();
    if (!project || project.reviewRevision == null || !imagePlan) return;
    if (feedback.length < 2) {
      setMessage("请先填写至少2个字的总览修改意见");
      return;
    }
    setRegeneratingOverview(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/revise-overview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedback, revision: project.reviewRevision }),
      });
      const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      const nextPlan = data?.project?.review?.imagePlan;
      if (!response.ok || !data?.project || !nextPlan) throw new Error(data?.error ?? "创意素材总览重新生成失败");
      setProject(data.project);
      setImagePlan(nextPlan);
      initializedRevision.current = data.project.reviewRevision ?? null;
      setLoadedAssetIds(new Set());
      setFailedAssetIds(new Set());
      setOverviewFeedback("");
      setOverviewConfirmed(false);
      setDirty(false);
      setMessage("AI 已根据意见重写总览与电影级视频脚本，请检查后重新确认。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创意素材总览重新生成失败");
    } finally {
      setRegeneratingOverview(false);
    }
  }

  async function confirmCreative() {
    setSubmitting(true); setMessage("");
    try {
      const stories = creative.story_options ?? [];
      const confirmedStory = stories.find((story) => story.id === creative.selected_story_id) ?? stories[0];
      if (!analyses.length || !creative.theme?.trim() || !creative.concept?.trim() || !creative.hook?.trim() || !creative.story_arc?.trim()) throw new Error("请完整确认参考解析、主题、创意、开场钩子和故事结构");
      if (!confirmedStory || !confirmedStory.title.trim() || !confirmedStory.setup.trim() || !confirmedStory.turn.trim() || !confirmedStory.payoff.trim()) throw new Error("请完整填写并确认这篇 Great Writer 创意故事");
      const storyOnlyCreative = {
        ...creative,
        story_options: [confirmedStory],
        selected_story_id: confirmedStory.id,
        story_arc: `${confirmedStory.setup} → ${confirmedStory.turn} → ${confirmedStory.payoff}`,
        shot_plan: undefined,
        assets: undefined,
      };
      const updated = await approve("creative", { analyses, creative: storyOnlyCreative });
      router.push(`/projects/${updated.id}/creative-card`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "创意确认失败"); }
    finally { setSubmitting(false); }
  }

  async function confirmImagePlan() {
    setSubmitting(true); setMessage("");
    try {
      if (!imagePlan || imagePlan.frames.length !== 4 || imagePlan.frames.some((frame) => !frame.prompt.trim() || !frame.motion.trim())) throw new Error("四幕视觉锚点的提示词和运动说明都必须填写");
      if (imagePlan.asset_cards.some((asset) => !asset.name.trim() || !asset.narrative_role.trim() || !asset.description.trim() || !asset.continuity_notes.trim() || !asset.prompt.trim())) throw new Error("每项资产的名称、用途、特征、一致性和提示词都必须填写");
      if (confirmedAssetIds.size !== imagePlan.asset_cards.length) throw new Error("请逐项确认所有资产卡");
      if (!overviewConfirmed || Object.values(imagePlan.overview).some((value) => !value.trim())) throw new Error("请完整检查并确认创意素材总览");
      await approve("image_plan", {
        ...imagePlan,
        confirmed_asset_ids: imagePlan.asset_cards.map((asset) => asset.id),
        overview_confirmed: true,
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : "创意卡确认失败"); }
    finally { setSubmitting(false); }
  }

  async function confirmAssetImages() {
    setSubmitting(true); setMessage("");
    try {
      if (!imagePlan || !project?.assetImages || project.assetImages.length !== imagePlan.asset_cards.length) throw new Error("真实资产图尚未准备完整");
      if (failedAssetIds.size > 0 || loadedAssetIds.size !== imagePlan.asset_cards.length) throw new Error("请等待全部真实资产图成功加载后再确认");
      if (!imagePlan.continuity_anchor.trim() || imagePlan.asset_cards.some((asset) => !asset.name.trim() || !asset.narrative_role.trim() || !asset.description.trim() || !asset.continuity_notes.trim() || !asset.prompt.trim())) throw new Error("请完整填写连续性和每项资产的全部文字字段");
      if (Object.values(imagePlan.overview).some((value) => !value.trim())) throw new Error("请完整填写创意素材总览与电影级视频脚本");
      await approve("asset_images", {
        confirmed_asset_image_ids: imagePlan.asset_cards.map((asset) => asset.id),
        image_plan: imagePlan,
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : "真实资产图确认失败"); }
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

  if (!project) return <ReviewLoading label={view === "creative" ? "正在载入 Great Writer 创意故事" : view === "images" ? "正在载入视频脚本与资产" : "正在载入分镜画布"} error={message} onRetry={() => { setMessage(""); load().catch((error) => setMessage(error instanceof Error ? error.message : "任务读取失败")); }} />;
  const step = view === "creative" ? 1 : view === "images" ? 2 : 3;
  const planningCreativeCard = view === "images" && project.pipelinePhase === "planning_images";
  const generatingAssetImages = view === "images" && project.pipelinePhase === "generating_asset_images";
  const awaitingAssetImageReview = view === "images" && project.pipelinePhase === "awaiting_asset_image_review";
  const planningStoryboard = view === "images" && project.pipelinePhase === "planning_storyboard";
  const generatingImages = view === "images" && ["generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "");
  const imagesReady = view === "images" && project.pipelinePhase === "awaiting_canvas_review";
  const creativeCardLocked = generatingAssetImages || awaitingAssetImageReview || planningStoryboard || generatingImages || imagesReady;
  const assetTextFieldsLocked = generatingAssetImages || planningStoryboard || generatingImages || imagesReady;
  const overviewCanRevise = view === "images" && ["awaiting_image_plan", "awaiting_asset_image_review"].includes(project.pipelinePhase ?? "");
  const assetImageById = new Map((project.assetImages ?? []).map((image) => [image.assetId, image]));
  const allAssetImagesAvailable = Boolean(imagePlan)
    && (project.assetImages?.length ?? 0) === imagePlan!.asset_cards.length
    && project.assetImages!.every((image) => Boolean(image.url))
    && loadedAssetIds.size === imagePlan!.asset_cards.length
    && failedAssetIds.size === 0;
  const imageByFrame = new Map((project.storyboardImages ?? []).map((image) => [image.frameId, image]));
  const storyboardImagesArchived = (project.storyboardImages?.length ?? 0) === 4 && project.storyboardImages!.every((image) => Boolean(image.url));
  const allImagesAvailable = (project.storyboardImages?.length ?? 0) === 4 && project.storyboardImages!.every((image) => Boolean(image.url)) && loadedFrameIds.size === 4 && failedFrameIds.size === 0;
  const selectedStory = (creative.story_options ?? []).find((story) => story.id === creative.selected_story_id) ?? creative.story_options?.[0];
  const confirmedAssetCount = imagePlan ? imagePlan.asset_cards.filter((asset) => confirmedAssetIds.has(asset.id)).length : 0;
  const totalDuration = Number.isInteger(project.input.duration) && Number(project.input.duration) >= 4 && Number(project.input.duration) <= 120
    ? Number(project.input.duration)
    : 15;
  const videoRatio = project.input.ratio ?? "9:16";
  const videoResolution = project.input.resolution ?? "1080p";
  const videoFps = project.input.fps ?? 24;
  const videoModel = project.input.videoModel ?? "seedance-2.0-standard";
  const videoModelLabel = VIDEO_MODEL_PROFILES[videoModel].label;
  const segmentCount = segmentDurations(totalDuration).length;
  const previewAspectRatio = videoRatio.replace(":", " / ");
  const outputDimensions = formatVideoDimensions(videoRatio, videoResolution);
  const assetStageCopy = imagesReady
    ? { lead: "四幕锚点已经生成。", emphasis: "下一步进入画布检查。", detail: `真实资产图保留在原卡片位置；四幕视觉锚点已归档，画布确认后 AI 会拆成 ${segmentCount} 段。` }
    : generatingImages
      ? { lead: "真实资产已经确认。", emphasis: "正在生成四幕锚点。", detail: `Seedream 正在根据下方真实资产图、确认文本与总览生成覆盖 ${totalDuration} 秒故事的四张视觉锚点。` }
      : planningStoryboard
        ? { lead: "真实资产已经确认。", emphasis: "正在重排四幕故事。", detail: `系统只使用最终资产图、资产卡与总览，为完整 ${totalDuration} 秒故事重新编写四幕视觉锚点。` }
        : awaitingAssetImageReview
          ? { lead: "真实资产图已经生成。", emphasis: "占位图已原位替换。", detail: "卡片字段和排版保持不变；请逐项检查真实图片，确认后才会规划四幕分镜。" }
          : generatingAssetImages
            ? { lead: "创意卡已经锁定。", emphasis: "正在逐项生成真实资产。", detail: `Seedream 正按资产 ID 生成 ${imagePlan?.asset_cards.length ?? 0} 张单项资产图，完成后会直接替换下方对应占位图。` }
            : { lead: "先确认每一份资产，", emphasis: "再让它们成为真实图片。", detail: "每个占位框代表一项必要资产；修改意见框位于资产描述与重新生成按钮之间。" };

  return (
    <main className="review-shell" onChange={() => setDirty(true)}>
      <header className="review-topbar"><div className="review-brand"><span><i /><i /></span><strong>镜流</strong><em>JINGLIU</em></div><div className="review-project"><span>制作任务</span><strong>{project.title}</strong></div><button onClick={() => { if (!dirty || window.confirm("当前修改尚未确认，离开后会丢失。确定查看进程吗？")) router.push(`/projects/${project.id}/progress`); }}>查看进程</button></header>
      <nav className="review-track" aria-label="制作确认步骤">
        {["创意故事", "视频脚本与资产", "分镜画布", "视频生成"].map((label, index) => <div className={index + 1 < step ? "done" : index + 1 === step ? "active" : "pending"} key={label}><span>{index + 1 < step ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><i /></div>)}
      </nav>

      {view === "creative" && (
        <>
          <section className="review-hero"><div><p>CHECKPOINT 01 / GREAT WRITER STORY</p><h1>先把参考变成故事，<br /><em>确认后再写视频脚本。</em></h1><span>参考视频逐条分析保持不变；下方只展示一篇可修改的原创故事，不会提前生成镜头和资产。</span></div><ReviewPauseNote /></section>
          <section className="creative-review-stack">
            <section className="creative-stage reference-stage" data-review-order="reference-analysis">
              <div className="review-section-head numbered"><b>01</b><div><span>REFERENCE READS</span><h2>原参考视频解析</h2><p>每一项都来自真实画面与声音；有偏差可直接修改。</p></div></div>
              <div className="analysis-stack">
                {analyses.map((analysis, index) => <article className="analysis-paper" key={`${analysis.source_index ?? index}`}>
                  <div className="paper-head"><span>REF {String(index + 1).padStart(2, "0")}</span><strong>{analysis.source_name ?? `参考视频 ${index + 1}`}</strong><small>置信度 {Math.round(Number(analysis.confidence ?? 0) * 100)}%</small></div>
                  <EditableArea label="视频内容摘要" value={String(analysis.summary ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, summary: value } : item))} />
                  <div className="two-second-analysis">
                    <div className="two-second-head"><div><span>2-SECOND TIMELINE</span><strong>每两秒画面与声音细节</strong></div><small>{analysis.timeline_segments?.length ?? 0} 个连续时间窗 · 共 {Number(analysis.duration_sec ?? 0).toFixed(1)} 秒</small></div>
                    <div className="two-second-grid">{(analysis.timeline_segments ?? []).map((segment, segmentIndex) => <article key={`${segment.start_sec}-${segment.end_sec}-${segmentIndex}`}>
                      <b>{segment.start_sec.toFixed(1)}—{segment.end_sec.toFixed(1)}s</b>
                      <EditableArea label="画面、空间与可见细节" value={segment.visual_details} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "visual_details", value)} />
                      <EditableArea label="主体动作与状态变化" value={segment.subject_action} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "subject_action", value)} />
                      <EditableArea label="景别、机位、运镜与焦点" value={segment.camera} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "camera", value)} />
                      <EditableArea label="光线与色彩" value={segment.lighting_and_color} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "lighting_and_color", value)} />
                      <EditableArea label="声音、音乐或对白" value={segment.audio} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "audio", value)} />
                      <EditableArea label="进入与离开该段的剪辑" value={segment.edit_transition} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "edit_transition", value)} />
                      <EditableArea label="叙事作用" value={segment.narrative_function} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "narrative_function", value)} />
                      <EditableArea label="可迁移的具体细节" value={segment.reusable_detail} onChange={(value) => updateReferenceTimeline(index, segmentIndex, "reusable_detail", value)} />
                    </article>)}</div>
                  </div>
                  <EditableArea label="可用素材描述（每行一条）" value={(analysis.usable_material_descriptions ?? []).join("\n")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, usable_material_descriptions: value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean) } : item))} />
                  <div className="two-review-fields"><EditableArea label="开场钩子" value={String(analysis.hook ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, hook: value } : item))} /><EditableArea label="可迁移创意机制" value={String(analysis.creative_mechanism ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, creative_mechanism: value } : item))} /></div>
                  <div className="analysis-tags"><span>{analysis.visual_grammar || "待确认视觉语言"}</span><span>{analysis.pacing || "待确认节奏"}</span><span>{analysis.audio_design || "待确认声音"}</span></div>
                  <details className="analysis-details"><summary>展开并修改完整解析</summary><div className="two-review-fields"><EditableArea label="视觉语言" value={String(analysis.visual_grammar ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, visual_grammar: value } : item))} /><EditableArea label="镜头与运动" value={String(analysis.camera_and_motion ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, camera_and_motion: value } : item))} /><EditableArea label="节奏" value={String(analysis.pacing ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, pacing: value } : item))} /><EditableArea label="声音设计" value={String(analysis.audio_design ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, audio_design: value } : item))} /><EditableArea label="情绪曲线" value={String(analysis.emotion_curve ?? "")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, emotion_curve: value } : item))} /><EditableArea label="可产生新意的变形机会（每行一条）" value={(analysis.creative_opportunities ?? []).join("\n")} onChange={(value) => setAnalyses((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, creative_opportunities: value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean) } : item))} /></div></details>
                </article>)}
              </div>
            </section>

            <section className="creative-stage fusion-stage" data-review-order="great-writer-story">
              <div className="review-section-head numbered"><b>02</b><div><span>GREAT WRITER STORY</span><h2>创意故事生成与修改</h2><p>参考分析保持原样；Great Writer 已将可用材料重组成一篇约一章长度的原创故事。先在这里把故事改满意，再进入视频脚本阶段。</p></div></div>
              <div className="integration-trace-grid">
                {analyses.map((analysis, index) => {
                  const trace = creative.source_trace?.find((item) => item.source_index === Number(analysis.source_index ?? index + 1));
                  return <article key={`trace-${index}`}><span>REF {String(index + 1).padStart(2, "0")}</span><strong>{analysis.source_name ?? `参考视频 ${index + 1}`}</strong><p>{trace?.source_description || analysis.usable_material_descriptions?.[0] || analysis.creative_mechanism || "等待确认可用素材描述"}</p><div>{(trace?.adopted_elements ?? analysis.reusable_techniques ?? []).map((item) => <i key={item}>{item}</i>)}</div>{trace?.creative_transformation && <small>创意变形：{trace.creative_transformation}</small>}{trace?.story_usage && <small>落点：{trace.story_usage}</small>}</article>;
                })}
              </div>
              <div className="fusion-summary-editor">
                <label><span>整合主题</span><input value={creative.theme ?? ""} onChange={(event) => setCreative((item) => ({ ...item, theme: event.target.value }))} /></label>
                <EditableArea label="整合创意主句" value={creative.concept ?? ""} onChange={(value) => setCreative((item) => ({ ...item, concept: value }))} />
                <div className="two-review-fields"><EditableArea label="视频改编钩子" value={creative.hook ?? ""} onChange={(value) => setCreative((item) => ({ ...item, hook: value }))} /><EditableArea label="故事因果结构" value={creative.story_arc ?? ""} onChange={(value) => setCreative((item) => ({ ...item, story_arc: value }))} /></div>
              </div>
              <div className="story-option-grid great-writer-story-grid">
                {(creative.story_options ?? []).map((story, index) => {
                  return <article className="story-option selected great-writer-story-card" key={story.id}>
                    <div className="story-option-head"><span>STORY {String(index + 1).padStart(2, "0")} · GREAT WRITER</span><strong>唯一故事 · 可直接修改</strong></div>
                    <label className="story-title-field"><span>故事标题</span><input value={story.title} onChange={(event) => updateStory(index, "title", event.target.value)} /></label>
                    <EditableArea label="第一部分 · 场景、人物与欲望" value={story.setup} onChange={(value) => updateStory(index, "setup", value)} />
                    <EditableArea label="第二部分 · 阻力、选择与转折" value={story.turn} onChange={(value) => updateStory(index, "turn", value)} />
                    <EditableArea label="第三部分 · 结果、变化与余韵" value={story.payoff} onChange={(value) => updateStory(index, "payoff", value)} />
                    <div className="story-regeneration-editor">
                      <label><span>给 AI 的故事修改意见</span><textarea rows={4} maxLength={1000} value={storyFeedback[story.id] ?? ""} placeholder="例如：改成小猫视角；增加一次误会与反转；结尾不要直接展示产品，让产品通过行动结果自然出现。" onChange={(event) => setStoryFeedback((items) => ({ ...items, [story.id]: event.target.value }))} /></label>
                      <small>AI 会再次执行 Great Writer 的场景、因果、声音与去 AI 腔检查；此时仍只修改故事，不会提前生成镜头或资产。</small>
                    </div>
                    <button type="button" className="creative-item-regenerate-button" disabled={regeneratingCreativeItem !== null || submitting || (storyFeedback[story.id]?.trim().length ?? 0) < 2} aria-busy={regeneratingCreativeItem === `story:${story.id}`} onClick={() => void regenerateCreativeReviewItem("story", index)}>{regeneratingCreativeItem === `story:${story.id}` ? "正在按意见重新生成故事…" : "根据修改意见重新生成本故事"}</button>
                  </article>;
                })}
              </div>
              {creative.writing_trace && <details className="analysis-details great-writer-method"><summary>查看 Great Writer 创作依据</summary><div className="two-review-fields"><EditableArea label="素材研究摘要" value={creative.writing_trace.research_summary} readOnly /><EditableArea label="核心发现" value={creative.writing_trace.core_statement} readOnly /><EditableArea label="核心压力测试" value={creative.writing_trace.stress_test} readOnly /><EditableArea label="因果结构" value={creative.writing_trace.outline} readOnly /></div><div className="analysis-tags">{creative.writing_trace.self_check.map((item) => <span key={item}>✓ {item}</span>)}</div></details>}
              <div className="two-review-fields fusion-direction"><EditableArea label="视觉风格" value={creative.visual_style ?? ""} onChange={(value) => setCreative((item) => ({ ...item, visual_style: value }))} /><EditableArea label="声音方向" value={creative.audio_plan ?? ""} onChange={(value) => setCreative((item) => ({ ...item, audio_plan: value }))} /></div>
              <ConstraintCard project={project} />
            </section>
          </section>
          <DecisionBar message={message} disabled={submitting || !selectedStory} detail={`已解析 ${analyses.length} 个参考 · 当前故事“${selectedStory?.title || "待填写"}” · 确认后才会生成视频脚本`} label={submitting ? "正在锁定故事并生成脚本" : "确认故事，生成 AI 视频详细脚本 →"} onClick={confirmCreative} />
        </>
      )}

      {planningCreativeCard && !imagePlan && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 02 / VIDEO SCRIPT & ASSETS</p><h1>故事已经锁定，<br /><em>正在转换成详细视频脚本。</em></h1><span>系统会忠实保留确认稿，再补全时间轴、摄影、动作、声音、连续性和必要资产。</span></div><div className="review-pause-note active"><span>PLANNING</span><strong>正在生成视频脚本</strong><p>图片生成仍暂停；等你检查脚本与资产后才会继续。</p></div></section>
          <section className="creative-card-planning" aria-live="polite"><span /><div><strong>正在把确认故事改编为 AI 视频详细脚本</strong><p>同时按故事实际需要拆出人物、动物、物品、产品、环境和服装资产；完成后自动回填。</p></div></section>
        </>
      )}

      {view === "images" && imagePlan && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 02 / VIDEO SCRIPT & ASSETS</p><h1>{assetStageCopy.lead}<br /><em>{assetStageCopy.emphasis}</em></h1><span>{assetStageCopy.detail}</span></div>{generatingAssetImages ? <div className="review-pause-note active"><span>SEEDREAM</span><strong>正在逐项生成真实资产图</strong><p>图片将按资产 ID 回填，不会改变卡片顺序和字段布局。</p></div> : planningStoryboard ? <div className="review-pause-note active"><span>PLANNING</span><strong>正在重排确认稿四幕锚点</strong><p>只使用已经确认的真实资产世界与文本设定。</p></div> : <ReviewPauseNote active={generatingImages} />}</section>
          <section className="continuity-editor"><span>CONTINUITY BIBLE</span><label>所有资产共同保持<input value={imagePlan.continuity_anchor} readOnly={assetTextFieldsLocked} onChange={(event) => { setDirty(true); setOverviewConfirmed(false); setConfirmedAssetIds(new Set()); setImagePlan((plan) => plan ? { ...plan, continuity_anchor: event.target.value } : plan); }} /></label></section>
          <section className="asset-creative-card-section">
            <div className="review-section-head"><span>ASSET CREATIVE CARDS</span><h2>{awaitingAssetImageReview ? "真实资产与可编辑确认稿" : creativeCardLocked ? "真实资产与确认稿" : "逐项确认创意资产"}</h2><p>{awaitingAssetImageReview ? "所有文字字段仍可直接修改；涉及外观的改动建议使用单资产重新生成，让图片与文字保持一致。确认后当前编辑稿会进入四幕分镜。" : creativeCardLocked ? "真实图片只替换原占位框；资产描述、提示词与卡片排版保持原位。" : "检查资产描述，在修改意见框输入要求，再按需重新生成当前资产文本。"}</p></div>
            <div className="asset-prompt-grid">
              {imagePlan.asset_cards.map((asset, index) => {
                const confirmed = confirmedAssetIds.has(asset.id);
                const assetImage = assetImageById.get(asset.id);
                return <article className={`prompt-card asset-prompt-card ${confirmed ? "is-confirmed" : ""}`} key={asset.id}>
                  <div className="prompt-visual asset-placeholder-visual" style={{ aspectRatio: previewAspectRatio, minHeight: 0 }}>
                    {assetImage?.url ? <Image src={assetImage.url} alt={`真实资产 ${asset.name}`} fill sizes="(max-width: 700px) 90vw, 32vw" unoptimized onLoad={() => setLoadedAssetIds((items) => new Set(items).add(asset.id))} onError={() => { setFailedAssetIds((items) => new Set(items).add(asset.id)); setMessage(`资产“${asset.name}”图片加载失败，不能进入四幕规划`); }} /> : <div className="empty-frame asset-placeholder"><span>ASSET {String(index + 1).padStart(2, "0")} · {assetCategoryLabels[asset.category]}</span><strong>{asset.name}</strong><i>{generatingAssetImages ? "真实资产图生成中" : "资产占位图"}</i></div>}
                    <div className="frame-meta"><span>{assetCategoryLabels[asset.category]}</span><strong>{assetImage?.url ? "✓ 真实图已归档" : awaitingAssetImageReview ? "可修改" : creativeCardLocked ? "已锁定" : confirmed ? "✓ 已确认" : "待确认"}</strong></div>
                  </div>
                  <div className="prompt-copy">
                    <span>{assetCategoryLabels[asset.category]} · {asset.id}</span><strong>{asset.narrative_role}</strong>
                    <label>资产提示词<textarea rows={8} value={asset.prompt} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { prompt: event.target.value })} /></label>
                    <label>资产类别<select value={asset.category} disabled={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { category: event.target.value as AssetCategory })}>{assetCategories.map((category) => <option value={category} key={category}>{assetCategoryLabels[category]}</option>)}</select></label>
                    <label>资产名称<input value={asset.name} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { name: event.target.value })} /></label>
                    <label>叙事用途<textarea rows={3} value={asset.narrative_role} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { narrative_role: event.target.value })} /></label>
                    <label>关键外观与特征<textarea rows={4} value={asset.description} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { description: event.target.value })} /></label>
                    <label>一致性要求<textarea rows={3} value={asset.continuity_notes} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { continuity_notes: event.target.value })} /></label>
                    {(!creativeCardLocked || awaitingAssetImageReview) && <div className="asset-regeneration-editor">
                      <label>给 AI 的修改意见<textarea rows={3} maxLength={1000} value={assetFeedback[asset.id] ?? ""} placeholder="例如：把幼猫改成银渐层；宠物笼始终固定在画面左侧，不要新增第二个笼子。" onChange={(event) => setAssetFeedback((items) => ({ ...items, [asset.id]: event.target.value }))} /></label>
                      <small>{awaitingAssetImageReview ? "AI 会先按意见修改本资产的外观、一致性与提示词，再只替换这一张真实资产图；其他资产不会重新生成。" : "AI 会根据意见重新编写本资产的外观描述、一致性要求和生成提示词。"}</small>
                    </div>}
                    {(!creativeCardLocked || awaitingAssetImageReview) && <button type="button" className="asset-regenerate-button" disabled={regeneratingAssetId !== null || regeneratingOverview || submitting || (assetFeedback[asset.id]?.trim().length ?? 0) < 2} aria-busy={regeneratingAssetId === asset.id} onClick={() => void regenerateAssetDescription(index)}>{regeneratingAssetId === asset.id ? (awaitingAssetImageReview ? "正在修改并重新生成本资产图…" : "正在按意见重新生成…") : (awaitingAssetImageReview ? "根据修改意见重新生成本资产图片" : "根据修改意见重新生成资产描述")}</button>}
                    {!creativeCardLocked && <button type="button" className="asset-confirm-button" onClick={() => setConfirmedAssetIds((items) => { const next = new Set(items); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next; })}>{confirmed ? "✓ 本资产已确认" : "确认本资产"}</button>}
                  </div>
                </article>;
              })}
            </div>
          </section>

          <section className="creative-overview-editor" data-review-order="creative-overview">
            <div className="review-section-head"><span>VIDEO SCRIPT MASTER</span><h2>AI 视频详细脚本</h2><p>已确认故事在这里锁定展示；脚本阶段只把它转换成可执行的时间轴、摄影、动作、声音与连续性，不会悄悄改写故事。</p></div>
            <div className="overview-title-grid"><label><span>已确认故事标题</span><input value={imagePlan.overview.title} readOnly /></label><label><span>视频一句话梗概</span><input value={imagePlan.overview.logline} readOnly={assetTextFieldsLocked} onChange={(event) => updateOverview({ logline: event.target.value })} /></label></div>
            <EditableArea label="已确认故事（锁定）" value={imagePlan.overview.story} readOnly />
            <div className="two-review-fields"><EditableArea label="视觉、色彩与光线方向" value={imagePlan.overview.visual_direction} readOnly={assetTextFieldsLocked} onChange={(value) => updateOverview({ visual_direction: value })} /><EditableArea label="资产关系总述" value={imagePlan.overview.asset_relationships} readOnly={assetTextFieldsLocked} onChange={(value) => updateOverview({ asset_relationships: value })} /></div>
            <label className="cinematic-script-editor"><span>供 AI 生成视频的详细脚本</span><small>包含全局视觉圣经，以及四幕的空间、摄影、按秒动作、物理反馈、光色、声音与尾帧衔接；后续分镜和视频分段都会以此为导演执行依据。</small><textarea rows={22} value={imagePlan.overview.cinematic_script ?? ""} readOnly={assetTextFieldsLocked} onChange={(event) => updateOverview({ cinematic_script: event.target.value })} /></label>
            {overviewCanRevise && <div className="overview-regeneration-editor">
              <label>给 AI 的总览修改意见<textarea rows={4} maxLength={1000} value={overviewFeedback} placeholder="例如：整体改成雨夜黑色电影；让第三幕增加一次因果反转；固定人物从画面左向右移动；每幕补充50mm焦段、右侧主光和近中远三层声音。" onChange={(event) => setOverviewFeedback(event.target.value)} /></label>
              <small>{awaitingAssetImageReview ? "AI 会按意见重写视频化表达和详细脚本；已确认故事保持锁定。视觉方向变化会使当前真实资产图作废，需要重新确认生成。" : "AI 会重写视频梗概、视觉方向、资产关系和详细脚本，不会改动已确认故事或资产卡。"}</small>
              <button type="button" className="overview-regenerate-button" disabled={regeneratingOverview || regeneratingAssetId !== null || submitting || overviewFeedback.trim().length < 2} aria-busy={regeneratingOverview} onClick={() => void regenerateOverview()}>{regeneratingOverview ? "正在按意见重写视频脚本…" : "根据修改意见重新生成视频详细脚本"}</button>
            </div>}
            {!creativeCardLocked && <label className="overview-confirm"><input type="checkbox" checked={overviewConfirmed} onChange={(event) => setOverviewConfirmed(event.target.checked)} /><span aria-hidden="true">✓</span><p>我已检查详细视频脚本、资产关系与全局一致性，并确认脚本没有改写已锁定故事。</p></label>}
          </section>

          {!creativeCardLocked && <DecisionBar message={message} disabled={submitting || confirmedAssetCount !== imagePlan.asset_cards.length || !overviewConfirmed} detail={`已确认 ${confirmedAssetCount} / ${imagePlan.asset_cards.length} 项资产 · 总览${overviewConfirmed ? "已确认" : "待确认"}`} label={submitting ? "正在锁定创意卡" : `确认创意卡，生成 ${imagePlan.asset_cards.length} 张真实资产图 →`} onClick={confirmImagePlan} />}
          {awaitingAssetImageReview && <DecisionBar message={message} disabled={submitting || regeneratingAssetId !== null || !allAssetImagesAvailable} detail={regeneratingAssetId ? "正在根据意见替换一张真实资产图" : allAssetImagesAvailable ? `${imagePlan.asset_cards.length} 张真实资产图已逐项加载` : `正在验证真实资产图 ${loadedAssetIds.size} / ${imagePlan.asset_cards.length}`} label={submitting ? "正在确认真实资产" : "真实资产无误，规划四幕分镜 →"} onClick={confirmAssetImages} />}
          {imagesReady && <DecisionBar message={message} disabled={!storyboardImagesArchived} detail={storyboardImagesArchived ? `四幕视觉锚点已归档 · 将在画布页按原时间轴展示` : "正在验证四幕视觉锚点归档"} label="进入分镜画布检查四幕 →" onClick={() => router.push(`/projects/${project.id}/canvas`)} />}
          {(generatingAssetImages || planningStoryboard || generatingImages) && <div className="generation-dock" aria-live="polite"><span /><div><strong>{generatingAssetImages ? `Seedream 正在生成 ${imagePlan.asset_cards.length} 张真实资产图` : planningStoryboard ? "正在按最终真实资产重新规划四幕视觉锚点" : "Seedream 正在生成、质检并归档四幕视觉锚点"}</strong><p>{message || (generatingAssetImages ? "每张图片都按资产 ID 独立生成和归档；完成后只替换原卡片占位图。" : planningStoryboard ? `读取真实资产图、确认文本、总览与连续性，为完整 ${totalDuration} 秒故事重新规划四幕。` : "真实资产、总览和四幕规划已经锁定；失败会立即停止并显示具体错误。")}</p></div></div>}
        </>
      )}

      {view === "canvas" && imagePlan && canvas && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 03 / MOTION CANVAS</p><h1>把四幕锚点连成完整故事，<br /><em>确认后由 AI 拆段生成。</em></h1><span>这里锁定完整 {totalDuration} 秒故事的四幕顺序、动作与三处转场。确认后 AI 会规划 {segmentCount} 个视频片段，逐段生成并自动合成成片。</span></div><ReviewPauseNote /></section>
          <section className="canvas-board">
            <div className="canvas-ruler"><span>00:00</span><i /><span>{formatTimelineTime(totalDuration)}</span></div>
            <div className="canvas-sequence">
              {canvas.frames.map((canvasFrame, index) => {
                const frame = imagePlan.frames.find((item) => item.id === canvasFrame.frameId);
                const generated = imageByFrame.get(canvasFrame.frameId);
                return <div className="canvas-unit" key={canvasFrame.frameId}>
                  <article className="canvas-node"><div className="canvas-image" style={{ aspectRatio: previewAspectRatio, height: "auto" }}>{generated?.url ? <Image src={generated.url} alt={`画布视觉锚点 ${index + 1}`} fill sizes="(max-width: 820px) 70vw, 260px" unoptimized onLoad={() => setLoadedFrameIds((items) => new Set(items).add(canvasFrame.frameId))} onError={() => { setFailedFrameIds((items) => new Set(items).add(canvasFrame.frameId)); setMessage(`画布视觉锚点 ${index + 1} 图片加载失败，不能提交视频`); }} /> : <div className="missing-frame">图片未归档</div>}<span>ACT {String(index + 1).padStart(2, "0")}</span></div><div className="canvas-node-copy"><strong>{frame?.title}</strong><small>{frame?.time_range} · {frame?.narrative_goal}</small><label>动作与运镜<textarea rows={3} value={canvasFrame.motion} onChange={(event) => setCanvas((item) => item ? { ...item, frames: item.frames.map((entry, entryIndex) => entryIndex === index ? { ...entry, motion: event.target.value } : entry) } : item)} /></label></div></article>
                  {index < canvas.transitions.length && <div className="canvas-edge"><div><i /><span>→</span><i /></div><label>转场 {index + 1}<textarea rows={3} value={canvas.transitions[index].description} onChange={(event) => setCanvas((item) => item ? { ...item, transitions: item.transitions.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry) } : item)} /></label></div>}
                </div>;
              })}
            </div>
          </section>
          <section className="canvas-summary"><div><span>4</span><p>视觉锚点<br /><small>共同覆盖完整故事</small></p></div><div><span>{segmentCount}</span><p>AI 视频分段<br /><small>逐段生成后自动合成</small></p></div><div><span>{totalDuration}s</span><p>最终时长<br /><small>{videoRatio} · {outputDimensions} · {videoFps} fps</small></p></div><strong>{videoModelLabel} 将按已确认的完整故事时间轴规划 {segmentCount} 段视频；四幕锚点用于保持人物、物品与环境连续，不会被误当成四个固定视频片段。</strong></section>
          <DecisionBar message={message} disabled={submitting || !allImagesAvailable} detail={allImagesAvailable ? `${videoModelLabel} · ${videoRatio} · ${videoResolution} · ${videoFps} fps · 共 ${totalDuration} 秒` : "四幕视觉锚点必须全部成功加载，才能提交视频"} label={submitting ? "正在锁定四幕画布" : `确认四幕画布，AI拆成${segmentCount}段并自动合成 →`} onClick={confirmCanvas} />
        </>
      )}
    </main>
  );
}

function EditableArea({ label, value, readOnly = false, onChange }: { label: string; value: string; readOnly?: boolean; onChange: (value: string) => void }) {
  return <label className="editable-area"><span>{label}</span><textarea rows={4} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} /></label>;
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
