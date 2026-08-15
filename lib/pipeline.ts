import { env } from "cloudflare:workers";

export type PipelineStatus =
  | "ingesting"
  | "analyzing"
  | "generating_assets"
  | "generating_video"
  | "quality_checking"
  | "post_processing"
  | "final_checking"
  | "completed"
  | "needs_action"
  | "failed"
  | "cancelled";

type PipelineBindings = {
  PIPELINE_API_URL?: string;
  PIPELINE_API_TOKEN?: string;
  VIDEO_PROVIDER?: "mock" | "seedance";
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

export type PipelineSnapshot = {
  status: PipelineStatus;
  progress: number;
  providerJobId?: string | null;
  result?: {
    videoUrl?: string;
    videoObjectKey?: string;
    qualityScore?: number;
    actualCost?: number | null;
    concept?: string;
    hook?: string;
  } | null;
  error?: { code: string; message: string } | null;
};

function bindings() {
  return env as unknown as PipelineBindings;
}

export function pipelineInfo() {
  const config = bindings();
  const production = config.VIDEO_PROVIDER === "seedance" && Boolean(config.PIPELINE_API_URL && config.PIPELINE_API_TOKEN);
  return {
    mode: production ? "production" as const : "demo" as const,
    provider: production ? "火山引擎编排服务" : "演示适配器",
    model: "Seedance 2.0 Standard",
  };
}

export async function submitPipeline(input: PipelineInput): Promise<PipelineSnapshot> {
  const info = pipelineInfo();
  if (info.mode === "demo") {
    return { status: "ingesting", progress: 4, providerJobId: `mock_${input.projectId}` };
  }

  const config = bindings();
  const response = await fetch(`${config.PIPELINE_API_URL!.replace(/\/$/, "")}/v1/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.PIPELINE_API_TOKEN}`,
      "content-type": "application/json",
      "Idempotency-Key": input.projectId,
    },
    body: JSON.stringify({
      ...input,
      video: { model: "doubao-seedance-2-0-260128", tier: "standard", resolution: "1080p", fps: 24 },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`生产编排服务提交失败（${response.status}）${detail ? `：${detail.slice(0, 160)}` : ""}`);
  }
  const data = await response.json() as { id: string; status?: PipelineStatus; progress?: number };
  return { status: data.status ?? "ingesting", progress: data.progress ?? 1, providerJobId: data.id };
}

export async function readPipeline(providerJobId: string | null, createdAt: string): Promise<PipelineSnapshot> {
  const info = pipelineInfo();
  if (info.mode === "demo" || !providerJobId || providerJobId.startsWith("mock_")) {
    return demoSnapshot(createdAt);
  }

  const config = bindings();
  const response = await fetch(`${config.PIPELINE_API_URL!.replace(/\/$/, "")}/v1/runs/${encodeURIComponent(providerJobId)}`, {
    headers: { authorization: `Bearer ${config.PIPELINE_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`生产编排服务查询失败（${response.status}）`);
  const data = await response.json() as PipelineSnapshot;
  return {
    ...data,
    result: data.result?.videoObjectKey ? { ...data.result, videoUrl: `/api/media/${encodeURIComponent(data.result.videoObjectKey)}` } : data.result,
  };
}

function demoSnapshot(createdAt: string): PipelineSnapshot {
  const elapsed = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const timeline: Array<{ until: number; status: PipelineStatus; from: number; to: number }> = [
    { until: 3_500, status: "ingesting", from: 4, to: 15 },
    { until: 7_000, status: "analyzing", from: 15, to: 30 },
    { until: 10_500, status: "generating_assets", from: 30, to: 45 },
    { until: 16_000, status: "generating_video", from: 45, to: 73 },
    { until: 20_000, status: "quality_checking", from: 73, to: 87 },
    { until: 23_500, status: "post_processing", from: 87, to: 96 },
    { until: 25_000, status: "final_checking", from: 96, to: 99 },
  ];
  let previous = 0;
  for (const item of timeline) {
    if (elapsed < item.until) {
      const ratio = Math.max(0, Math.min(1, (elapsed - previous) / (item.until - previous)));
      return { status: item.status, progress: Math.round(item.from + (item.to - item.from) * ratio), providerJobId: null };
    }
    previous = item.until;
  }
  return {
    status: "completed",
    progress: 100,
    providerJobId: null,
    result: {
      qualityScore: 91,
      actualCost: 0,
      concept: "从被时间追赶的都市早晨切入，让产品成为找回个人节奏的自然动作。",
      hook: "前 2 秒：你不是没时间，只是还没找到自己的节奏。",
    },
  };
}
