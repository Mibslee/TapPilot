import { spawn } from "node:child_process";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codexThreadUrl(threadId: string): string {
  if (!THREAD_ID.test(threadId)) throw new Error("任务 ID 无效，无法同步到电脑 Codex");
  return `codex://threads/${threadId}`;
}

/**
 * Ask the installed Codex desktop app to show the updated thread. TapPilot and
 * Codex use the same local app-server daemon, so the desktop renderer receives
 * turn notifications directly; the deep link only selects the right view.
 */
export function syncThreadToDesktop(threadId: string, onError?: (error: Error) => void): void {
  const url = codexThreadUrl(threadId);
  const timer = setTimeout(() => {
    const child = spawn("/usr/bin/open", ["-g", url], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (cause) => onError?.(cause));
    child.unref();
  }, 180);
  timer.unref();
}
