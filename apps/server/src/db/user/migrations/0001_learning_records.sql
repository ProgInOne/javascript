CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`exercise_origin` text NOT NULL,
	`variant_group_key` text NOT NULL,
	`exercise_version_hash` text NOT NULL,
	`practice_set_item_id` text,
	`study_session_id` text,
	`attempt_no` integer NOT NULL,
	`attempt_in_item` integer NOT NULL,
	`outcome` text NOT NULL,
	`score` real NOT NULL,
	`confidence` text,
	`hint_level_max` integer DEFAULT 0 NOT NULL,
	`solution_viewed` integer DEFAULT false NOT NULL,
	`tutor_assisted` integer DEFAULT false NOT NULL,
	`started_at` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	`active_ms` integer NOT NULL,
	`misconception_ids_json` text DEFAULT '[]' NOT NULL,
	`grading_json` text NOT NULL,
	`is_review` integer DEFAULT false NOT NULL,
	`engine_applied` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_set_item_id`) REFERENCES `practice_set_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "attempts_origin" CHECK("attempts"."exercise_origin" IN ('authored', 'template', 'generated')),
	CONSTRAINT "attempts_outcome" CHECK("attempts"."outcome" IN ('correct', 'partial', 'incorrect', 'error')),
	CONSTRAINT "attempts_confidence" CHECK("attempts"."confidence" IS NULL OR "attempts"."confidence" IN ('sure', 'unsure', 'guess')),
	CONSTRAINT "attempts_score" CHECK("attempts"."score" BETWEEN 0 AND 1),
	CONSTRAINT "attempts_hint_level_max" CHECK("attempts"."hint_level_max" BETWEEN 0 AND 3),
	CONSTRAINT "attempts_solution_viewed" CHECK("attempts"."solution_viewed" IN (0, 1)),
	CONSTRAINT "attempts_tutor_assisted" CHECK("attempts"."tutor_assisted" IN (0, 1)),
	CONSTRAINT "attempts_is_review" CHECK("attempts"."is_review" IN (0, 1)),
	CONSTRAINT "attempts_engine_applied" CHECK("attempts"."engine_applied" IN (0, 1)),
	CONSTRAINT "attempts_misconception_ids_json" CHECK(json_valid("attempts"."misconception_ids_json")),
	CONSTRAINT "attempts_grading_json" CHECK(json_valid("attempts"."grading_json"))
);
--> statement-breakpoint
CREATE INDEX `attempts_learner_submitted` ON `attempts` (`learner_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `attempts_learner_exercise_submitted` ON `attempts` (`learner_id`,`exercise_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `attempts_item` ON `attempts` (`practice_set_item_id`);--> statement-breakpoint
CREATE INDEX `attempts_learner_outcome_submitted` ON `attempts` (`learner_id`,`outcome`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `attempts_learner_group_submitted` ON `attempts` (`learner_id`,`variant_group_key`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `concept_mastery` (
	`learner_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`stage` text DEFAULT 'not_started' NOT NULL,
	`evidence_weight_sum` real DEFAULT 0 NOT NULL,
	`distinct_types_correct_json` text DEFAULT '[]' NOT NULL,
	`max_difficulty_correct` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`stage_changed_at` integer,
	`updated_at` integer NOT NULL,
	`engine_version` text NOT NULL,
	PRIMARY KEY(`learner_id`, `concept_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "concept_mastery_stage" CHECK("concept_mastery"."stage" IN ('not_started', 'introduced', 'practicing', 'proficient', 'mastered')),
	CONSTRAINT "concept_mastery_score" CHECK("concept_mastery"."score" BETWEEN 0 AND 100),
	CONSTRAINT "concept_mastery_distinct_types_json" CHECK(json_valid("concept_mastery"."distinct_types_correct_json"))
);
--> statement-breakpoint
CREATE INDEX `concept_mastery_learner_stage` ON `concept_mastery` (`learner_id`,`stage`);--> statement-breakpoint
CREATE INDEX `concept_mastery_learner_score` ON `concept_mastery` (`learner_id`,`score`);--> statement-breakpoint
CREATE TABLE `concept_memory` (
	`learner_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`card_json` text NOT NULL,
	`fsrs_version` text NOT NULL,
	`state` text NOT NULL,
	`due_at` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`last_review_at` integer,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`suspended` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`learner_id`, `concept_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "concept_memory_state" CHECK("concept_memory"."state" IN ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "concept_memory_suspended" CHECK("concept_memory"."suspended" IN (0, 1)),
	CONSTRAINT "concept_memory_card_json" CHECK(json_valid("concept_memory"."card_json"))
);
--> statement-breakpoint
CREATE INDEX `concept_memory_learner_suspended_due` ON `concept_memory` (`learner_id`,`suspended`,`due_at`);--> statement-breakpoint
CREATE TABLE `daily_activity` (
	`learner_id` text NOT NULL,
	`date` text NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`attempts_count` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`reviews_done` integer DEFAULT 0 NOT NULL,
	`lessons_completed` integer DEFAULT 0 NOT NULL,
	`goal_met` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`learner_id`, `date`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "daily_activity_date" CHECK("daily_activity"."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "daily_activity_active_ms" CHECK("daily_activity"."active_ms" >= 0),
	CONSTRAINT "daily_activity_goal_met" CHECK("daily_activity"."goal_met" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `exercise_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`reason` text NOT NULL,
	`exercise_origin` text NOT NULL,
	`excluded` integer DEFAULT true NOT NULL,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "exercise_reports_reason" CHECK("exercise_reports"."reason" IN ('wrong_answer', 'unclear', 'wrong_hint_or_explanation', 'difficulty_mismatch', 'other')),
	CONSTRAINT "exercise_reports_origin" CHECK("exercise_reports"."exercise_origin" IN ('authored', 'template', 'generated')),
	CONSTRAINT "exercise_reports_excluded" CHECK("exercise_reports"."excluded" IN (0, 1)),
	CONSTRAINT "exercise_reports_status" CHECK("exercise_reports"."status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `exercise_reports_learner_exercise` ON `exercise_reports` (`learner_id`,`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercise_snapshots` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`public_spec_json` text NOT NULL,
	`revision` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "exercise_snapshots_public_spec_json" CHECK(json_valid("exercise_snapshots"."public_spec_json"))
);
--> statement-breakpoint
CREATE TABLE `hint_events` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`practice_set_item_id` text,
	`kind` text NOT NULL,
	`level` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_set_item_id`) REFERENCES `practice_set_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "hint_events_kind" CHECK("hint_events"."kind" IN ('hint', 'solution', 'ai_hint')),
	CONSTRAINT "hint_events_level" CHECK(("hint_events"."kind" = 'solution' AND "hint_events"."level" IS NULL) OR ("hint_events"."kind" <> 'solution' AND "hint_events"."level" BETWEEN 1 AND 3))
);
--> statement-breakpoint
CREATE INDEX `hint_events_learner_exercise_created` ON `hint_events` (`learner_id`,`exercise_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`learner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`last_section_id` text,
	`read_progress` real DEFAULT 0 NOT NULL,
	`practice_set_id` text,
	`started_at` integer,
	`completed_at` integer,
	`content_hash_seen` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`learner_id`, `lesson_id`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lesson_progress_status" CHECK("lesson_progress"."status" IN ('not_started', 'reading', 'practicing', 'completed')),
	CONSTRAINT "lesson_progress_read_progress" CHECK("lesson_progress"."read_progress" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE INDEX `lesson_progress_learner_status` ON `lesson_progress` (`learner_id`,`status`);--> statement-breakpoint
CREATE TABLE `mastery_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`attempt_id` text,
	`kind` text NOT NULL,
	`score_before` real NOT NULL,
	`score_after` real NOT NULL,
	`stage_before` text NOT NULL,
	`stage_after` text NOT NULL,
	`breakdown_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mastery_evidence_kind" CHECK("mastery_evidence"."kind" IN ('attempt', 'stage_gate', 'diagnostic_seed', 'recompute')),
	CONSTRAINT "mastery_evidence_stage_before" CHECK("mastery_evidence"."stage_before" IN ('not_started', 'introduced', 'practicing', 'proficient', 'mastered')),
	CONSTRAINT "mastery_evidence_stage_after" CHECK("mastery_evidence"."stage_after" IN ('not_started', 'introduced', 'practicing', 'proficient', 'mastered')),
	CONSTRAINT "mastery_evidence_breakdown_json" CHECK(json_valid("mastery_evidence"."breakdown_json"))
);
--> statement-breakpoint
CREATE INDEX `mastery_evidence_learner_concept_created` ON `mastery_evidence` (`learner_id`,`concept_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mastery_evidence_attempt` ON `mastery_evidence` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `pending_ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`practice_set_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`rating` text NOT NULL,
	`attempt_id` text NOT NULL,
	`variant_group_key` text NOT NULL,
	`rated_at` integer NOT NULL,
	`flushed_at` integer,
	`flush_outcome` text,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_set_id`) REFERENCES `practice_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pending_ratings_rating" CHECK("pending_ratings"."rating" IN ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "pending_ratings_flush" CHECK(("pending_ratings"."flushed_at" IS NULL AND "pending_ratings"."flush_outcome" IS NULL) OR ("pending_ratings"."flushed_at" IS NOT NULL AND "pending_ratings"."flush_outcome" IN ('applied', 'skipped')))
);
--> statement-breakpoint
CREATE INDEX `pending_ratings_set_flushed` ON `pending_ratings` (`practice_set_id`,`flushed_at`);--> statement-breakpoint
CREATE TABLE `practice_set_items` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`practice_set_id` text NOT NULL,
	`position` integer NOT NULL,
	`exercise_id` text NOT NULL,
	`exercise_origin` text NOT NULL,
	`reason` text NOT NULL,
	`target_concept_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`final_attempt_id` text,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_set_id`) REFERENCES `practice_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "practice_set_items_origin" CHECK("practice_set_items"."exercise_origin" IN ('authored', 'template', 'generated')),
	CONSTRAINT "practice_set_items_status" CHECK("practice_set_items"."status" IN ('pending', 'answered', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_set_items_set_position` ON `practice_set_items` (`practice_set_id`,`position`);--> statement-breakpoint
CREATE INDEX `practice_set_items_exercise` ON `practice_set_items` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `practice_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`kind` text NOT NULL,
	`scope_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pass_rule_json` text,
	`result_json` text,
	`engine_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "practice_sets_kind" CHECK("practice_sets"."kind" IN ('lesson', 'review', 'weakness', 'assessment', 'remedial', 'extra', 'custom', 'diagnostic')),
	CONSTRAINT "practice_sets_status" CHECK("practice_sets"."status" IN ('active', 'completed', 'abandoned')),
	CONSTRAINT "practice_sets_scope_json" CHECK(json_valid("practice_sets"."scope_json")),
	CONSTRAINT "practice_sets_pass_rule_json" CHECK("practice_sets"."pass_rule_json" IS NULL OR json_valid("practice_sets"."pass_rule_json")),
	CONSTRAINT "practice_sets_result_json" CHECK("practice_sets"."result_json" IS NULL OR json_valid("practice_sets"."result_json"))
);
--> statement-breakpoint
CREATE INDEX `practice_sets_learner_kind_status` ON `practice_sets` (`learner_id`,`kind`,`status`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`rating` text NOT NULL,
	`source_attempt_ids_json` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`elapsed_days` real NOT NULL,
	`scheduled_days` real NOT NULL,
	`state_before` text NOT NULL,
	`revlog_json` text NOT NULL,
	`retrievability_before` real,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_logs_rating" CHECK("review_logs"."rating" IN ('again', 'hard', 'good', 'easy')),
	CONSTRAINT "review_logs_state_before" CHECK("review_logs"."state_before" IN ('new', 'learning', 'review', 'relearning')),
	CONSTRAINT "review_logs_source_attempt_ids_json" CHECK(json_valid("review_logs"."source_attempt_ids_json")),
	CONSTRAINT "review_logs_revlog_json" CHECK(json_valid("review_logs"."revlog_json"))
);
--> statement-breakpoint
CREATE INDEX `review_logs_learner_concept_reviewed` ON `review_logs` (`learner_id`,`concept_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`answer_json` text NOT NULL,
	`run_result_json` text,
	`answer_hash` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "submissions_answer_json" CHECK(json_valid("submissions"."answer_json")),
	CONSTRAINT "submissions_run_result_json" CHECK("submissions"."run_result_json" IS NULL OR json_valid("submissions"."run_result_json"))
);
