import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type Bindings = { DB?: D1Database };
let databaseReady: Promise<void> | null = null;

export function getBindings() {
  return env as unknown as Bindings;
}

export function getDb() {
  const { DB } = getBindings();
  if (!DB) {
    throw new Error("D1 binding `DB` is unavailable.");
  }
  return drizzle(DB, { schema });
}

export function ensureDatabase() {
  databaseReady ??= bootstrapDatabase();
  return databaseReady;
}

async function bootstrapDatabase() {
  const { DB } = getBindings();
  if (!DB) throw new Error("D1 binding `DB` is unavailable.");
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_step TEXT DEFAULT 'references' NOT NULL,
      draft_version INTEGER DEFAULT 1 NOT NULL,
      progress INTEGER DEFAULT 0 NOT NULL,
      run_mode TEXT DEFAULT 'demo' NOT NULL,
      provider_job_id TEXT,
      run_started_at TEXT,
      input_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      pipeline_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS projects_request_key_unique ON projects (request_key)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      project_id TEXT,
      object_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      multipart_upload_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uploads_object_key_unique ON uploads (object_key)"),
  ]);

  for (const statement of [
    "ALTER TABLE projects ADD COLUMN draft_step TEXT DEFAULT 'references' NOT NULL",
    "ALTER TABLE projects ADD COLUMN draft_version INTEGER DEFAULT 1 NOT NULL",
    "ALTER TABLE projects ADD COLUMN run_started_at TEXT",
    "ALTER TABLE projects ADD COLUMN pipeline_json TEXT",
    "ALTER TABLE uploads ADD COLUMN project_id TEXT",
    "ALTER TABLE uploads ADD COLUMN multipart_upload_id TEXT",
  ]) {
    try {
      await DB.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate column name")) throw error;
    }
  }
}
