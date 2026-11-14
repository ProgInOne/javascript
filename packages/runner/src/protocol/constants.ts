/** zod-free constants, so the harness bundle does not pull in zod. */

/** Bumped on incompatible message changes. The host reloads a shell that reports another version. */
export const PROTOCOL_VERSION = 1;

/** The harness reads its configuration from this global and deletes it before learner code runs. */
export const HARNESS_CONFIG_GLOBAL = '__PG_CFG';
