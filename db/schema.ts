import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  requestKey: text("request_key").notNull().unique(),
  requestFingerprint: text("request_fingerprint").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  runMode: text("run_mode").notNull().default("demo"),
  providerJobId: text("provider_job_id"),
  inputJson: text("input_json").notNull(),
  resultJson: text("result_json"),
  errorJson: text("error_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});
