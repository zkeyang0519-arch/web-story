import { env } from "cloudflare:workers";
import { ensureDatabase, getDb } from "@/db";
import { projects, uploads } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Bindings = { MEDIA?: R2Bucket };

const PART_SIZE = 5 * 1024 * 1024;
const acceptedTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);

function safeFilename(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120) || "video.mp4";
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const bindings = env as unknown as Bindings;
    if (!bindings.MEDIA) return Response.json({ error: "对象存储尚未配置" }, { status: 503 });

    const body = await request.json().catch(() => null) as {
      projectId?: string;
      filename?: string;
      contentType?: string;
      byteSize?: number;
    } | null;
    if (!body?.projectId) return Response.json({ error: "缺少项目标识" }, { status: 400 });
    if (!body.filename?.trim()) return Response.json({ error: "缺少视频文件名" }, { status: 400 });
    if (!body.contentType || !acceptedTypes.has(body.contentType)) {
      return Response.json({ error: "仅支持 MP4、MOV 或 WebM" }, { status: 400 });
    }
    if (!Number.isSafeInteger(body.byteSize) || (body.byteSize ?? 0) <= 0) {
      return Response.json({ error: "视频文件为空或大小无效" }, { status: 400 });
    }

    const owner = request.headers.get("oai-authenticated-user-id") ?? "local-preview";
    const db = getDb();
    const [project] = await db.select().from(projects).where(and(
      eq(projects.id, body.projectId),
      eq(projects.ownerId, owner),
      eq(projects.status, "draft"),
    )).limit(1);
    if (!project) return Response.json({ error: "项目不存在或已经开始制作" }, { status: 404 });

    const id = crypto.randomUUID();
    const key = `inputs/${owner}/${body.projectId}/${id}/${safeFilename(body.filename)}`;
    const multipart = await bindings.MEDIA.createMultipartUpload(key, {
      httpMetadata: { contentType: body.contentType },
      customMetadata: { uploadId: id, ownerId: owner, projectId: body.projectId },
    });
    const now = new Date().toISOString();
    try {
      await db.insert(uploads).values({
        id,
        ownerId: owner,
        projectId: body.projectId,
        objectKey: key,
        filename: body.filename,
        contentType: body.contentType,
        byteSize: body.byteSize,
        multipartUploadId: multipart.uploadId,
        status: "uploading",
        createdAt: now,
      });
    } catch (error) {
      await multipart.abort();
      throw error;
    }

    return Response.json({ upload: { id, partSize: PART_SIZE } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "无法开始上传" }, { status: 500 });
  }
}
