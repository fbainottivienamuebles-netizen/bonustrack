"use client";

import { useActionState } from "react";
import { deleteSongAction, type FormState } from "@/app/actions";

export function DeleteSongButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteSongAction, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Borrar este tema? No se puede deshacer.")) e.preventDefault();
      }}
      className="flex items-center gap-3"
    >
      {state.error && <span className="text-sm text-danger">{state.error}</span>}
      <input type="hidden" name="id" value={id} />
      <button className="btn-danger" disabled={pending}>
        Borrar
      </button>
    </form>
  );
}
