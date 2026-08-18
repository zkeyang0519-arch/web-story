export const VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const;
export const VIDEO_FPS_OPTIONS = [24] as const;
export const VIDEO_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export const VIDEO_MODEL_KEYS = [
  "seedance-2.0-standard",
  "seedance-2.0-fast",
  "seedance-2.0-mini",
] as const;

export type VideoRatio = (typeof VIDEO_RATIOS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];
export type VideoFps = (typeof VIDEO_FPS_OPTIONS)[number];
export type VideoModelKey = (typeof VIDEO_MODEL_KEYS)[number];
export type VideoModelEndpointOverrides = Partial<Record<VideoModelKey, string>>;
export type ArkVideoModelEnvOverrides = Partial<Record<
  "ARK_VIDEO_MODEL" | "ARK_VIDEO_MODEL_FAST" | "ARK_VIDEO_MODEL_MINI",
  string
>>;

export type VideoDimensions = {
  width: number;
  height: number;
};

export type VideoModelProfile = {
  key: VideoModelKey;
  label: string;
  description: string;
  defaultEndpoint: string;
  endpointEnv: "ARK_VIDEO_MODEL" | "ARK_VIDEO_MODEL_FAST" | "ARK_VIDEO_MODEL_MINI";
  resolutions: readonly VideoResolution[];
  ratios: readonly VideoRatio[];
  fps: readonly VideoFps[];
  minClipDuration: 4;
  maxClipDuration: 15;
  defaultResolution: VideoResolution;
  supportsGeneratedAudio: boolean;
};

const ALL_RATIOS: readonly VideoRatio[] = VIDEO_RATIOS;

export const VIDEO_MODEL_PROFILES: Record<VideoModelKey, VideoModelProfile> = {
  "seedance-2.0-standard": {
    key: "seedance-2.0-standard",
    label: "Seedance 2.0 Standard",
    description: "最高画质，支持 1080p 与 4K",
    defaultEndpoint: "doubao-seedance-2-0-260128",
    endpointEnv: "ARK_VIDEO_MODEL",
    resolutions: VIDEO_RESOLUTIONS,
    ratios: ALL_RATIOS,
    fps: VIDEO_FPS_OPTIONS,
    minClipDuration: 4,
    maxClipDuration: 15,
    defaultResolution: "1080p",
    supportsGeneratedAudio: true,
  },
  "seedance-2.0-fast": {
    key: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    description: "兼顾速度与质量，最高支持 720p",
    defaultEndpoint: "doubao-seedance-2-0-fast-260128",
    endpointEnv: "ARK_VIDEO_MODEL_FAST",
    resolutions: ["480p", "720p"],
    ratios: ALL_RATIOS,
    fps: VIDEO_FPS_OPTIONS,
    minClipDuration: 4,
    maxClipDuration: 15,
    defaultResolution: "720p",
    supportsGeneratedAudio: true,
  },
  "seedance-2.0-mini": {
    key: "seedance-2.0-mini",
    label: "Seedance 2.0 Mini",
    description: "成本优先，最高支持 720p；当前不生成原生音轨",
    defaultEndpoint: "doubao-seedance-2-0-mini-260615",
    endpointEnv: "ARK_VIDEO_MODEL_MINI",
    resolutions: ["480p", "720p"],
    ratios: ALL_RATIOS,
    fps: VIDEO_FPS_OPTIONS,
    minClipDuration: 4,
    maxClipDuration: 15,
    defaultResolution: "720p",
    supportsGeneratedAudio: false,
  },
};

export const VIDEO_MODEL_CAPABILITIES = VIDEO_MODEL_PROFILES;

// ModelArk returns these exact pixel dimensions for the Seedance 2.0 series.
const VIDEO_DIMENSIONS: Record<VideoResolution, Record<VideoRatio, VideoDimensions>> = {
  "480p": {
    "16:9": { width: 864, height: 496 },
    "4:3": { width: 752, height: 560 },
    "1:1": { width: 640, height: 640 },
    "3:4": { width: 560, height: 752 },
    "9:16": { width: 496, height: 864 },
    "21:9": { width: 992, height: 432 },
  },
  "720p": {
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 1112, height: 834 },
    "1:1": { width: 960, height: 960 },
    "3:4": { width: 834, height: 1112 },
    "9:16": { width: 720, height: 1280 },
    "21:9": { width: 1470, height: 630 },
  },
  "1080p": {
    "16:9": { width: 1920, height: 1080 },
    "4:3": { width: 1664, height: 1248 },
    "1:1": { width: 1440, height: 1440 },
    "3:4": { width: 1248, height: 1664 },
    "9:16": { width: 1080, height: 1920 },
    "21:9": { width: 2206, height: 946 },
  },
  "4k": {
    "16:9": { width: 3840, height: 2160 },
    "4:3": { width: 3326, height: 2494 },
    "1:1": { width: 2880, height: 2880 },
    "3:4": { width: 2494, height: 3326 },
    "9:16": { width: 2160, height: 3840 },
    "21:9": { width: 4398, height: 1886 },
  },
};

export const MIN_VIDEO_DURATION = 4;
export const MAX_VIDEO_DURATION = 120;

export type VideoSegmentTiming = {
  index: number;
  startSec: number;
  endSec: number;
  duration: number;
};

