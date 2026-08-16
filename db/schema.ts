import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  requestKey: text("request_key").notNull().unique(),
  requestFingerprint: text("request_fingerprint").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  draftStep: text("draft_step").notNull().default("references"),
  draftVersion: integer("draft_version").notNull().default(1),
  progress: integer("progress").notNull().default(0),
  runMode: text("run_mode").notNull().default("demo"),
  providerJobId: text("provider_job_id"),
  runStartedAt: text("run_started_at"),
  inputJson: text("input_json").notNull(),
  resultJson: text("result_json"),
  errorJson: text("error_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  projectId: text("project_id"),
  objectKey: text("object_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  multipartUploadId: text("multipart_upload_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});
