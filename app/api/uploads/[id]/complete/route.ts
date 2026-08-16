import { env } from "cloudflare:workers";
import { ensureDatabase, getDb } from "@/db";
import { uploads } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Bindings = { MEDIA?: R2Bucket };
type UploadedPart = { partNumber: number; etag: string };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const bindings = env as unknown as Bindings;
    if (!bindings.MEDIA) return Response.json({ error: "对象存储尚未配置" }, { status: 503 });
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { parts?: UploadedPart[] } | null;
    const parts = body?.parts;
    if (!parts?.length || parts.some((part) => !Number.isInteger(part.partNumber) || part.partNumber < 1 || !part.etag)) {
      return Response.json({ error: "上传分片清单无效" }, { status: 400 });
    }
    const orderedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const owner = request.headers.get("oai-authenticated-user-id") ?? "local-preview";
    const db = getDb();
    const [upload] = await db.select().from(uploads).where(and(
      eq(uploads.id, id),
      eq(uploads.ownerId, owner),
      eq(uploads.status, "uploading"),
    )).limit(1);
    if (!upload?.multipartUploadId) return Response.json({ error: "上传任务不存在或已经结束" }, { status: 404 });

    const multipart = bindings.MEDIA.resumeMultipartUpload(upload.objectKey, upload.multipartUploadId);
    await multipart.complete(orderedParts);
    const head = await bindings.MEDIA.head(upload.objectKey);
    if (!head || head.size !== upload.byteSize) {
      if (head) await bindings.MEDIA.delete(upload.objectKey);
      await db.update(uploads).set({ status: "failed" }).where(eq(uploads.id, id));
      return Response.json({ error: "上传校验失败，请重新选择文件" }, { status: 500 });
    }

    const [ready] = await db.update(uploads).set({ status: "ready" }).where(eq(uploads.id, id)).returning();
    return Response.json({ upload: { id: ready.id, filename: ready.filename, byteSize: ready.byteSize, status: ready.status } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "完成上传失败" }, { status: 500 });
  }
}
