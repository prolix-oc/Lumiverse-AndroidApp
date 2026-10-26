export interface ImportActivity {
  jobId: string;
  status: string;
  phase?: string;
  processed?: number;
  total?: number;
  bytesProcessed?: number;
  bytesTotal?: number;
}

/** Only authenticated IPC from our own backend may control native foreground work. */
export function importActivityFromMessage(message: unknown, token: string): ImportActivity | null {
  const value = message as { type?: string; token?: string; activity?: ImportActivity } | null;
  const activity = value?.activity;
  if (value?.type !== "android-import" || value.token !== token || !activity ||
    typeof activity.jobId !== "string" || !/^[\w-]{1,128}$/.test(activity.jobId) ||
    !["uploading", "queued", "running", "awaiting_ticket", "complete", "failed", "cancelled", "interrupted"].includes(activity.status)) return null;
  const result: ImportActivity = { jobId: activity.jobId, status: activity.status };
  if (typeof activity.phase === "string" && /^[a-z_]{1,64}$/.test(activity.phase)) result.phase = activity.phase;
  for (const key of ["processed", "total", "bytesProcessed", "bytesTotal"] as const) {
    const count = activity[key];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  return result;
}

export function importCancellation(line: string): string | null {
  if (line.length > 1024) return null;
  try {
    const command = JSON.parse(line);
    return command.action === "cancel-import" && typeof command.jobId === "string" && /^[\w-]{1,128}$/.test(command.jobId)
      ? command.jobId : null;
  } catch { return null; }
}
