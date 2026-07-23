import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WebSocket } from "ws";
import type {
  CodexThread,
  JsonObject,
  PendingApproval,
  RateLimitSnapshot,
} from "./types.js";

type RpcId = number | string;
type RpcResponse = { id: RpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } };
type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const CODEX_BINARY =
  process.env.TAPPILOT_CODEX_BINARY ??
  "/Applications/ChatGPT.app/Contents/Resources/codex";

export class CodexClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: WebSocket | null = null;
  private connection: "sharedDaemon" | "isolated" = "isolated";
  private nextId = 1;
  private pending = new Map<RpcId, PendingRequest>();
  private approvals = new Map<string, PendingApproval>();
  private approvalIdentityToKey = new Map<string, string>();
  private approvalIdentityByKey = new Map<string, string>();
  private approvalRequestIds = new Map<string, RpcId[]>();
  private openedThreads = new Set<string>();
  private readyPromise: Promise<void> | null = null;

  get connectionMode(): "sharedDaemon" | "isolated" {
    return this.connection;
  }

  start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.launch();
    return this.readyPromise;
  }

  private async launch(): Promise<void> {
    try {
      await this.ensureSharedDaemon();
      await this.connectSharedDaemon();
      this.connection = "sharedDaemon";
    } catch (error) {
      this.socket?.close();
      this.socket = null;
      this.connection = "isolated";
      this.emit("log", `共享 Codex 服务启动失败，暂用独立连接：${error instanceof Error ? error.message : String(error)}`);
      this.connectIsolatedServer();
    }

    await this.request("initialize", {
      clientInfo: { name: "tappilot", title: "TapPilot", version: "0.1.0" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.notify("initialized");
    this.emit("online");
  }

  private connectIsolatedServer(): void {
    this.child = spawn(CODEX_BINARY, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.child.on("exit", (code, signal) => {
      this.child = null;
      this.handleTransportClosed(`Codex app-server 已退出 (${code ?? signal ?? "unknown"})`);
    });
    this.child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit("log", message);
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
  }

  private connectSharedDaemon(): Promise<void> {
    const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
    const socketPath = join(codexHome, "app-server-control", "app-server-control.sock");
    return new Promise((resolve, reject) => {
      const socket = new WebSocket("ws://localhost/rpc", {
        createConnection: () => createConnection(socketPath),
        // The Codex control socket intentionally negotiates no WebSocket
        // extensions. `ws` enables permessage-deflate by default, which the
        // daemon rejects during the upgrade handshake.
        perMessageDeflate: false,
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error("共享 Codex WebSocket 握手超时"));
      }, 5_000);
      timer.unref();
      socket.once("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("message", (data) => this.handleLine(String(data)));
        socket.on("close", (code, reason) => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.handleTransportClosed(`Codex 共享服务已断开 (${code}${reason.length ? `: ${String(reason)}` : ""})`);
        });
        socket.on("error", (error) => this.emit("log", `Codex 共享连接异常：${error.message}`));
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private handleTransportClosed(reason: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    this.pending.clear();
    this.openedThreads.clear();
    this.clearApprovals();
    this.connection = "isolated";
    this.readyPromise = null;
    this.emit("offline", reason);
  }

  private ensureSharedDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(CODEX_BINARY, ["app-server", "daemon", "start"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("启动超时"));
      }, 15_000);
      timer.unref();
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 4_000) stderr += String(chunk);
      });
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        if (code === 0) finish();
        else finish(new Error(stderr.trim() || `退出状态 ${code ?? signal ?? "unknown"}`));
      });
    });
  }

  private handleLine(line: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(line) as JsonObject;
    } catch {
      this.emit("log", `无法解析 app-server 输出: ${line.slice(0, 240)}`);
      return;
    }

    const id = message.id as RpcId | undefined;
    const method = message.method as string | undefined;

    if (method && id !== undefined) {
      this.handleServerRequest(id, method, (message.params ?? {}) as JsonObject);
      return;
    }

    if (method) {
      this.emit("notification", { method, params: message.params ?? {} });
      return;
    }

    if (id !== undefined) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      const response = message as RpcResponse;
      if (response.error) {
        pending.reject(new Error(`${response.error.message} (${response.error.code})`));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private handleServerRequest(id: RpcId, method: string, params: JsonObject): void {
    if (method.includes("requestApproval") || method === "execCommandApproval" || method === "applyPatchApproval") {
      this.capturePendingRequest(id, method, params);
      return;
    }

    if (method === "item/tool/requestUserInput") {
      this.capturePendingRequest(id, method, params);
      return;
    }

    this.write({ id, error: { code: -32601, message: `TapPilot 暂不支持请求: ${method}` } });
  }

  private capturePendingRequest(id: RpcId, method: string, params: JsonObject): void {
    const identity = [
      method,
      String(params.threadId ?? ""),
      String(params.turnId ?? ""),
      String(params.itemId ?? ""),
      String(params.approvalId ?? ""),
    ].join(":");
    const existingKey = this.approvalIdentityToKey.get(identity);
    if (existingKey) {
      const requestIds = this.approvalRequestIds.get(existingKey) ?? [];
      if (!requestIds.includes(id)) requestIds.push(id);
      this.approvalRequestIds.set(existingKey, requestIds);
      return;
    }

    const key = `${String(id)}-${Date.now()}`;
    const approval: PendingApproval = { key, requestId: id, method, params, receivedAt: Date.now() };
    this.approvals.set(key, approval);
    this.approvalIdentityToKey.set(identity, key);
    this.approvalIdentityByKey.set(key, identity);
    this.approvalRequestIds.set(key, [id]);
    this.emit("approval", approval);
  }

  private clearApproval(key: string): void {
    const identity = this.approvalIdentityByKey.get(key);
    if (identity) this.approvalIdentityToKey.delete(identity);
    this.approvalIdentityByKey.delete(key);
    this.approvalRequestIds.delete(key);
    this.approvals.delete(key);
  }

  private clearApprovals(): void {
    this.approvals.clear();
    this.approvalIdentityToKey.clear();
    this.approvalIdentityByKey.clear();
    this.approvalRequestIds.clear();
  }

  private write(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return;
    }
    if (this.child?.stdin.writable) {
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
      return;
    }
    throw new Error("Codex app-server 尚未连接");
  }

  private notify(method: string, params?: JsonObject): void {
    this.write(params ? { method, params } : { method });
  }

  async request<T>(method: string, params?: unknown, timeoutMs = 20_000): Promise<T> {
    if (!this.child && !this.socket) {
      if (method !== "initialize") await this.start();
    }
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject, timer });
    });
    this.write(params === undefined ? { id, method } : { id, method, params });
    return promise;
  }

  async listThreads(limit = 5): Promise<CodexThread[]> {
    await this.start();
    const result = await this.request<{ data: CodexThread[] }>("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
    });
    return result.data;
  }

  async readThread(threadId: string): Promise<CodexThread> {
    await this.start();
    const result = await this.request<{ thread: CodexThread }>("thread/read", {
      threadId,
      includeTurns: true,
    }, 30_000);
    return result.thread;
  }

  async openThread(threadId: string): Promise<CodexThread> {
    await this.start();
    if (this.openedThreads.has(threadId)) return this.readThread(threadId);
    const result = await this.request<{ thread: CodexThread }>("thread/resume", {
      threadId,
      // TapPilot is an interactive client. Route Codex approval callbacks to
      // this app-server so the paired phone can render and answer them.
      approvalsReviewer: "user",
    }, 30_000);
    this.openedThreads.add(threadId);
    return result.thread;
  }

  async rateLimits(): Promise<RateLimitSnapshot | null> {
    await this.start();
    const result = await this.request<{
      rateLimits: RateLimitSnapshot;
      rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null;
    }>("account/rateLimits/read");
    return result.rateLimitsByLimitId?.codex ?? result.rateLimits ?? null;
  }

  async sendMessage(thread: CodexThread, text: string, imagePaths: string[] = []): Promise<unknown> {
    const input: Array<Record<string, unknown>> = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    input.push(...imagePaths.map((path) => ({ type: "localImage", path })));
    if (!input.length) throw new Error("请输入指令或添加图片");
    // `thread/read` can read a persisted thread without loading it into this
    // app-server process. A turn can only be started or steered after resume.
    // Resume also closes the race where another Codex client started a turn
    // between the list/read request and this send request.
    const current = await this.openThread(thread.id);
    if (current.status.type === "active") {
      const activeTurn = [...current.turns].reverse().find((turn) => turn.status === "inProgress");
      if (!activeTurn) throw new Error("任务显示运行中，但未找到活动 Turn，请刷新后重试");
      return this.request("turn/steer", {
        threadId: current.id,
        expectedTurnId: activeTurn.id,
        input,
      });
    }
    return this.request("turn/start", {
      threadId: current.id,
      input,
      approvalsReviewer: "user",
    }, 30_000);
  }

  async createThread(cwd: string, text: string): Promise<CodexThread> {
    const started = await this.request<{ thread: CodexThread }>("thread/start", {
      cwd,
      approvalsReviewer: "user",
    });
    await this.request("turn/start", {
      threadId: started.thread.id,
      input: [{ type: "text", text, text_elements: [] }],
      approvalsReviewer: "user",
    }, 30_000);
    return started.thread;
  }

  async interrupt(thread: CodexThread): Promise<void> {
    const activeTurn = [...thread.turns].reverse().find((turn) => turn.status === "inProgress");
    if (!activeTurn) throw new Error("没有可中断的运行步骤");
    await this.request("turn/interrupt", { threadId: thread.id, turnId: activeTurn.id });
  }

  listApprovals(): PendingApproval[] {
    return [...this.approvals.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  }

  resolveApproval(key: string, decision: "decline" | "accept" | "acceptForSession"): PendingApproval {
    const approval = this.approvals.get(key);
    if (!approval) throw new Error("该审批已处理或已失效");

    if (approval.method === "item/tool/requestUserInput") {
      throw new Error("补充问题必须通过专用回答表单处理");
    }

    let result: unknown;
    if (approval.method === "item/permissions/requestApproval") {
      const requested = (approval.params.permissions ?? {}) as Record<string, unknown>;
      const permissions = decision === "decline"
        ? {}
        : Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== null));
      result = { permissions, scope: decision === "acceptForSession" ? "session" : "turn" };
    } else if (approval.method === "execCommandApproval" || approval.method === "applyPatchApproval") {
      const legacyDecision = decision === "decline" ? "denied" : decision === "acceptForSession" ? "approved_for_session" : "approved";
      result = { decision: legacyDecision };
    } else {
      result = { decision };
    }
    for (const requestId of new Set(this.approvalRequestIds.get(key) ?? [approval.requestId])) {
      this.write({ id: requestId, result });
    }
    this.clearApproval(key);
    this.emit("approvalResolved", { key, decision });
    return approval;
  }

  answerUserInput(key: string, answers: Record<string, string[]>): PendingApproval {
    const approval = this.approvals.get(key);
    if (!approval || approval.method !== "item/tool/requestUserInput") {
      throw new Error("该补充问题已处理或已失效");
    }
    const payload = Object.fromEntries(
      Object.entries(answers).map(([id, values]) => [id, { answers: values }]),
    );
    for (const requestId of new Set(this.approvalRequestIds.get(key) ?? [approval.requestId])) {
      this.write({ id: requestId, result: { answers: payload } });
    }
    this.clearApproval(key);
    this.emit("approvalResolved", { key, decision: "answered" });
    return approval;
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "TapPilot Bridge 正在关闭");
    this.child?.kill("SIGTERM");
    this.child = null;
    this.openedThreads.clear();
    this.clearApprovals();
    this.connection = "isolated";
    this.readyPromise = null;
  }
}
