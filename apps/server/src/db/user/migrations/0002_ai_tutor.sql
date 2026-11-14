CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`task_name` text NOT NULL,
	`task_version` integer NOT NULL,
	`base_version` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`effort` text,
	`provider_thread_id` text,
	`provider_turn_id` text,
	`subject_type` text,
	`subject_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`latency_first_token_ms` integer,
	`latency_total_ms` integer,
	`input_tokens` integer,
	`cached_input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`context_tokens_estimated` integer,
	`context_manifest_json` text NOT NULL,
	`tool_attempts` integer DEFAULT 0 NOT NULL,
	`validation_issues_json` text DEFAULT '[]' NOT NULL,
	`prompt_snapshot_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ai_calls_status" CHECK("ai_calls"."status" IN ('ok', 'bad_output', 'fallback', 'cancelled', 'timeout', 'rate_limited', 'unauthorized', 'provider_error')),
	CONSTRAINT "ai_calls_subject_type" CHECK("ai_calls"."subject_type" IS NULL OR "ai_calls"."subject_type" IN ('tutor_message', 'attempt', 'generation_job', 'tutor_thread', 'content_draft', 'hint_event')),
	CONSTRAINT "ai_calls_tool_attempts" CHECK("ai_calls"."tool_attempts" >= 0),
	CONSTRAINT "ai_calls_context_manifest_json" CHECK(json_valid("ai_calls"."context_manifest_json")),
	CONSTRAINT "ai_calls_validation_issues_json" CHECK(json_valid("ai_calls"."validation_issues_json"))
);
--> statement-breakpoint
CREATE INDEX `ai_calls_learner_created` ON `ai_calls` (`learner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_task_status` ON `ai_calls` (`task_name`,`status`);--> statement-breakpoint
CREATE INDEX `ai_calls_subject` ON `ai_calls` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `tutor_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	`meta_json` text,
	`status` text DEFAULT 'complete' NOT NULL,
	`ai_call_id` text,
	`task_name` text,
	`task_version` integer,
	`base_version` integer,
	`model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `tutor_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_call_id`) REFERENCES `ai_calls`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_messages_role" CHECK("tutor_messages"."role" IN ('learner', 'tutor', 'system_event')),
	CONSTRAINT "tutor_messages_status" CHECK("tutor_messages"."status" IN ('streaming', 'complete', 'cancelled', 'interrupted', 'failed', 'withheld')),
	CONSTRAINT "tutor_messages_attachments_json" CHECK(json_valid("tutor_messages"."attachments_json")),
	CONSTRAINT "tutor_messages_meta_json" CHECK("tutor_messages"."meta_json" IS NULL OR json_valid("tutor_messages"."meta_json"))
);
--> statement-breakpoint
CREATE INDEX `tutor_messages_thread_created` ON `tutor_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tutor_messages_status` ON `tutor_messages` (`status`);--> statement-breakpoint
CREATE TABLE `tutor_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text,
	`title` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`provider_thread_id` text,
	`provider_model` text,
	`provider_instructions_version` text,
	`status` text DEFAULT 'open' NOT NULL,
	`summary_id` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`closed_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_threads_scope_type" CHECK("tutor_threads"."scope_type" IN ('lesson', 'exercise', 'review', 'general')),
	CONSTRAINT "tutor_threads_status" CHECK("tutor_threads"."status" IN ('open', 'closed')),
	CONSTRAINT "tutor_threads_message_count" CHECK("tutor_threads"."message_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `tutor_threads_learner_scope_status` ON `tutor_threads` (`learner_id`,`scope_type`,`scope_id`,`status`);--> statement-breakpoint
CREATE INDEX `tutor_threads_learner_last_message` ON `tutor_threads` (`learner_id`,`last_message_at`);