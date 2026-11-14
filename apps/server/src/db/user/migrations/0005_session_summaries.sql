CREATE TABLE `session_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`source` text NOT NULL,
	`summary_json` text NOT NULL,
	`concept_ids_json` text NOT NULL,
	`message_count` integer NOT NULL,
	`covered_until` integer NOT NULL,
	`ai_call_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ai_call_id`) REFERENCES `ai_calls`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_summaries_scope_type" CHECK("session_summaries"."scope_type" IN ('tutor_thread', 'study_session')),
	CONSTRAINT "session_summaries_source" CHECK("session_summaries"."source" IN ('ai', 'fallback')),
	CONSTRAINT "session_summaries_summary_json" CHECK(json_valid("session_summaries"."summary_json")),
	CONSTRAINT "session_summaries_concept_ids_json" CHECK(json_valid("session_summaries"."concept_ids_json")),
	CONSTRAINT "session_summaries_message_count" CHECK("session_summaries"."message_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `session_summaries_learner_scope` ON `session_summaries` (`learner_id`,`scope_type`,`scope_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `session_summary_concepts` (
	`summary_id` text NOT NULL,
	`concept_id` text NOT NULL,
	PRIMARY KEY(`summary_id`, `concept_id`),
	FOREIGN KEY (`summary_id`) REFERENCES `session_summaries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_summary_concepts_concept` ON `session_summary_concepts` (`concept_id`);