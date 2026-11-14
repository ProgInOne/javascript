import { z } from 'zod';

/**
 * UI-level settings stored per learner in user.db `settings` (key → value_json).
 * Each key has its own schema and default, so adding a key needs no migration.
 * Process-level settings (port, dataDir, …) live in the server config instead.
 */
export const THEMES = ['light', 'dark', 'system'] as const;

export const settingsSchema = z.object({
  theme: z.enum(THEMES),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const SETTINGS_DEFAULTS: Settings = {
  theme: 'system',
};

/** PATCH body: any subset of known keys; unknown keys are rejected. */
export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
