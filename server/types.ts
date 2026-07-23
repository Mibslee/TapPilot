export type JsonObject = Record<string, unknown>;

export type ThreadStatus =
  | { type: "notLoaded" | "idle" | "systemError" }
  | { type: "active"; activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput"> };

export interface CodexThread {
  id: string;
  preview: string;
  name: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: ThreadStatus;
  turns: CodexTurn[];
}

export interface CodexTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  items: CodexItem[];
}

export type CodexItem = JsonObject & { type: string; id?: string };

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
}

export interface PendingApproval {
  key: string;
  requestId: string | number;
  method: string;
  params: JsonObject;
  receivedAt: number;
}
