ALTER TABLE `projects` ADD `draft_step` text DEFAULT 'references' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `draft_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `run_started_at` text;--> statement-breakpoint
ALTER TABLE `uploads` ADD `project_id` text;