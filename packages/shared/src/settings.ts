import { z } from 'zod';

/**
 * UI-level settings stored per learner in user.db `settings` (key → value_json).
 * Each key has its own schema and default, so adding a key needs no migration.
 * Process-level settings (port, dataDir, …) live in the server config instead.
 * Keys follow docs/design/data-model.md#meta-learners-settings.
 */
export const THEMES = ['light', 'dark', 'system'] as const;

/** D-024: the light workbench is the default; dark remaps `.workbench` subtrees only. */
export const WORKBENCH_THEMES = ['light', 'dark'] as const;

/** Lesson body size, 16 / 17 / 19px (ui-ux.md 타이포그래피). */
export const LESSON_FONT_SIZES = ['small', 'medium', 'large'] as const;

/**
 * Predict-then-run on lesson examples (ui-ux.md#예측-후-실행): `recommended` offers a
 * "예측 건너뛰기" link, `required` hides it.
 */
export const PREDICT_FIRST_MODES = ['recommended', 'required'] as const;

/**
 * Hint ladder strength (FR-SET-02, D-046). `standard`: D-010 as is. `after-attempt`: hints open
 * only after one submission on the item (try first, then get help). The answer is always behind
 * the last hint (D-010); no setting loosens that.
 */
export const HINT_POLICIES = ['standard', 'after-attempt'] as const;
export type HintPolicy = (typeof HINT_POLICIES)[number];

/**
 * `ai.model` (FR-SET-01, ai-system.md#모델-선택): a model ID from the provider's `model/list`, or
 * null for the provider's default (`isDefault`). A saved ID the provider no longer lists falls
 * back to the default when a task runs; the stored value is kept (D-060).
 */
export const aiModelSettingSchema = z.string().trim().min(1).max(200).nullable();

export const settingsSchema = z.object({
  theme: z.enum(THEMES),
  'appearance.workbench': z.enum(WORKBENCH_THEMES),
  'lesson.fontSize': z.enum(LESSON_FONT_SIZES),
  'lesson.predictFirst': z.enum(PREDICT_FIRST_MODES),
  'editor.autocomplete': z.boolean(),
  'practice.askConfidence': z.boolean(),
  'tutor.proactiveSuggestions': z.boolean(),
  'hints.policy': z.enum(HINT_POLICIES),
  'ai.model': aiModelSettingSchema,
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const SETTINGS_DEFAULTS: Settings = {
  theme: 'system',
  'appearance.workbench': 'light',
  'lesson.fontSize': 'medium',
  'lesson.predictFirst': 'recommended',
  'editor.autocomplete': false,
  'practice.askConfidence': true,
  'tutor.proactiveSuggestions': true,
  'hints.policy': 'standard',
  'ai.model': null,
};

/** PATCH body: any subset of known keys; unknown keys are rejected. */
export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * `GET`/`PATCH /settings` response as the web reads it: keys a server omits (an older build)
 * fall back to their defaults instead of failing the whole settings screen.
 */
export const settingsResponseSchema = settingsSchema.partial().transform((s): Settings => ({
  ...SETTINGS_DEFAULTS,
  ...(Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined),
  ) as Partial<Settings>),
}));
