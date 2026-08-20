import { projects } from "@/db/schema";
import type { ArkPipelineState } from "@/lib/pipeline";
import {
  buildFrameBasedFourActFallback,
  compileVisualSkillsPrompt,
  fourActTimeRanges,
} from "@/lib/visual-skills-prompt";

type LegacyPipeline = ArkPipelineState & {
  keyframe?: { objectKey?: string; model?: string; size?: string };
};

function visibleCinematicScript(input: Record<string, unknown>, imagePlan: NonNullable<ArkPipelineState["imagePlan"]>) {
  const duration = Number(input.duration ?? 15);
  const ratio = String(input.ratio ?? "9:16");
  const resolution = String(input.resolution ?? "1080p");
  const fps = Number(input.fps ?? 24);
  const fallbackScript = buildFrameBasedFourActFallback({
    duration,
    ratio,
    resolution,
    fps,
    visualDirection: imagePlan.overview.visual_direction,
    assetRelationships: imagePlan.overview.asset_relationships,
    continuityAnchor: imagePlan.continuity_anchor,
    frames: imagePlan.frames,
  });
  return compileVisualSkillsPrompt({
    script: imagePlan.overview.cinematic_script || fallbackScript,
    fallbackScript,
    frames: imagePlan.frames,
    header: `目标模型：${String(input.videoModel ?? "Seedance")}；总时长${duration}秒；${ratio}；${resolution}；${fps}fps。四幕与分镜字段逐项同步，后续视频分段不得改变故事因果、资产身份、空间方向、主光方向和最终画面。`,
  });
}

export function presentProject(row: typeof projects.$inferSelect) {
  const pipeline = row.pipelineJson ? JSON.parse(row.pipelineJson) as LegacyPipeline : null;
  const input = JSON.parse(row.inputJson) as Record<string, unknown>;
  const error = row.errorJson ? JSON.parse(row.errorJson) as { code?: string; message?: string; model?: string; stage?: string } : null;
  const diagnostics = pipeline?.diagnostics ?? [];
  const visibleDiagnostics = diagnostics.length || !error ? diagnostics : [{
    id: `legacy-${row.id}-${row.updatedAt}`,
    createdAt: row.updatedAt,
    stage: pipeline?.phase ?? error.stage ?? "unknown",
    operation: "legacy_failure",
    status: "invalid" as const,
    message: error.message ?? "历史任务失败",
    model: error.model,
    errorCode: error.code,
    validationErrors: [error.message ?? "历史版本未保存详细字段错误"],
  }];
  const storyboardImages = (pipeline?.storyboardImages ?? []).map((image) => ({
    frameId: image.frameId,
    order: image.order,
    url: image.objectKey ? `/api/media/${encodeURIComponent(image.objectKey)}` : image.sourceUrl || null,
    model: image.model ?? null,
    size: image.size ?? null,
  }));
  const assetImages = (pipeline?.assetImages ?? []).map((image) => ({
    assetId: image.assetId,
    order: image.order,
    url: image.objectKey ? `/api/media/${encodeURIComponent(image.objectKey)}` : image.sourceUrl || null,
    model: image.model ?? null,
    size: image.size ?? null,
  }));
  const displayImagePlan = pipeline?.imagePlan ? {
    ...pipeline.imagePlan,
    frames: pipeline.imagePlan.frames.map((frame, index) => ({
      ...frame,
      time_range: fourActTimeRanges(Number(input.duration ?? 15))[index],
    })),
  } : null;
  const visibleImagePlan = displayImagePlan ? {
    ...displayImagePlan,
    overview: {
      ...displayImagePlan.overview,
      cinematic_script: visibleCinematicScript(input, displayImagePlan),
    },
  } : null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    draftStep: row.draftStep,
    draftVersion: row.draftVersion,
    progress: row.progress,
    runMode: row.runMode,
    pipelinePhase: pipeline?.phase ?? null,
    reviewRevision: pipeline?.revision ?? null,
    keyframeUrl: pipeline?.keyframe?.objectKey ? `/api/media/${encodeURIComponent(pipeline.keyframe.objectKey)}` : storyboardImages[0]?.url ?? null,
    keyframeModel: pipeline?.keyframe?.model ?? storyboardImages[0]?.model ?? null,
    keyframeSize: pipeline?.keyframe?.size ?? storyboardImages[0]?.size ?? null,
    assetImages,
    storyboardImages,
    review: pipeline ? {
      analyses: pipeline.analyses ?? [],
      selectedHighlightIds: pipeline.selectedHighlightIds ?? [],
      creative: pipeline.creative ?? null,
      imagePlan: visibleImagePlan,
      canvas: pipeline.canvas ?? null,
      approvals: pipeline.approvals ?? {},
    } : null,
    videoProduction: pipeline?.videoPlan ? {
      totalDuration: pipeline.videoPlan.totalDuration,
      segmentCount: pipeline.videoPlan.segments.length,
      activeSegmentIndex: pipeline.activeSegmentIndex ?? 0,
      completedCount: (pipeline.segmentRuns ?? []).filter((run) => run.status === "archived").length,
      segments: pipeline.videoPlan.segments.map((segment, index) => ({
        id: segment.id,
        order: segment.order,
        startSec: segment.startSec,
        endSec: segment.endSec,
        duration: segment.duration,
        title: segment.title,
        narrativeGoal: segment.narrativeGoal,
        transitionOut: segment.transitionOut,
        status: pipeline.segmentRuns?.[index]?.status ?? "planned",
      })),
    } : null,
    recovery: pipeline?.creativeRecovery ? {
      ...pipeline.creativeRecovery,
      attempts: (pipeline.creativeAttempts ?? []).slice(-3).map((attempt) => ({
        model: attempt.model,
        strategy: attempt.strategy,
        status: attempt.status,
        errors: attempt.errors,
        createdAt: attempt.createdAt,
      })),
    } : null,
    stepRecovery: pipeline?.stepRecovery ?? null,
    diagnostics: visibleDiagnostics,
    activity: pipeline?.events ?? [],
    error,
    createdAt: row.runStartedAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    input,
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}
