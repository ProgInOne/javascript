CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`daily_minutes` integer DEFAULT 30 NOT NULL,
	`weekly_days` integer DEFAULT 5 NOT NULL,
	`target_course_id` text,
	`target_date` text,
	`effective_from` integer NOT NULL,
	`effective_to` integer,
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goals_daily_minutes" CHECK("goals"."daily_minutes" BETWEEN 5 AND 480),
	CONSTRAINT "goals_weekly_days" CHECK("goals"."weekly_days" BETWEEN 1 AND 7),
	CONSTRAINT "goals_target_date" CHECK("goals"."target_date" IS NULL OR "goals"."target_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goals_current` ON `goals` (`learner_id`) WHERE "goals"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX `goals_learner_from` ON `goals` (`learner_id`,`effective_from`);