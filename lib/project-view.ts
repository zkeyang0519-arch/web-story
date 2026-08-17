import { projects } from "@/db/schema";
import type { ArkPipelineState } from "@/lib/pipeline";

type LegacyPipeline = ArkPipelineState & {
  keyframe?: { objectKey?: string; model?: string; size?: string };
};

export function presentProject(row: typeof projects.$inferSelect) {
  const pipeline = row.pipelineJson ? JSON.parse(row.pipelineJson) as LegacyPipeline : null;
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
    url: image.objectKey ? `/api/media/${encodeURIComponent(image.objectKey)}` : null,
    model: image.model ?? null,
    size: image.size ?? null,
  }));
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
    storyboardImages,
    review: pipeline ? {
      analyses: pipeline.analyses ?? [],
      creative: pipeline.creative ?? null,
      imagePlan: pipeline.imagePlan ?? null,
      canvas: pipeline.canvas ?? null,
      approvals: pipeline.approvals ?? {},
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
    input: JSON.parse(row.inputJson),
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
  };
}
