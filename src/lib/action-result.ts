// Shared result type for server actions. A success message is only ever
// produced after the database (or a provider) confirmed the operation.
export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const initialActionState = null as ActionResult<unknown> | null;
