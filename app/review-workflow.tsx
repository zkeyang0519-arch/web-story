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
import { hasCompleteFourActScript } from "@/lib/visual-skills-prompt";

type Analysis = Record<string, unknown> & {
  source_index?: number;
  source_name?: string;
  summary?: string;
  usable_material_descriptions?: string[];
  creative_opportunities?: string[];
  confidence?: number;
  duration_sec?: number;
  creative_highlights?: ReferenceCreativeHighlight[];
};

type ReferenceCreativeHighlight = {
  id: string;
  type: "创意点" | "高光点";
  title: string;
  evidence: string;
  why_effective: string;
  transferable_core: string;
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

type AssetAssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

type ImagePlan = {
  continuity_anchor: string;
  asset_analysis?: {
    selection_summary: string;
    required_subjects: Array<{ asset_id: string; category: AssetCategory; name: string; why_needed: string; appearances: string }>;
    required_scenes: Array<{ asset_id: string; name: string; why_needed: string; visual_scope: string; embedded_details: string[] }>;
  };
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
    selectedHighlightIds?: string[];
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

function visibleAnalysisSummary(value: unknown) {
  const summary = String(value ?? "").trim();
  if (!summary.startsWith("{") && !summary.startsWith("[")) return summary;
  const match = summary.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (match) {
    try { return JSON.parse(`"${match[1]}"`) as string; } catch { /* use the safe fallback below */ }
  }
  return "参考视频已经完成高光提炼，请直接查看并勾选下方候选创意素材。";
}

function nextReviewRoute(project: Project) {
  if (["awaiting_inspiration_review", "awaiting_creative_review"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/creative-review`;
  if (["planning_images", "awaiting_image_plan", "generating_asset_images", "awaiting_asset_image_review", "planning_storyboard", "generating_images", "reviewing_images"].includes(project.pipelinePhase ?? "")) return `/projects/${project.id}/creative-card`;
  if (project.pipelinePhase === "awaiting_canvas_review") return `/projects/${project.id}/canvas`;
  return null;
}

export function ReviewWorkflow({ view, projectId }: { view: ReviewView; projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<Set<string>>(() => new Set());
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
  const [frameFeedback, setFrameFeedback] = useState<Record<string, string>>({});
  const [regeneratingFrameId, setRegeneratingFrameId] = useState<string | null>(null);
  const initializedRevision = useRef<number | null>(null);
  const pollInFlight = useRef(false);

  const hydrateEditors = useCallback((loaded: Project) => {
    const revision = loaded.reviewRevision ?? 0;
    if (initializedRevision.current === revision) return;
    initializedRevision.current = revision;
    if (loaded.review?.analyses) setAnalyses(loaded.review.analyses);
    setSelectedHighlightIds(new Set(loaded.review?.selectedHighlightIds ?? []));
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

  async function approve(gate: "inspiration" | "creative" | "image_plan" | "asset_images" | "canvas", payload: unknown) {
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

  function addAsset() {
    if (!imagePlan || imagePlan.asset_cards.length >= 12) return;
    const existingIds = new Set([
      ...imagePlan.asset_cards.map((asset) => asset.id),
      ...(project?.assetImages ?? []).map((image) => image.assetId),
    ]);
    let sequence = imagePlan.asset_cards.length + 1;
    let id = `asset_custom_${String(sequence).padStart(2, "0")}`;
    while (existingIds.has(id)) {
      sequence += 1;
      id = `asset_custom_${String(sequence).padStart(2, "0")}`;
    }
    const newAsset: AssetCard = {
      id,
      category: "object",
      name: "待命名资产",
      narrative_role: "补充当前故事所需的叙事资产",
      description: "请结合故事填写清晰可见的外观、材质、颜色、比例与状态。",
      continuity_notes: "在所有出现镜头中保持外观、比例、位置关系与状态一致。",
      prompt: "单项资产设定图，主体完整清晰，背景简洁，无文字，无水印，无多余物体。",
    };
    setImagePlan((plan) => plan ? { ...plan, asset_cards: [...plan.asset_cards, newAsset] } : plan);
    setOverviewConfirmed(false);
    setDirty(true);
    if (project?.pipelinePhase === "awaiting_asset_image_review") setMessage("已添加一项空白资产。请完善字段，然后在卡片底部生成这项新增资产的真实图片。");
    window.setTimeout(() => document.getElementById(`asset-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  function removeAsset(index: number) {
    const asset = imagePlan?.asset_cards[index];
    if (!asset || project?.pipelinePhase !== "awaiting_asset_image_review") return;
    if (imagePlan.asset_cards.length <= 2) {
      setMessage("至少需要保留 2 项资产，当前不能继续删除");
      return;
    }
    if (!window.confirm(`确定删除资产“${asset.name}”吗？\n\n它会从当前确认稿和后续分镜中移除。`)) return;

    setImagePlan((plan) => plan ? {
      ...plan,
      asset_cards: plan.asset_cards.filter((item) => item.id !== asset.id),
      asset_analysis: plan.asset_analysis ? {
        ...plan.asset_analysis,
        required_subjects: plan.asset_analysis.required_subjects.filter((item) => item.asset_id !== asset.id),
        required_scenes: plan.asset_analysis.required_scenes.filter((item) => item.asset_id !== asset.id),
      } : undefined,
      confirmation: undefined,
    } : plan);
    setConfirmedAssetIds((items) => { const next = new Set(items); next.delete(asset.id); return next; });
    setLoadedAssetIds((items) => { const next = new Set(items); next.delete(asset.id); return next; });
    setFailedAssetIds((items) => { const next = new Set(items); next.delete(asset.id); return next; });
    setAssetFeedback((items) => { const next = { ...items }; delete next[asset.id]; return next; });
    setOverviewConfirmed(false);
    setDirty(true);
    setMessage(`已从确认稿移除资产“${asset.name}”，确认后它不会进入四幕分镜。`);
  }

  async function regenerateAssetDescription(index: number) {
    const asset = imagePlan?.asset_cards[index];
    const feedback = asset ? assetFeedback[asset.id]?.trim() ?? "" : "";
    if (!project || project.reviewRevision == null || !asset) return;
    const regeneratingRealImage = project.pipelinePhase === "awaiting_asset_image_review";
    const generatingNewAssetImage = regeneratingRealImage && !project.assetImages?.some((image) => image.assetId === asset.id && image.url);
    if (!generatingNewAssetImage && feedback.length < 2) {
      setMessage("请先填写至少2个字的资产修改意见");
      return;
    }
    setRegeneratingAssetId(asset.id);
    setMessage("");
    try {
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
      if (generatingNewAssetImage) setMessage(`新增资产“${asset.name}”的真实图片已生成，请检查后继续确认。`);
      else if (regeneratingRealImage) setMessage(`已根据意见修改“${asset.name}”并替换这一张真实资产图，请重新检查。`);
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
      setMessage("AI 已根据意见重写 Visual Skills 总体提示词，请检查后重新确认。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创意素材总览重新生成失败");
    } finally {
      setRegeneratingOverview(false);
    }
  }

  async function confirmInspirations() {
    setSubmitting(true); setMessage("");
    try {
      if (!selectedHighlightIds.size) throw new Error("请至少勾选一个创意点或高光点");
      const updated = await approve("inspiration", { selected_highlight_ids: [...selectedHighlightIds] });
      router.push(`/projects/${updated.id}/progress`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "创意点选择确认失败"); }
    finally { setSubmitting(false); }
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
      if (!hasCompleteFourActScript(imagePlan.overview.cinematic_script)) throw new Error("总体提示词必须完整包含第一幕至第四幕，并保留每幕尾帧或切镜头衔接");
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
      if (!imagePlan || !project?.assetImages) throw new Error("真实资产图尚未准备完整");
      const requiredAssetIds = imagePlan.asset_cards.map((asset) => asset.id);
      const availableAssetIds = new Set(project.assetImages.filter((image) => Boolean(image.url)).map((image) => image.assetId));
      if (requiredAssetIds.some((id) => !availableAssetIds.has(id))) throw new Error("真实资产图尚未准备完整");
      if (requiredAssetIds.some((id) => failedAssetIds.has(id) || !loadedAssetIds.has(id))) throw new Error("请等待全部真实资产图成功加载后再确认");
      if (!imagePlan.continuity_anchor.trim() || imagePlan.asset_cards.some((asset) => !asset.name.trim() || !asset.narrative_role.trim() || !asset.description.trim() || !asset.continuity_notes.trim() || !asset.prompt.trim())) throw new Error("请完整填写连续性和每项资产的全部文字字段");
      if (Object.values(imagePlan.overview).some((value) => !value.trim())) throw new Error("请完整填写创意素材总览与总体提示词");
      if (!hasCompleteFourActScript(imagePlan.overview.cinematic_script)) throw new Error("总体提示词缺少完整四幕，不能进入分镜生成");
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
      if (!imagePlan || imagePlan.frames.some((frame) => !frame.prompt.trim())) throw new Error("每一幕的画面描述与生成提示词都必须填写");
      if (!hasCompleteFourActScript(imagePlan.overview.cinematic_script)) throw new Error("总体提示词缺少完整四幕，不能进入视频生成");
      if (!canvas || canvas.frames.some((frame) => !frame.motion.trim()) || canvas.transitions.some((transition) => !transition.description.trim())) throw new Error("每个镜头动作和每段转场都必须填写");
      const updated = await approve("canvas", { ...canvas, image_plan: imagePlan });
      router.push(`/projects/${updated.id}/progress`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "画布确认失败"); }
    finally { setSubmitting(false); }
  }

  async function regenerateStoryboardFrame(index: number) {
    const frame = imagePlan?.frames[index];
    const feedback = frame ? (frameFeedback[frame.id] ?? "").trim() : "";
    if (!project || project.reviewRevision == null || !imagePlan || !canvas || !frame) return;
    if (feedback.length < 2) {
      setMessage("请先填写至少2个字的本幕修改意见");
      return;
    }
    setRegeneratingFrameId(frame.id);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/regenerate-storyboard-frame`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          frameId: frame.id,
          feedback,
          revision: project.reviewRevision,
          draftImagePlan: imagePlan,
          draftCanvas: canvas,
        }),
      });
      const data = await response.json().catch(() => null) as { project?: Project; error?: string } | null;
      if (!response.ok || !data?.project) throw new Error(data?.error ?? `第${index + 1}幕重新生成失败`);
      setLoadedFrameIds((items) => { const next = new Set(items); next.delete(frame.id); return next; });
      setFailedFrameIds((items) => { const next = new Set(items); next.delete(frame.id); return next; });
      initializedRevision.current = null;
      setProject(data.project);
      hydrateEditors(data.project);
      setFrameFeedback((items) => ({ ...items, [frame.id]: "" }));
      setDirty(false);
      setMessage(`第${index + 1}幕已按意见重写并重新生成，其他三幕保持不变。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本幕重新生成失败");
    } finally {
      setRegeneratingFrameId(null);
    }
  }

  if (!project) return <ReviewLoading label={view === "creative" ? "正在载入 Great Writer 创意故事" : view === "images" ? "正在载入分镜、总体提示词与资产" : "正在载入分镜画布"} error={message} onRetry={() => { setMessage(""); load().catch((error) => setMessage(error instanceof Error ? error.message : "任务读取失败")); }} />;
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
  const currentAssetIds = new Set(imagePlan?.asset_cards.map((asset) => asset.id) ?? []);
  const loadedCurrentAssetCount = [...currentAssetIds].filter((id) => loadedAssetIds.has(id)).length;
  const allAssetImagesAvailable = Boolean(imagePlan)
    && imagePlan!.asset_cards.every((asset) => Boolean(assetImageById.get(asset.id)?.url))
    && imagePlan!.asset_cards.every((asset) => loadedAssetIds.has(asset.id) && !failedAssetIds.has(asset.id));
  const imageByFrame = new Map((project.storyboardImages ?? []).map((image) => [image.frameId, image]));
  const storyboardImagesArchived = (project.storyboardImages?.length ?? 0) === 4 && project.storyboardImages!.every((image) => Boolean(image.url));
  const allImagesAvailable = (project.storyboardImages?.length ?? 0) === 4 && project.storyboardImages!.every((image) => Boolean(image.url)) && loadedFrameIds.size === 4 && failedFrameIds.size === 0;
  const choosingInspirations = view === "creative" && project.pipelinePhase === "awaiting_inspiration_review";
  const availableHighlightCount = analyses.reduce((total, analysis) => total + (analysis.creative_highlights?.length ?? 0), 0);
  const selectedHighlightCount = analyses.reduce((total, analysis) => total + (analysis.creative_highlights ?? []).filter((item) => selectedHighlightIds.has(item.id)).length, 0);
  const selectedStory = (creative.story_options ?? []).find((story) => story.id === creative.selected_story_id) ?? creative.story_options?.[0];
  const confirmedAssetCount = imagePlan ? imagePlan.asset_cards.filter((asset) => confirmedAssetIds.has(asset.id)).length : 0;
  const cinematicScriptComplete = Boolean(imagePlan && hasCompleteFourActScript(imagePlan.overview.cinematic_script));
  const assetAnalysis = imagePlan ? resolveAssetAnalysis(imagePlan) : null;
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
        {["创意选择与故事", "分镜提示词与资产", "分镜画布", "视频生成"].map((label, index) => <div className={index + 1 < step ? "done" : index + 1 === step ? "active" : "pending"} key={label}><span>{index + 1 < step ? "✓" : String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><i /></div>)}
      </nav>

      {view === "creative" && choosingInspirations && (
        <>
          <section className="review-hero inspiration-review-hero"><div><p>CHECKPOINT 01 / PICK THE SPARKS</p><h1>先选真正有用的高光，<br /><em>再让 AI 融合新创意。</em></h1><span>每条参考只保留 2–3 个创意点或高光点；未勾选内容不会进入 Great Writer。</span></div><ReviewPauseNote /></section>
          <section className="creative-review-stack inspiration-review-stack">
            <section className="creative-stage inspiration-selection-stage">
              <div className="review-section-head numbered"><b>01</b><div><span>CREATIVE HIGHLIGHTS</span><h2>勾选要采用的创意素材</h2><p>每张卡片代表一个创意点或高光点，均来自可见或可听证据。可以跨视频组合，也可以只选最强的一项。</p></div></div>
              <div className="inspiration-source-list">
                {analyses.map((analysis, index) => <section className="inspiration-source" key={`${analysis.source_index ?? index}`}>
                  <header><div><span>REF {String(index + 1).padStart(2, "0")}</span><strong>{analysis.source_name ?? `参考视频 ${index + 1}`}</strong></div><small>{analysis.creative_highlights?.length ?? 0} 个候选 · 置信度 {Math.round(Number(analysis.confidence ?? 0) * 100)}%</small></header>
                  <p>{visibleAnalysisSummary(analysis.summary)}</p>
                  <div className="inspiration-choice-grid">
                    {(analysis.creative_highlights ?? []).map((item) => {
                      const checked = selectedHighlightIds.has(item.id);
                      return <label className={`inspiration-choice ${checked ? "selected" : ""}`} key={item.id}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedHighlightIds((items) => { const next = new Set(items); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />
                        <span className="inspiration-check" aria-hidden="true">{checked ? "✓" : "+"}</span>
                        <div><em>{item.type}</em><strong>{item.title}</strong><p><b>视频证据</b>{item.evidence}</p><p><b>有效原因</b>{item.why_effective}</p><p><b>可迁移核心</b>{item.transferable_core}</p></div>
                      </label>;
                    })}
                  </div>
                </section>)}
              </div>
            </section>
          </section>
          <DecisionBar message={message} disabled={submitting || selectedHighlightCount < 1} detail={`已选择 ${selectedHighlightCount} / ${availableHighlightCount} 个候选 · 未选内容不会进入融合`} label={submitting ? "正在提交选择" : "确认选择，生成全新创意 →"} onClick={confirmInspirations} />
        </>
      )}

      {view === "creative" && !choosingInspirations && (
        <>
          <section className="review-hero"><div><p>CHECKPOINT 02 / GREAT WRITER STORY</p><h1>已选高光正在成为故事，<br /><em>确认后再做分镜。</em></h1><span>下方只展示一篇依据已勾选内容生成的原创故事，不会采用未选候选，也不会提前生成镜头和资产。</span></div><ReviewPauseNote /></section>
          <section className="creative-review-stack">
            <section className="creative-stage reference-stage" data-review-order="reference-analysis">
              <div className="review-section-head numbered"><b>01</b><div><span>SELECTED SPARKS</span><h2>已选创意点与高光点</h2><p>Great Writer 只收到了这些已勾选内容；原视频不再按固定时间间隔拆解。</p></div></div>
              <div className="selected-inspiration-grid">
                {analyses.flatMap((analysis, index) => (analysis.creative_highlights ?? []).filter((item) => selectedHighlightIds.has(item.id)).map((item) => <article key={item.id}><span>REF {String(index + 1).padStart(2, "0")} · {item.type}</span><strong>{item.title}</strong><p>{item.evidence}</p><small>迁移方式：{item.transferable_core}</small></article>))}
                {!selectedHighlightCount && <article className="legacy-inspiration-note"><strong>历史任务参考摘要</strong><p>该任务创建于创意点勾选流程上线前，继续使用原有参考解析。</p></article>}
              </div>
            </section>

            <section className="creative-stage fusion-stage" data-review-order="great-writer-story">
              <div className="review-section-head numbered"><b>02</b><div><span>GREAT WRITER STORY</span><h2>全新创意故事生成与修改</h2><p>Great Writer 仅依据你勾选的创意点与高光点，重组成一篇约一章长度的原创故事。先把故事改满意，再进入 Visual Skills 分镜阶段。</p></div></div>
              <div className="integration-trace-grid">
                {analyses.filter((analysis) => !selectedHighlightIds.size || (analysis.creative_highlights ?? []).some((item) => selectedHighlightIds.has(item.id))).map((analysis, index) => {
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
          <DecisionBar message={message} disabled={submitting || !selectedStory} detail={`已解析 ${analyses.length} 个参考 · 当前故事“${selectedStory?.title || "待填写"}” · 确认后才会启动 Visual Skills 分镜`} label={submitting ? "正在锁定故事并生成分镜" : "确认故事，生成分镜与总体提示词 →"} onClick={confirmCreative} />
        </>
      )}

      {planningCreativeCard && !imagePlan && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 02 / VISUAL SKILLS STORYBOARD</p><h1>故事已经锁定，<br /><em>正在转换成四幕分镜。</em></h1><span>Visual Skills 会先拆分镜，再把镜头提示词、动作、声音和连续性汇总成总体提示词。</span></div><div className="review-pause-note active"><span>VISUAL SKILLS</span><strong>正在生成分镜与总体提示词</strong><p>图片生成仍暂停；等你检查提示词与资产后才会继续。</p></div></section>
          <section className="creative-card-planning" aria-live="polite"><span /><div><strong>正在判断资产并拆解四幕分镜</strong><p>每幕都会生成提示词并自动写入“总体提示词”；场景内普通细节继续并入环境资产。</p></div></section>
        </>
      )}

      {view === "images" && imagePlan && (
        <>
          <section className="review-hero compact"><div><p>CHECKPOINT 02 / VIDEO SCRIPT & ASSETS</p><h1>{assetStageCopy.lead}<br /><em>{assetStageCopy.emphasis}</em></h1><span>{assetStageCopy.detail}</span></div>{generatingAssetImages ? <div className="review-pause-note active"><span>SEEDREAM</span><strong>正在逐项生成真实资产图</strong><p>图片将按资产 ID 回填，不会改变卡片顺序和字段布局。</p></div> : planningStoryboard ? <div className="review-pause-note active"><span>PLANNING</span><strong>正在重排确认稿四幕锚点</strong><p>只使用已经确认的真实资产世界与文本设定。</p></div> : <ReviewPauseNote active={generatingImages} />}</section>
          {assetAnalysis && <section className="asset-needs-analysis">
            <div className="asset-analysis-head"><div><span>AI ASSET REQUIREMENT ANALYSIS</span><h2>先判断需要生成什么资产</h2><p>{assetAnalysis.selection_summary}</p></div><strong>{assetAnalysis.required_subjects.length}<small>独立主体</small><i>＋</i>{assetAnalysis.required_scenes.length}<small>完整场景</small></strong></div>
            <div className="asset-analysis-columns">
              <div className="asset-analysis-group"><div className="asset-analysis-group-head"><span>01</span><div><strong>需要独立生成的主体</strong><small>人物、动物、产品及推动因果的关键物品逐一拆分</small></div></div><div className="asset-analysis-list">{assetAnalysis.required_subjects.map((item, index) => <article key={item.asset_id}><div><span>{String(index + 1).padStart(2, "0")} · {assetCategoryLabels[item.category]}</span><strong>{item.name}</strong></div><p>{item.why_needed}</p><small>出现范围：{item.appearances}</small></article>)}</div></div>
              <div className="asset-analysis-group scenes"><div className="asset-analysis-group-head"><span>02</span><div><strong>需要整体生成的场景</strong><small>每个独立空间一张场景资产，内部小细节直接合并</small></div></div><div className="asset-analysis-list">{assetAnalysis.required_scenes.length ? assetAnalysis.required_scenes.map((item, index) => <article key={item.asset_id}><div><span>{String(index + 1).padStart(2, "0")} · 环境</span><strong>{item.name}</strong></div><p>{item.why_needed}</p><small>整体范围：{item.visual_scope}</small><div className="embedded-detail-list"><b>并入场景，不单独生成</b>{item.embedded_details.map((detail) => <i key={detail}>{detail}</i>)}</div></article>) : <div className="asset-analysis-empty">当前故事未识别到需要独立锁定的完整场景，请在下方补充环境资产。</div>}</div></div>
            </div>
          </section>}
          <section className="continuity-editor"><span>CONTINUITY BIBLE</span><label>所有资产共同保持<input value={imagePlan.continuity_anchor} readOnly={assetTextFieldsLocked} onChange={(event) => { setDirty(true); setOverviewConfirmed(false); setConfirmedAssetIds(new Set()); setImagePlan((plan) => plan ? { ...plan, continuity_anchor: event.target.value } : plan); }} /></label></section>
          <div className="asset-review-layout">
            <section className="asset-creative-card-section">
              <div className="asset-section-toolbar">
                <div className="review-section-head"><span>ASSET CREATIVE CARDS</span><h2>{awaitingAssetImageReview ? "真实资产与可编辑确认稿" : creativeCardLocked ? "真实资产与确认稿" : "逐项确认创意资产"}</h2><p>{awaitingAssetImageReview ? "所有文字字段仍可直接修改；涉及外观的改动建议使用单资产重新生成，让图片与文字保持一致。确认后当前编辑稿会进入四幕分镜。" : creativeCardLocked ? "真实图片只替换原占位框；资产描述、提示词与卡片排版保持原位。" : "检查资产描述，在修改意见框输入要求，再按需重新生成当前资产文本。"}</p></div>
                <button type="button" className="add-asset-button" disabled={assetTextFieldsLocked || imagePlan.asset_cards.length >= 12} title={assetTextFieldsLocked ? "当前生成步骤已开始，资产列表暂时锁定" : imagePlan.asset_cards.length >= 12 ? "最多添加 12 项资产" : "添加一张空白资产卡"} onClick={addAsset}><b aria-hidden="true">＋</b><span>添加资产<small>{imagePlan.asset_cards.length} / 12</small></span></button>
              </div>
              <div className="asset-prompt-grid">
                {imagePlan.asset_cards.map((asset, index) => {
                const confirmed = confirmedAssetIds.has(asset.id);
                const assetImage = assetImageById.get(asset.id);
                const isNewAssetAwaitingImage = awaitingAssetImageReview && !assetImage?.url;
                const assetFieldsComplete = [asset.name, asset.narrative_role, asset.description, asset.continuity_notes, asset.prompt].every((value) => value.trim().length > 0);
                const needsThreeViews = asset.category === "person" || asset.category === "animal";
                return <article id={`asset-card-${asset.id}`} className={`prompt-card asset-prompt-card ${confirmed ? "is-confirmed" : ""}`} key={asset.id}>
                  {awaitingAssetImageReview && <button type="button" className="asset-delete-button" aria-label={`删除资产 ${asset.name}`} title={imagePlan.asset_cards.length <= 2 ? "至少保留 2 项资产" : `删除资产“${asset.name}”`} disabled={submitting || regeneratingAssetId !== null || imagePlan.asset_cards.length <= 2} onClick={() => removeAsset(index)}><span>删除</span><b aria-hidden="true">×</b></button>}
                  <div className="prompt-visual asset-placeholder-visual" style={{ aspectRatio: previewAspectRatio, minHeight: 0 }}>
                    {assetImage?.url ? <Image src={assetImage.url} alt={`真实资产 ${asset.name}`} fill sizes="(max-width: 700px) 90vw, 32vw" unoptimized onLoad={() => setLoadedAssetIds((items) => new Set(items).add(asset.id))} onError={() => { setFailedAssetIds((items) => new Set(items).add(asset.id)); setMessage(`资产“${asset.name}”图片加载失败，不能进入四幕规划`); }} /> : <div className="empty-frame asset-placeholder"><span>ASSET {String(index + 1).padStart(2, "0")} · {assetCategoryLabels[asset.category]}</span><strong>{asset.name}</strong><i>{generatingAssetImages ? "真实资产图生成中" : "资产占位图"}</i></div>}
                    <div className="frame-meta"><span>{needsThreeViews ? `${assetCategoryLabels[asset.category]} · 三向图` : assetCategoryLabels[asset.category]}</span><strong>{assetImage?.url ? "✓ 真实图已归档" : awaitingAssetImageReview ? "可修改" : creativeCardLocked ? "已锁定" : confirmed ? "✓ 已确认" : "待确认"}</strong></div>
                  </div>
                  <div className="prompt-copy">
                    <span>{assetCategoryLabels[asset.category]} · {asset.id}</span><strong>{asset.narrative_role}</strong>
                    <label>{needsThreeViews ? "资产提示词（三向图）" : "资产提示词"}<textarea rows={8} value={asset.prompt} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { prompt: event.target.value })} /></label>
                    <label>资产类别<select value={asset.category} disabled={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { category: event.target.value as AssetCategory })}>{assetCategories.map((category) => <option value={category} key={category}>{assetCategoryLabels[category]}</option>)}</select></label>
                    <label>资产名称<input value={asset.name} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { name: event.target.value })} /></label>
                    <label>叙事用途<textarea rows={3} value={asset.narrative_role} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { narrative_role: event.target.value })} /></label>
                    <label>关键外观与特征<textarea rows={4} value={asset.description} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { description: event.target.value })} /></label>
                    <label>一致性要求<textarea rows={3} value={asset.continuity_notes} readOnly={assetTextFieldsLocked} onChange={(event) => updateAssetCard(index, { continuity_notes: event.target.value })} /></label>
                    {(!creativeCardLocked || awaitingAssetImageReview) && <div className="asset-regeneration-editor">
                      <label>{isNewAssetAwaitingImage ? "给 AI 的补充意见（可选）" : "给 AI 的修改意见"}<textarea rows={3} maxLength={1000} value={assetFeedback[asset.id] ?? ""} placeholder="例如：把幼猫改成银渐层；宠物笼始终固定在画面左侧，不要新增第二个笼子。" onChange={(event) => setAssetFeedback((items) => ({ ...items, [asset.id]: event.target.value }))} /></label>
                      <small>{isNewAssetAwaitingImage ? "请先完善上方资产字段；AI 会为这项新增资产单独生成真实图片，不会重新生成其他资产。" : awaitingAssetImageReview ? "AI 会先按意见修改本资产的外观、一致性与提示词，再只替换这一张真实资产图；其他资产不会重新生成。" : "AI 会根据意见重新编写本资产的外观描述、一致性要求和生成提示词。"}</small>
                    </div>}
                    {(!creativeCardLocked || awaitingAssetImageReview) && <button type="button" className="asset-regenerate-button" disabled={regeneratingAssetId !== null || regeneratingOverview || submitting || (isNewAssetAwaitingImage ? !assetFieldsComplete : (assetFeedback[asset.id]?.trim().length ?? 0) < 2)} aria-busy={regeneratingAssetId === asset.id} onClick={() => void regenerateAssetDescription(index)}>{regeneratingAssetId === asset.id ? (isNewAssetAwaitingImage ? "正在生成新增资产图片…" : awaitingAssetImageReview ? "正在修改并重新生成本资产图…" : "正在按意见重新生成…") : (isNewAssetAwaitingImage ? "生成新增资产图片" : awaitingAssetImageReview ? "根据修改意见重新生成本资产图片" : "根据修改意见重新生成资产描述")}</button>}
                    {!creativeCardLocked && <button type="button" className="asset-confirm-button" onClick={() => setConfirmedAssetIds((items) => { const next = new Set(items); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next; })}>{confirmed ? "✓ 本资产已确认" : "确认本资产"}</button>}
                  </div>
                  </article>;
                })}
              </div>
            </section>
            <AssetAssistant projectId={project.id} imagePlan={imagePlan} />
          </div>

          <section className="creative-overview-editor" data-review-order="creative-overview">
            <div className="review-section-head"><span>VISUAL SKILLS / VIDEO</span><h2>四幕分镜与总体提示词</h2><p>已确认故事保持锁定；Visual Skills 先完成四幕分镜，再把同一组镜头汇总成可执行的总体提示词。</p></div>
            <div className="overview-title-grid"><label><span>已确认故事标题</span><input value={imagePlan.overview.title} readOnly /></label><label><span>视频一句话梗概</span><input value={imagePlan.overview.logline} readOnly={assetTextFieldsLocked} onChange={(event) => updateOverview({ logline: event.target.value })} /></label></div>
            <EditableArea label="已确认故事（锁定）" value={imagePlan.overview.story} readOnly />
            <div className="two-review-fields"><EditableArea label="视觉、色彩与光线方向" value={imagePlan.overview.visual_direction} readOnly={assetTextFieldsLocked} onChange={(value) => updateOverview({ visual_direction: value })} /><EditableArea label="资产关系总述" value={imagePlan.overview.asset_relationships} readOnly={assetTextFieldsLocked} onChange={(value) => updateOverview({ asset_relationships: value })} /></div>
            <label className="cinematic-script-editor"><span>总体提示词</span><small>这里保存 Visual Skills 的汇总结果：全局视觉圣经、五个全片锚点，以及与四幕逐项一致的时间、画面提示词、动作运镜、声音和尾帧。{cinematicScriptComplete ? " 已校验：第一幕至第四幕完整。" : " 当前缺少完整四幕，不能继续生成。"}</small><textarea rows={22} value={imagePlan.overview.cinematic_script ?? ""} readOnly={assetTextFieldsLocked} onChange={(event) => updateOverview({ cinematic_script: event.target.value })} /></label>
            {overviewCanRevise && <div className="overview-regeneration-editor">
              <label>给 AI 的总览修改意见<textarea rows={4} maxLength={1000} value={overviewFeedback} placeholder="例如：整体改成雨夜黑色电影；让第三幕增加一次因果反转；固定人物从画面左向右移动；每幕补充50mm焦段、右侧主光和近中远三层声音。" onChange={(event) => setOverviewFeedback(event.target.value)} /></label>
              <small>{awaitingAssetImageReview ? "AI 会按意见重写总体提示词；已确认故事保持锁定。视觉方向变化会使当前真实资产图作废，需要重新确认生成。" : "AI 会重写视频梗概、视觉方向、资产关系和总体提示词，不会改动已确认故事或资产卡。"}</small>
              <button type="button" className="overview-regenerate-button" disabled={regeneratingOverview || regeneratingAssetId !== null || submitting || overviewFeedback.trim().length < 2} aria-busy={regeneratingOverview} onClick={() => void regenerateOverview()}>{regeneratingOverview ? "正在按意见重写总体提示词…" : "根据修改意见重新生成总体提示词"}</button>
            </div>}
            {!creativeCardLocked && <label className="overview-confirm"><input type="checkbox" checked={overviewConfirmed} disabled={!cinematicScriptComplete} onChange={(event) => setOverviewConfirmed(event.target.checked)} /><span aria-hidden="true">✓</span><p>我已检查总体提示词、四幕分镜、资产关系与全局一致性，并确认没有改写已锁定故事。</p></label>}
          </section>

          {!creativeCardLocked && <DecisionBar message={message} disabled={submitting || confirmedAssetCount !== imagePlan.asset_cards.length || !overviewConfirmed || !cinematicScriptComplete} detail={`已确认 ${confirmedAssetCount} / ${imagePlan.asset_cards.length} 项资产 · 四幕提示词${cinematicScriptComplete ? "完整" : "缺失"} · 总览${overviewConfirmed ? "已确认" : "待确认"}`} label={submitting ? "正在锁定创意卡" : `确认创意卡，生成 ${imagePlan.asset_cards.length} 张真实资产图 →`} onClick={confirmImagePlan} />}
          {awaitingAssetImageReview && <DecisionBar message={message} disabled={submitting || regeneratingAssetId !== null || !allAssetImagesAvailable} detail={regeneratingAssetId ? "正在根据意见替换一张真实资产图" : allAssetImagesAvailable ? `${imagePlan.asset_cards.length} 张真实资产图已逐项加载` : `正在验证真实资产图 ${loadedCurrentAssetCount} / ${imagePlan.asset_cards.length}`} label={submitting ? "正在确认真实资产" : "真实资产无误，规划四幕分镜 →"} onClick={confirmAssetImages} />}
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
                  <article className="canvas-node">
                    <div className="canvas-image" style={{ aspectRatio: previewAspectRatio, height: "auto" }}>{generated?.url ? <Image key={`${canvasFrame.frameId}:${project.reviewRevision ?? 0}:${generated.url}`} src={generated.url} alt={`画布视觉锚点 ${index + 1}`} fill sizes="(max-width: 820px) 70vw, 260px" unoptimized onLoad={() => setLoadedFrameIds((items) => new Set(items).add(canvasFrame.frameId))} onError={() => { setFailedFrameIds((items) => new Set(items).add(canvasFrame.frameId)); setMessage(`画布视觉锚点 ${index + 1} 图片加载失败，不能提交视频`); }} /> : <div className="missing-frame">图片未归档</div>}<span>ACT {String(index + 1).padStart(2, "0")}</span></div>
                    <div className="canvas-node-copy"><strong>{frame?.title}</strong><small>{frame?.time_range} · {frame?.narrative_goal}</small></div>
                    <div className="frame-revision-editor">
                      <span>本幕可修改内容</span>
                      <label>画面描述与生成提示词<textarea rows={7} value={frame?.prompt ?? ""} placeholder={`填写第 ${index + 1} 幕的主体、场景、构图、光线与关键动作`} onChange={(event) => { const value = event.target.value; setDirty(true); setImagePlan((plan) => plan ? { ...plan, frames: plan.frames.map((entry) => entry.id === canvasFrame.frameId ? { ...entry, prompt: value } : entry) } : plan); }} /></label>
                      <label>动作与运镜<textarea rows={4} value={canvasFrame.motion} onChange={(event) => { setDirty(true); setCanvas((item) => item ? { ...item, frames: item.frames.map((entry, entryIndex) => entryIndex === index ? { ...entry, motion: event.target.value } : entry) } : item); }} /></label>
                      <div className="frame-ai-regeneration">
                        <label>给 AI 的本幕修改意见<textarea rows={4} maxLength={1000} value={frameFeedback[canvasFrame.frameId] ?? ""} placeholder={`例如：第 ${index + 1} 幕改成雨夜；主体保持在画面左侧；增强动作结果，但不要改变人物服装和主光方向。`} onChange={(event) => setFrameFeedback((items) => ({ ...items, [canvasFrame.frameId]: event.target.value }))} /></label>
                        <small>AI 会先按意见重写本幕提示词和运镜，再只重新生成这一张锚点图；其他三幕、资产和顺序保持不变。</small>
                        <button type="button" disabled={regeneratingFrameId !== null || submitting || (frameFeedback[canvasFrame.frameId]?.trim().length ?? 0) < 2} aria-busy={regeneratingFrameId === canvasFrame.frameId} onClick={() => void regenerateStoryboardFrame(index)}>{regeneratingFrameId === canvasFrame.frameId ? `正在重写并重新生成第 ${index + 1} 幕…` : "根据修改意见重新生成本幕"}</button>
                      </div>
                      <small>也可以直接修改上方文字；确认画布后，最终编辑稿会用于后续视频生成。</small>
                    </div>
                  </article>
                  {index < canvas.transitions.length && <div className="canvas-edge"><div><i /><span>→</span><i /></div><label>转场 {index + 1}<textarea rows={3} value={canvas.transitions[index].description} onChange={(event) => setCanvas((item) => item ? { ...item, transitions: item.transitions.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry) } : item)} /></label></div>}
                </div>;
              })}
            </div>
          </section>
          <section className="canvas-summary"><div><span>4</span><p>视觉锚点<br /><small>共同覆盖完整故事</small></p></div><div><span>{segmentCount}</span><p>AI 视频分段<br /><small>逐段生成后自动合成</small></p></div><div><span>{totalDuration}s</span><p>最终时长<br /><small>{videoRatio} · {outputDimensions} · {videoFps} fps</small></p></div><strong>{videoModelLabel} 将按已确认的完整故事时间轴规划 {segmentCount} 段视频；四幕锚点用于保持人物、物品与环境连续，不会被误当成四个固定视频片段。</strong></section>
          <DecisionBar message={message} disabled={submitting || regeneratingFrameId !== null || !allImagesAvailable} detail={regeneratingFrameId ? "正在按修改意见替换当前一幕，其他三幕保持不变" : allImagesAvailable ? `${videoModelLabel} · ${videoRatio} · ${videoResolution} · ${videoFps} fps · 共 ${totalDuration} 秒` : "四幕视觉锚点必须全部成功加载，才能提交视频"} label={submitting ? "正在锁定四幕画布" : `确认四幕画布，AI拆成${segmentCount}段并自动合成 →`} onClick={confirmCanvas} />
        </>
      )}
    </main>
  );
}

