import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type Bindings = { DB?: D1Database };

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

export async function ensureDatabase() {
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
      progress INTEGER DEFAULT 0 NOT NULL,
      run_mode TEXT DEFAULT 'demo' NOT NULL,
      provider_job_id TEXT,
      input_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS projects_request_key_unique ON projects (request_key)"),
    DB.prepare(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS uploads_object_key_unique ON uploads (object_key)"),
  ]);
}
