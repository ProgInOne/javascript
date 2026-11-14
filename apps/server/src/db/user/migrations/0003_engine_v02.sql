CREATE TABLE `misconception_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`misconception_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`status` text DEFAULT 'suspected' NOT NULL,
	`source` text NOT NULL,
	`ai_description` text,
	`evidence_attempt_ids_json` text NOT NULL,
	`resolution_attempt_ids_json` text DEFAULT '[]' NOT NULL,
	`confirm_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "misconception_observations_status" CHECK("misconception_observations"."status" IN ('suspected', 'confirmed', 'resolved', 'dismissed')),
	CONSTRAINT "misconception_observations_source" CHECK("misconception_observations"."source" IN ('distractor', 'pattern', 'ai')),
	CONSTRAINT "misconception_observations_evidence" CHECK(json_valid("misconception_observations"."evidence_attempt_ids_json") AND json_array_length("misconception_observations"."evidence_attempt_ids_json") > 0),
	CONSTRAINT "misconception_observations_resolution" CHECK(json_valid("misconception_observations"."resolution_attempt_ids_json")),
	CONSTRAINT "misconception_observations_ai" CHECK("misconception_observations"."misconception_id" NOT LIKE 'ai.%' OR ("misconception_observations"."source" = 'ai' AND "misconception_observations"."ai_description" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `misconception_observations_active` ON `misconception_observations` (`learner_id`,`misconception_id`) WHERE "misconception_observations"."status" IN ('suspected', 'confirmed');--> statement-breakpoint
CREATE INDEX `misconception_observations_learner_concept_status` ON `misconception_observations` (`learner_id`,`concept_id`,`status`);--> statement-breakpoint
CREATE TABLE `remediation_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`practice_set_id` text,
	`attempt_id` text NOT NULL,
	`trigger` text NOT NULL,
	`kind` text NOT NULL,
	`prerequisite_id` text,
	`worked_example_stage` integer,
	`detail_json` text NOT NULL,
	`item_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_set_id`) REFERENCES `practice_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "remediation_suggestions_trigger" CHECK("remediation_suggestions"."trigger" IN ('set_consecutive_failures', 'recent_consecutive_failures')),
	CONSTRAINT "remediation_suggestions_kind" CHECK("remediation_suggestions"."kind" IN ('prerequisite_check', 'worked_example', 'easier_with_hint', 'reread_lesson')),
	CONSTRAINT "remediation_suggestions_detail_json" CHECK(json_valid("remediation_suggestions"."detail_json")),
	CONSTRAINT "remediation_suggestions_item_ids_json" CHECK(json_valid("remediation_suggestions"."item_ids_json"))
);
--> statement-breakpoint
CREATE INDEX `remediation_suggestions_learner_concept_created` ON `remediation_suggestions` (`learner_id`,`concept_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `remediation_suggestions_set` ON `remediation_suggestions` (`practice_set_id`);