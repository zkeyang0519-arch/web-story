import { env } from "cloudflare:workers";
import { pipelineInfo } from "@/lib/pipeline";
import {
  VIDEO_DURATION_OPTIONS,
  VIDEO_FPS_OPTIONS,
  VIDEO_MODEL_KEYS,
  VIDEO_MODEL_PROFILES,
  VIDEO_RATIOS,
} from "@/lib/video-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = pipelineInfo();
  const bindings = env as unknown as { DB?: D1Database; MEDIA?: R2Bucket };
  return Response.json({
    ...info,
    storage: Boolean(bindings.DB && bindings.MEDIA),
    videoOptions: {
      durations: VIDEO_DURATION_OPTIONS,
      ratios: VIDEO_RATIOS,
      fps: VIDEO_FPS_OPTIONS,
      models: VIDEO_MODEL_KEYS.map((key) => {
        const profile = VIDEO_MODEL_PROFILES[key];
        return {
          key: profile.key,
          label: profile.label,
          description: profile.description,
          resolutions: profile.resolutions,
          ratios: profile.ratios,
          fps: profile.fps,
          clipDuration: { min: profile.minClipDuration, max: profile.maxClipDuration },
          supportsGeneratedAudio: profile.supportsGeneratedAudio,
        };
      }),
    },
  });
}
