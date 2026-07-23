export type ThreadState = "running" | "waiting" | "ready" | "failed" | "stopped";

export interface ThreadStatus {
  type: "notLoaded" | "idle" | "systemError" | "active";
  activeFlags?: Array<"waitingOnApproval" | "waitingOnUserInput">;
}

export interface CodexItem {
  type: string;
  id?: string;
  text?: string;
  content?: Array<{ type: string; text?: string; url?: string; alt?: string }>;
  images?: Array<{ url: string; alt: string }>;
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  server?: string;
  tool?: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  items: CodexItem[];
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexThread {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  updatedAt: number;
  status: ThreadStatus;
  turns: CodexTurn[];
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
}

export interface PendingApproval {
  key: string;
  method: string;
  params: {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    reason?: string;
    command?: string;
    cwd?: string;
    networkApprovalContext?: { host?: string; protocol?: string };
    grantRoot?: string;
    [key: string]: unknown;
  };
  receivedAt: number;
}

export interface SystemInfo {
  deviceName: string;
  macOS: string;
  chip: string;
  memory: string;
  storage: { used: string; total: string };
  uptimeSeconds: number;
  tailscale: string;
}

export interface ModuleInfo {
  id: string;
  name: string;
  state: "connected" | "readOnly" | "planned";
}

export interface BootstrapData {
  connected: boolean;
  threads: CodexThread[];
  rateLimits: RateLimitSnapshot | null;
  approvals: PendingApproval[];
  system: SystemInfo;
  modules: ModuleInfo[];
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
}

export interface UploadAttachment {
  id: string;
  name: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  size: number;
}