function resolveAssetAnalysis(imagePlan: ImagePlan): NonNullable<ImagePlan["asset_analysis"]> {
  const subjectById = new Map((imagePlan.asset_analysis?.required_subjects ?? []).map((item) => [item.asset_id, item]));
  const sceneById = new Map((imagePlan.asset_analysis?.required_scenes ?? []).map((item) => [item.asset_id, item]));
  const requiredSubjects = imagePlan.asset_cards.filter((asset) => asset.category !== "environment").map((asset) => {
    const item = subjectById.get(asset.id);
    return {
      asset_id: asset.id,
      category: asset.category,
      name: asset.name,
      why_needed: item?.why_needed || asset.narrative_role,
      appearances: item?.appearances || `按故事需要出现在相关幕中；跨幕保持“${asset.continuity_notes}”。`,
    };
  });
  const requiredScenes = imagePlan.asset_cards.filter((asset) => asset.category === "environment").map((asset) => {
    const item = sceneById.get(asset.id);
    return {
      asset_id: asset.id,
      name: asset.name,
      why_needed: item?.why_needed || asset.narrative_role,
      visual_scope: item?.visual_scope || `${asset.description}；${asset.continuity_notes}`,
      embedded_details: item?.embedded_details?.length ? item.embedded_details : ["家具、陈设、背景道具、材质与光线统一并入该场景"],
    };
  });
  return {
    selection_summary: imagePlan.asset_analysis?.selection_summary || `AI 已逐幕核对故事，共判断出 ${requiredSubjects.length} 个独立主体和 ${requiredScenes.length} 个完整场景。`,
    required_subjects: requiredSubjects,
    required_scenes: requiredScenes,
  };
}

