import { useEffect, useRef, useState } from "react";

export function useSkillSelectionSave<A>(props: {
  readonly owner: string;
  readonly selection: string;
  readonly save: (value: A) => Promise<boolean>;
}) {
  const pending = useRef<{
    owner: string;
    selection: string;
    acknowledged: boolean;
  } | null>(null);
  const [request, setRequest] = useState<typeof pending.current>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Retire completed writes when the server projection reflects them, so later remote edits cannot restore an old lock.
  useEffect(() => {
    if (
      request &&
      pending.current === request &&
      (request.owner !== props.owner ||
        (request.acknowledged && request.selection === props.selection))
    ) {
      pending.current = null;
      setRequest(null);
    }
  }, [request, props.owner, props.selection]);
  const saving =
    request !== null &&
    request.owner === props.owner &&
    !(request.acknowledged && request.selection === props.selection);
  const write = async (value: A, selection: string) => {
    const previous = pending.current;
    if (
      previous?.owner === props.owner &&
      !(previous.acknowledged && previous.selection === props.selection)
    )
      return;
    const next = { owner: props.owner, selection, acknowledged: false };
    pending.current = next;
    setRequest(next);
    const succeeded = await props.save(value).catch(() => false);
    if (pending.current === next) {
      const settled = succeeded ? { ...next, acknowledged: true } : null;
      pending.current = settled;
      setRequest(settled);
    }
  };
  return { saving, write };
}