export type VideoSpec = {
  videoModel: VideoModelKey;
  ratio: VideoRatio;
  resolution: VideoResolution;
  fps: VideoFps;
  duration: number;
};

export type VideoSpecValidation =
  | { ok: true; spec: VideoSpec; profile: VideoModelProfile; segments: VideoSegmentTiming[] }
  | { ok: false; errors: string[] };

export function isVideoModelKey(value: unknown): value is VideoModelKey {
  return typeof value === "string" && (VIDEO_MODEL_KEYS as readonly string[]).includes(value);
}

export function isVideoRatio(value: unknown): value is VideoRatio {
  return typeof value === "string" && (VIDEO_RATIOS as readonly string[]).includes(value);
}

export function isVideoResolution(value: unknown): value is VideoResolution {
  return typeof value === "string" && (VIDEO_RESOLUTIONS as readonly string[]).includes(value);
}

export function isVideoFps(value: unknown): value is VideoFps {
  return typeof value === "number" && (VIDEO_FPS_OPTIONS as readonly number[]).includes(value);
}

export function getVideoModelProfile(model: VideoModelKey): VideoModelProfile {
  return VIDEO_MODEL_PROFILES[model];
}

export function getVideoCapability(model: VideoModelKey): VideoModelProfile {
  return getVideoModelProfile(model);
}

export function getSupportedResolutions(model: VideoModelKey): readonly VideoResolution[] {
  return getVideoModelProfile(model).resolutions;
}

export function resolveVideoModelEndpoint(
  model: VideoModelKey,
  overrides: VideoModelEndpointOverrides = {},
): string {
  const override = overrides[model]?.trim();
  return override || getVideoModelProfile(model).defaultEndpoint;
}

export function getArkVideoModel(
  model: VideoModelKey,
  envOverrides: ArkVideoModelEnvOverrides = {},
): string {
  const profile = getVideoModelProfile(model);
  const override = envOverrides[profile.endpointEnv]?.trim();
  return override || profile.defaultEndpoint;
}

export function getVideoDimensions(ratio: VideoRatio, resolution: VideoResolution): VideoDimensions {
  return VIDEO_DIMENSIONS[resolution][ratio];
}

export function formatVideoDimensions(ratio: VideoRatio, resolution: VideoResolution): string {
  const { width, height } = getVideoDimensions(ratio, resolution);
  return `${width} × ${height}`;
}

export function segmentDurations(totalDuration: number): number[] {
  if (!Number.isInteger(totalDuration) || totalDuration < MIN_VIDEO_DURATION || totalDuration > MAX_VIDEO_DURATION) {
    throw new RangeError(`成片时长必须是 ${MIN_VIDEO_DURATION}–${MAX_VIDEO_DURATION} 秒之间的整数`);
  }

  const segmentCount = Math.ceil(totalDuration / 15);
  const baseDuration = Math.floor(totalDuration / segmentCount);
  const remainder = totalDuration % segmentCount;
  return Array.from(
    { length: segmentCount },
    (_, index) => baseDuration + (index < remainder ? 1 : 0),
  );
}

export function planVideoSegments(totalDuration: number): VideoSegmentTiming[] {
  let cursor = 0;
  return segmentDurations(totalDuration).map((duration, index) => {
    const segment = { index, startSec: cursor, endSec: cursor + duration, duration };
    cursor += duration;
    return segment;
  });
}

export function validateVideoSpec(value: unknown): VideoSpecValidation {
  if (!value || typeof value !== "object") return { ok: false, errors: ["视频规格不能为空"] };
  const candidate = value as Record<string, unknown>;
  const errors: string[] = [];

  if (!isVideoModelKey(candidate.videoModel)) errors.push("不支持的视频模型");
  if (!isVideoRatio(candidate.ratio)) errors.push("不支持的画幅比例");
  if (!isVideoResolution(candidate.resolution)) errors.push("不支持的清晰度");
  if (!isVideoFps(candidate.fps)) errors.push("Seedance 2.0 当前仅支持 24 fps 输出");
  if (!Number.isInteger(candidate.duration) || Number(candidate.duration) < MIN_VIDEO_DURATION || Number(candidate.duration) > MAX_VIDEO_DURATION) {
    errors.push(`成片时长必须是 ${MIN_VIDEO_DURATION}–${MAX_VIDEO_DURATION} 秒之间的整数`);
  }

  if (isVideoModelKey(candidate.videoModel) && isVideoResolution(candidate.resolution)) {
    const profile = getVideoModelProfile(candidate.videoModel);
    if (!profile.resolutions.includes(candidate.resolution)) {
      errors.push(`${profile.label} 不支持 ${candidate.resolution}`);
    }
  }

  if (errors.length) return { ok: false, errors };

  const spec: VideoSpec = {
    videoModel: candidate.videoModel as VideoModelKey,
    ratio: candidate.ratio as VideoRatio,
    resolution: candidate.resolution as VideoResolution,
    fps: candidate.fps as VideoFps,
    duration: candidate.duration as number,
  };
  const profile = getVideoModelProfile(spec.videoModel);
  return { ok: true, spec, profile, segments: planVideoSegments(spec.duration) };
}

export function assertVideoSpec(value: unknown): asserts value is VideoSpec {
  const result = validateVideoSpec(value);
  if (!result.ok) throw new RangeError(result.errors.join("；"));
}
