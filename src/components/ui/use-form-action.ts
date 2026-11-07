'use client';
import { useActionState, useTransition, type FormEvent } from 'react';

/**
 * Like useActionState, but submits through onSubmit inside a transition.
 * React resets uncontrolled fields after a form `action` completes — even when
 * the server returned a validation error — which would wipe what the user typed.
 * Submitting this way keeps the values; forms that should clear do so explicitly.
 */
export function useFormAction<S>(action: (prev: S | null, fd: FormData) => Promise<S>) {
  const [state, dispatch, actionPending] = useActionState<S | null, FormData>(action, null);
  const [transitionPending, startTransition] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return { state, pending: actionPending || transitionPending, onSubmit };
}
