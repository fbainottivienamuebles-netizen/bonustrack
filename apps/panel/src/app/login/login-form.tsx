"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { login, type FormState } from "../actions";

export function LoginForm() {
  const from = useSearchParams().get("from") ?? "";
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="from" value={from} />
      <input
        className="input"
        type="password"
        name="password"
        placeholder="Clave"
        autoFocus
        required
        autoComplete="current-password"
      />
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
