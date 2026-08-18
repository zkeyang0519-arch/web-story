import {
  getVideoModelProfile,
  isVideoModelKey,
  isVideoResolution,
  segmentDurations,
  type VideoModelKey,
  type VideoResolution,
} from "@/lib/video-config";

export type CostQuote = {
  version: "mvp-platform-cost-v7";
  currency: "CNY";
  referenceCount: number;
  duration: number;
  model: string;
  modelKey: VideoModelKey;
  resolution: VideoResolution;
  segmentCount: number;
  segmentDurations: number[];
  analysis: { min: number; max: number };
  storyboard: { count: number; assetCountMin: number; assetCountMax: number; unit: number; min: number; max: number };
  generation: { segmentCount: number; min: number; max: number };
  storage: { min: number; max: number };
  totalMin: number;
  totalMax: number;
};

export type CostQuoteOptions = {
  videoModel?: VideoModelKey;
  resolution?: VideoResolution;
};

const MODEL_COST_FACTOR: Record<VideoModelKey, number> = {
  "seedance-2.0-standard": 1,
  "seedance-2.0-fast": 0.8,
  "seedance-2.0-mini": 0.52,
};

const RESOLUTION_COST_FACTOR: Record<VideoResolution, number> = {
  "480p": 0.2,
  "720p": 0.42,
  "1080p": 1,
  "4k": 2.1,
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateCostQuote(
  referenceCount: number,
  duration: number,
  videoModelOrOptions: VideoModelKey | CostQuoteOptions = "seedance-2.0-standard",
  requestedResolution: VideoResolution = "1080p",
): CostQuote {
  const count = Math.max(1, Math.min(10, Math.round(referenceCount)));
  const seconds = Math.max(4, Math.min(120, Math.round(Number.isFinite(duration) ? duration : 15)));
  const options = typeof videoModelOrOptions === "string"
    ? { videoModel: videoModelOrOptions, resolution: requestedResolution }
    : videoModelOrOptions;
  const modelKey = isVideoModelKey(options.videoModel)
    ? options.videoModel
    : "seedance-2.0-standard";
  const profile = getVideoModelProfile(modelKey);
  const resolution = isVideoResolution(options.resolution) && profile.resolutions.includes(options.resolution)
    ? options.resolution
    : profile.defaultResolution;
  const durations = segmentDurations(seconds);
  const segmentCount = durations.length;
  const analysis = { min: money(count * 0.08 + 0.4), max: money(count * 0.25 + 2.5) };
  const assetCountMin = 2;
  const assetCountMax = 12;
  const imageUnit = 0.22;
  const storyboard = {
    count: 4,
    assetCountMin,
    assetCountMax,
    unit: imageUnit,
    min: money((assetCountMin + 4) * imageUnit),
    max: money((assetCountMax + 4) * imageUnit),
  };
  const costFactor = MODEL_COST_FACTOR[modelKey] * RESOLUTION_COST_FACTOR[resolution];
  const generation = {
    segmentCount,
    min: money((27 * (seconds / 15) + segmentCount) * costFactor),
    max: money((40.5 * (seconds / 15) + segmentCount * 1.5) * costFactor),
  };
  const storageFactor = (seconds / 15) * Math.max(0.4, RESOLUTION_COST_FACTOR[resolution]);
  const storage = {
    min: money(0.05 * storageFactor + Math.max(0, segmentCount - 1) * 0.01),
    max: money(0.15 * storageFactor + Math.max(0, segmentCount - 1) * 0.03),
  };
  return {
    version: "mvp-platform-cost-v7",
    currency: "CNY",
    referenceCount: count,
    duration: seconds,
    model: profile.label,
    modelKey,
    resolution,
    segmentCount,
    segmentDurations: durations,
    analysis,
    storyboard,
    generation,
    storage,
    totalMin: money(analysis.min + storyboard.min + generation.min + storage.min),
    totalMax: money(analysis.max + storyboard.max + generation.max + storage.max),
  };
}
