import { z } from 'zod';
import { backupSummarySchema } from './backups.ts';

/** The word the learner types to enable the reset button (ui-ux.md#설정). */
export const RESET_CONFIRM_TEXT = '초기화';

/** `POST /data/reset`. The server checks the typed confirmation too. */
export const resetRequestSchema = z.object({ confirm: z.literal(RESET_CONFIRM_TEXT) }).strict();
export type ResetRequest = z.infer<typeof resetRequestSchema>;

export const resetResponseSchema = z.object({
  /** The `pre-reset` backup taken first; restoring it undoes the reset. */
  backup: backupSummarySchema,
});
export type ResetResponse = z.infer<typeof resetResponseSchema>;
