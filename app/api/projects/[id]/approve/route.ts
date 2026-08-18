import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";
import { approvePipelineGate, hydratePipelineInput, type ArkPipelineState } from "@/lib/pipeline";
import { presentProject } from "@/lib/project-view";

export const dynamic = "force-dynamic";

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    if (!request.headers.get("content-type")?.includes("application/json")) {
      return Response.json({ error: "请求格式必须为 application/json" }, { status: 415 });
    }
    const { id } = await context.params;
    const body = await request.json() as {
      gate?: "creative" | "image_plan" | "asset_images" | "canvas";
      revision?: number;
      payload?: unknown;
    };
    if (!body.gate || !["creative", "image_plan", "asset_images", "canvas"].includes(body.gate) || typeof body.revision !== "number" || body.payload == null) {
      return Response.json({ error: "缺少确认阶段、版本或确认内容" }, { status: 400 });
    }

    const db = getDb();
    const owner = ownerId(request);
    const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, owner))).limit(1);
    if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (row.status !== "awaiting_review" || !row.pipelineJson) {
      return Response.json({ error: "当前任务没有等待确认的内容" }, { status: 409 });
    }
    const state = JSON.parse(row.pipelineJson) as ArkPipelineState;
    const input = hydratePipelineInput(JSON.parse(row.inputJson), row.id, row.title);
    if ((state.revision ?? 1) !== body.revision) {
      return Response.json({ error: "该内容已在其他页面更新，请刷新后再确认" }, { status: 409 });
    }
    let snapshot;
    try {
      snapshot = approvePipelineGate({ state, input, gate: body.gate, payload: body.payload });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "确认内容校验失败" }, { status: 422 });
    }
    if (!snapshot.state) throw new Error("确认后的制作状态缺失");

    const [updated] = await db.update(projects).set({
      status: snapshot.status,
      progress: snapshot.progress,
      pipelineJson: JSON.stringify(snapshot.state),
      errorJson: null,
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(projects.id, id),
      eq(projects.ownerId, owner),
      eq(projects.status, "awaiting_review"),
      eq(projects.pipelineJson, row.pipelineJson),
    )).returning();
    if (!updated) return Response.json({ error: "该内容已经被确认，请刷新查看最新状态" }, { status: 409 });
    return Response.json({ project: presentProject(updated) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "确认失败" }, { status: 500 });
  }
}
