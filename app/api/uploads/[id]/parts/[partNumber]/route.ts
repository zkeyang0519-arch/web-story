import { env } from "cloudflare:workers";
import { ensureDatabase, getDb } from "@/db";
import { uploads } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Bindings = { MEDIA?: R2Bucket };

function isSupportedVideoHeader(header: Uint8Array) {
  const isIsoMedia = String.fromCharCode(...header.slice(4, 8)) === "ftyp";
  const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  return isIsoMedia || isWebm;
}

export async function PUT(request: Request, context: { params: Promise<{ id: string; partNumber: string }> }) {
  try {
    await ensureDatabase();
    const bindings = env as unknown as Bindings;
    if (!bindings.MEDIA) return Response.json({ error: "对象存储尚未配置" }, { status: 503 });
    const { id, partNumber: rawPartNumber } = await context.params;
    const partNumber = Number(rawPartNumber);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return Response.json({ error: "分片编号无效" }, { status: 400 });
    }

    const owner = request.headers.get("oai-authenticated-user-id") ?? "local-preview";
    const db = getDb();
    const [upload] = await db.select().from(uploads).where(and(
      eq(uploads.id, id),
      eq(uploads.ownerId, owner),
      eq(uploads.status, "uploading"),
    )).limit(1);
    if (!upload?.multipartUploadId) return Response.json({ error: "上传任务不存在或已经结束" }, { status: 404 });

    const payload = await request.arrayBuffer();
    if (!payload.byteLength) return Response.json({ error: "分片内容为空" }, { status: 400 });
    if (partNumber === 1 && !isSupportedVideoHeader(new Uint8Array(payload, 0, Math.min(16, payload.byteLength)))) {
      return Response.json({ error: "文件内容不是有效的 MP4、MOV 或 WebM 视频" }, { status: 400 });
    }

    const multipart = bindings.MEDIA.resumeMultipartUpload(upload.objectKey, upload.multipartUploadId);
    const part = await multipart.uploadPart(partNumber, payload);
    return Response.json({ part: { partNumber: part.partNumber, etag: part.etag } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "分片上传失败" }, { status: 500 });
  }
}
