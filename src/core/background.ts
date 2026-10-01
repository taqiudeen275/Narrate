import { invoke, isTauri } from '@tauri-apps/api/core';

let workCount = 0;
let lifecycle: Promise<void> = Promise.resolve();

function serialize(action: () => Promise<void>): Promise<void> {
  const next = lifecycle.then(action);
  lifecycle = next.catch(() => undefined);
  return next;
}

/** Pair every successful begin with an end in finally, including overlapping jobs. */
export function beginBackgroundWork(label: string): Promise<void> {
  return serialize(async () => {
    if (!workCount && isTauri()) await invoke('begin_background_work', { label });
    workCount++;
  });
}

export function endBackgroundWork(): Promise<void> {
  return serialize(async () => {
    if (!workCount) return;
    workCount--;
    if (!workCount && isTauri()) await invoke('end_background_work');
  });
}
