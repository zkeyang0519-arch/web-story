import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const bindings = env as unknown as { MEDIA?: R2Bucket };
  if (!bindings.MEDIA) return new Response("Storage unavailable", { status: 503 });
  const objectKey = decodeURIComponent(key);
  const object = await bindings.MEDIA.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("content-disposition", request.headers.get("sec-fetch-dest") === "document" ? "attachment" : "inline");
  return new Response(object.body, { headers });
}
