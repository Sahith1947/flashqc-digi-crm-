import 'server-only';
import { z } from 'zod';
import type { ActionResult } from '@/lib/action-result';
import { AppError } from '@/server/providers/types';

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/** Converts any thrown error into a safe, user-readable ActionResult. */
export function toActionError(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof AppError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors };
  }
  const pg = err as PgLikeError;
  if (pg && typeof pg === 'object' && 'code' in pg) {
    switch (pg.code) {
      case '23505':
        return { ok: false, error: duplicateMessage(pg.message ?? '') };
      case '23503':
        return { ok: false, error: 'This record is linked to other data and cannot be changed that way.' };
      case '23514':
        return { ok: false, error: 'One of the values is not allowed.' };
      case '42501':
        return { ok: false, error: 'You do not have permission to do that.' };
      case 'P0001':
        return { ok: false, error: pg.message ?? 'Operation rejected by the database.' };
    }
  }
  console.error('[action error]', err);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}

function duplicateMessage(msg: string) {
  if (msg.includes('phone_e164')) return 'A record with this phone number already exists.';
  if (msg.includes('name')) return 'A record with this name already exists.';
  return 'This record already exists.';
}

export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    return toActionError(err);
  }
}

/** FormData helpers */
export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}
export function formOptional(fd: FormData, key: string): string | null {
  const v = formString(fd, key);
  return v === '' ? null : v;
}
export function formBool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === 'true' || v === '1';
}
