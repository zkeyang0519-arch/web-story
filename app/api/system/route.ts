import { env } from "cloudflare:workers";
import { pipelineInfo } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = pipelineInfo();
  const bindings = env as unknown as { DB?: D1Database; MEDIA?: R2Bucket };
  return Response.json({ ...info, storage: Boolean(bindings.DB && bindings.MEDIA) });
}
