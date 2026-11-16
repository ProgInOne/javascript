CREATE TABLE `code_drafts` (
	`learner_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`files_json` text NOT NULL,
	`practice_set_item_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`learner_id`, `kind`, `ref_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "code_drafts_kind" CHECK("code_drafts"."kind" IN ('exercise', 'example')),
	CONSTRAINT "code_drafts_files_json" CHECK(json_valid("code_drafts"."files_json"))
);
--> statement-breakpoint
ALTER TABLE `lesson_progress` ADD `active_ms` integer;