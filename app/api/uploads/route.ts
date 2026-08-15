import { env } from "cloudflare:workers";
import { ensureDatabase, getDb } from "@/db";
import { projects, uploads } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Bindings = { MEDIA?: R2Bucket };

function safeFilename(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 120) || "video.mp4";
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const bindings = env as unknown as Bindings;
    if (!bindings.MEDIA) return Response.json({ error: "对象存储尚未配置" }, { status: 503 });
    const form = await request.formData();
    const file = form.get("file");
    const projectId = form.get("projectId");
    if (typeof projectId !== "string" || !projectId) return Response.json({ error: "缺少项目标识" }, { status: 400 });
    if (!(file instanceof File)) return Response.json({ error: "缺少视频文件" }, { status: 400 });
    if (file.size <= 0 || file.size > 200 * 1024 * 1024) return Response.json({ error: "视频大小必须在 0～200 MB 之间" }, { status: 400 });
    const accepted = new Set(["video/mp4", "video/quicktime", "video/webm"]);
    if (!accepted.has(file.type)) return Response.json({ error: "仅支持 MP4、MOV 或 WebM" }, { status: 400 });

    const owner = request.headers.get("oai-authenticated-user-id") ?? "local-preview";
    const db = getDb();
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, owner), eq(projects.status, "draft"))).limit(1);
    if (!project) return Response.json({ error: "项目不存在或已经开始制作" }, { status: 404 });
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const isIsoMedia = String.fromCharCode(...header.slice(4, 8)) === "ftyp";
    const isWebm = header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
    if (!isIsoMedia && !isWebm) return Response.json({ error: "文件内容不是有效的 MP4、MOV 或 WebM 视频" }, { status: 400 });
    const id = crypto.randomUUID();
    const key = `inputs/${owner}/${projectId}/${id}/${safeFilename(file.name)}`;
    await bindings.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { uploadId: id, ownerId: owner, projectId } });
    const head = await bindings.MEDIA.head(key);
    if (!head || head.size !== file.size) {
      await bindings.MEDIA.delete(key);
      return Response.json({ error: "上传校验失败，请重试" }, { status: 500 });
    }

    const now = new Date().toISOString();
    let created: typeof uploads.$inferSelect;
    try {
      [created] = await db.insert(uploads).values({ id, ownerId: owner, projectId, objectKey: key, filename: file.name, contentType: file.type, byteSize: file.size, status: "ready", createdAt: now }).returning();
    } catch (error) {
      await bindings.MEDIA.delete(key);
      throw error;
    }
    return Response.json({ upload: { id: created.id, filename: created.filename, byteSize: created.byteSize, status: created.status } }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 });
  }
}
