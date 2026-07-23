import type { CodexThread, ThreadState } from "./types";

export function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview.trim().split("\n")[0].slice(0, 42) || "未命名任务";
}

export function threadState(thread: CodexThread): ThreadState {
  if (thread.status.type === "systemError") return "failed";
  if (thread.status.type === "active") {
    if (thread.status.activeFlags?.some((flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput")) return "waiting";
    return "running";
  }
  const lastTurn = thread.turns.at(-1);
  if (lastTurn?.status === "failed") return "failed";
  if (lastTurn?.status === "interrupted") return "stopped";
  // `idle` only means that no turn is running. It is not a project-level
  // completion signal, so keep the thread available for a follow-up message.
  return "ready";
}

export const stateLabel: Record<ThreadState, string> = {
  running: "运行中",
  waiting: "等待处理",
  ready: "可继续",
  failed: "失败",
  stopped: "已中断",
};

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - timestamp));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 172800) return "昨天";
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function uptimeText(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}
