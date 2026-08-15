import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { readPipeline } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function present(row: typeof projects.$inferSelect) {
  return { id: row.id, title: row.title, status: row.status, progress: row.progress, runMode: row.runMode, createdAt: row.createdAt, updatedAt: row.updatedAt, input: JSON.parse(row.inputJson), result: row.resultJson ? JSON.parse(row.resultJson) : null };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await context.params;
    const db = getDb();
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId(request)))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });

    if (!["completed", "failed", "cancelled"].includes(row.status)) {
      const snapshot = await readPipeline(row.providerJobId, row.createdAt);
      const changed = snapshot.status !== row.status || snapshot.progress !== row.progress || Boolean(snapshot.result) !== Boolean(row.resultJson);
      if (changed) {
        const now = new Date().toISOString();
        const [updated] = await db.update(projects).set({ status: snapshot.status, progress: snapshot.progress, resultJson: snapshot.result ? JSON.stringify(snapshot.result) : row.resultJson, errorJson: snapshot.error ? JSON.stringify(snapshot.error) : row.errorJson, updatedAt: now }).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId(request)))).returning();
        return Response.json({ project: present(updated) });
      }
    }
    return Response.json({ project: present(row) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取任务失败" }, { status: 500 });
  }
}
