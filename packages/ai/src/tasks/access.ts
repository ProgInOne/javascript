import { z } from 'zod';

/** {@link ExerciseAccess} as part of a task input (set by the service, never by the client). */
export const exerciseAccessSchema = z.object({
  hintLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  solutionViewed: z.boolean(),
});