function AssetAssistant({ projectId, imagePlan }: { projectId: string; imagePlan: ImagePlan }) {
  const [messages, setMessages] = useState<AssetAssistantMessage[]>([{
    id: "asset-assistant-welcome",
    role: "assistant",
    content: "我是你的资产顾问。我已经读到当前的故事、资产卡和连续性设定，可以帮你检查遗漏、优化提示词或梳理资产关系。",
  }]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, pending]);

  async function sendMessage(suggested?: string) {
    const question = (suggested ?? draft).trim();
    if (pending || question.length < 2) return;
    const userMessage: AssetAssistantMessage = { id: `user-${Date.now()}`, role: "user", content: question };
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    setMessages((items) => [...items, userMessage]);
    setDraft("");
    setPending(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/asset-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, history, draftImagePlan: imagePlan }),
      });
      const data = await response.json().catch(() => null) as { reply?: string; error?: string } | null;
      if (!response.ok || !data?.reply) throw new Error(data?.error ?? "AI 暂时没有返回内容");
      setMessages((items) => [...items, { id: `assistant-${Date.now()}`, role: "assistant", content: data.reply! }]);
    } catch (error) {
      setMessages((items) => [...items, { id: `assistant-error-${Date.now()}`, role: "assistant", content: error instanceof Error ? `暂时无法回答：${error.message}` : "暂时无法连接 AI，请稍后重试。" }]);
    } finally {
      setPending(false);
    }
  }

  const quickQuestions = ["还缺哪些必要资产？", "检查资产连续性", "如何优化生成提示词？"];
  return <aside className="asset-ai-chat" aria-label="AI 资产顾问" onChange={(event) => event.stopPropagation()}>
    <div className="asset-chat-head"><div><span>AI ASSET COPILOT</span><strong>资产顾问</strong></div><i aria-hidden="true" /></div>
    <div className="asset-chat-context"><span>{imagePlan.asset_cards.length} 项资产</span><span>已读取当前草稿</span></div>
    <div className="asset-chat-messages" aria-live="polite">
      {messages.map((item) => <div className={`asset-chat-message ${item.role}`} key={item.id}><span>{item.role === "assistant" ? "AI" : "你"}</span><p>{item.content}</p></div>)}
      {pending && <div className="asset-chat-message assistant thinking"><span>AI</span><p><i /><i /><i /></p></div>}
      <div ref={endRef} />
    </div>
    <div className="asset-chat-quick" aria-label="快捷提问">{quickQuestions.map((question) => <button type="button" disabled={pending} onClick={() => void sendMessage(question)} key={question}>{question}</button>)}</div>
    <div className="asset-chat-composer">
      <textarea rows={3} maxLength={1000} value={draft} placeholder="询问资产遗漏、外观一致性、提示词写法……" aria-label="给 AI 资产顾问发送消息" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendMessage(); } }} />
      <button type="button" disabled={pending || draft.trim().length < 2} onClick={() => void sendMessage()} aria-label="发送消息">{pending ? "…" : "↑"}</button>
    </div>
    <small className="asset-chat-note">AI 会读取当前资产草稿，但不会未经确认直接修改内容。</small>
  </aside>;
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
