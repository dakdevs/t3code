import { useEffect, useRef, useState } from "react";

export function useSkillSelectionSave(input: {
  readonly target: string;
  readonly selection: ReadonlyArray<string> | null | undefined;
}) {
  const [pending, setPending] = useState<{
    target: string;
    names: ReadonlyArray<string> | null | undefined;
    acknowledged: boolean;
  } | null>(null);
  const pendingRef = useRef<typeof pending>(null);
  const isSaving = (request: typeof pending) => {
    if (!request || request.target !== input.target) return false;
    const currentNames = input.selection;
    const reflected =
      request.names == null
        ? currentNames == null
        : currentNames != null &&
          request.names.length === currentNames.length &&
          request.names.every((name) => currentNames.includes(name));
    return !request.acknowledged || !reflected;
  };
  const saving = isSaving(pending);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Retire completed writes after the authoritative selection arrives, so later remote edits do not relock them.
  useEffect(() => {
    if (pending && !saving && pendingRef.current === pending) {
      pendingRef.current = null;
      setPending(null);
    }
  }, [pending, saving]);
  const save = async (
    names: ReadonlyArray<string> | null | undefined,
    write: () => Promise<boolean>,
  ) => {
    if (isSaving(pendingRef.current)) return;
    const request = { target: input.target, names, acknowledged: false };
    pendingRef.current = request;
    setPending(request);
    const succeeded = await write().catch(() => false);
    if (pendingRef.current !== request) return;
    if (succeeded) {
      const acknowledged = { ...request, acknowledged: true };
      pendingRef.current = acknowledged;
      setPending(acknowledged);
    } else {
      pendingRef.current = null;
      setPending(null);
    }
  };
  return { saving, save };
}
