import { projects } from "@/db/schema";
import type { ArkPipelineState } from "@/lib/pipeline";

type LegacyPipeline = ArkPipelineState & {
  keyframe?: { objectKey?: string; model?: string; size?: string };
};

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
  const visibleImagePlan = pipeline?.imagePlan ? {
    ...pipeline.imagePlan,
    overview: {
      ...pipeline.imagePlan.overview,
      cinematic_script: pipeline.imagePlan.overview.cinematic_script || `【全局视觉圣经】${Number(input.duration ?? 15)}秒，${String(input.ratio ?? "9:16")}，${String(input.resolution ?? "1080p")}，${Number(input.fps ?? 24)}fps。整体视觉：${pipeline.imagePlan.overview.visual_direction}。固定资产关系：${pipeline.imagePlan.overview.asset_relationships}。全局连续性：${pipeline.imagePlan.continuity_anchor}。\n\n【第一幕｜钩子建立】建立主体、目标、空间坐标与前2秒变化；明确景别、焦段、机位、运动、焦点、动作时间轴、物理反馈、光色与片尾状态。\n\n【第二幕｜行动发展】保持轴线、资产位置、人物外观与光源方向，推进一个新行动及其环境和声音反馈。\n\n【第三幕｜因果转折】只呈现一次明确的冲突变化与结果，摄影机反馈短促克制，尾帧为下一幕承接。\n\n【第四幕｜结果收束】完成可见结果、情绪余韵和自然行动号召；稳定停在资产关系清晰的结尾画面。\n\n禁止变脸、额外肢体、资产复制/漂移、方向跳变、动作重复、突然切镜、过曝、乱码、文字和水印。`,
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
