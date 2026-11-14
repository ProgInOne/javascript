import type { RequestIdVariables } from 'hono/request-id';

/** Hono environment shared by the app and its route modules. */
export interface AppEnv {
  Variables: RequestIdVariables;
}
