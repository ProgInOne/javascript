CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`timezone` text NOT NULL,
	`day_start_hour` integer DEFAULT 4 NOT NULL,
	`experience_level` text DEFAULT 'none' NOT NULL,
	`onboarded_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT "learners_day_start_hour" CHECK("learners"."day_start_hour" BETWEEN 0 AND 23),
	CONSTRAINT "learners_experience_level" CHECK("learners"."experience_level" IN ('none', 'some', 'basics'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`learner_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`learner_id`, `key`),
	FOREIGN KEY (`learner_id`) REFERENCES `learners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_value_json" CHECK(json_valid("settings"."value_json"))
);
