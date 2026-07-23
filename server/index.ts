import { chmodSync, createReadStream, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { CodexClient } from "./codexClient.js";
import { isAuthenticated, pair, pairingCode, rotatePairingCredentials, stateDirectory } from "./auth.js";
import { syncThreadToDesktop } from "./desktopSync.js";
import { listDirectories, readSystemInfo } from "./systemInfo.js";
import { cleanupStaleImages, deleteImage, MAX_IMAGE_BYTES, resolveImages, storeImage } from "./uploads.js";
import { prepareThreadForWeb, readThreadImage } from "./threadImages.js";

const host = process.env.TAPPILOT_HOST ?? "127.0.0.1";
const tailscaleHost = process.env.TAPPILOT_TAILSCALE_HOST?.trim() || null;
const port = Number(process.env.TAPPILOT_PORT ?? 8788);
const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const webRoot = [
  resolve(runtimeDirectory, "../web"),
  resolve(process.cwd(), "dist/web"),
  resolve(runtimeDirectory, "../dist/web"),
].find((candidate) => existsSync(join(candidate, "index.html"))) ?? resolve(process.cwd(), "dist/web");
const runtimeStatusPath = join(stateDirectory, "runtime.json");
const runtimeStatusTemporaryPath = join(stateDirectory, `runtime-${process.pid}.tmp`);
const codex = new CodexClient();
const sockets = new Set<WebSocket>();
type ConnectedDevice = {
  id: string;
  label: string;
  platform: "phone" | "tablet" | "computer" | "unknown";
  route: "本机" | "Tailscale";
  connectedAt: string;
};
const connectedDevices = new Map<string, { device: ConnectedDevice; connections: number }>();
const startedAt = new Date().toISOString();
let codexConnected = false;
let tailscaleListening = false;
let isShuttingDown = false;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function writeRuntimeStatus(): void {
  const status = {
    pid: process.pid,
    host,
    port,
    pairingCode,
    startedAt,
    codexConnected,
    codexConnectionMode: codex.connectionMode,
    localUrl: `http://${host}:${port}`,
    tailscaleHost,
    tailscaleUrl: tailscaleHost ? `http://${tailscaleHost}:${port}` : null,
    tailscaleListening,
    connectedDevices: [...connectedDevices.values()].map(({ device }) => device),
  };
  writeFileSync(runtimeStatusTemporaryPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  renameSync(runtimeStatusTemporaryPath, runtimeStatusPath);
  chmodSync(runtimeStatusPath, 0o600);
}

function describeDevice(request: IncomingMessage): ConnectedDevice {
  const userAgent = String(request.headers["user-agent"] ?? "未知浏览器");
  const platform: ConnectedDevice["platform"] = /iPad/i.test(userAgent)
    ? "tablet"
    : /iPhone|Android.*Mobile/i.test(userAgent) ? "phone"
    : /Macintosh|Windows|Linux/i.test(userAgent) ? "computer" : "unknown";
  const deviceName = /iPad/i.test(userAgent) ? "iPad"
    : /iPhone/i.test(userAgent) ? "iPhone"
    : /Android/i.test(userAgent) ? "Android 手机"
    : /Macintosh/i.test(userAgent) ? "Mac"
    : /Windows/i.test(userAgent) ? "Windows 电脑" : "浏览器设备";
  const browser = /CriOS|Chrome/i.test(userAgent) ? "Chrome"
    : /FxiOS|Firefox/i.test(userAgent) ? "Firefox"
    : /EdgiOS|Edg\//i.test(userAgent) ? "Edge"
    : /Safari/i.test(userAgent) ? "Safari" : "浏览器";
  const remoteAddress = request.socket.remoteAddress ?? "";
  const route: ConnectedDevice["route"] = request.socket.localAddress === tailscaleHost || /^(::ffff:)?100\./.test(remoteAddress)
    ? "Tailscale" : "本机";
  const id = createHash("sha256").update(`${remoteAddress}\0${userAgent}`).digest("hex").slice(0, 12);
  return { id, label: `${deviceName} · ${browser}`, platform, route, connectedAt: new Date().toISOString() };
}

function removeOwnedRuntimeStatus(): void {
  try {
    const status = JSON.parse(readFileSync(runtimeStatusPath, "utf8")) as { pid?: number };
    if (status.pid === process.pid) unlinkSync(runtimeStatusPath);
  } catch {
    // Missing or replaced status belongs to no process this instance can safely clean up.
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 256_000) throw new Error("请求内容过大");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function binaryBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("单张图片不能超过 8 MB");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) throw new Error("单张图片不能超过 8 MB");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload, at: Date.now() });
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function mime(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}

function serveWeb(request: IncomingMessage, response: ServerResponse, pathname: string): boolean {
  if (!existsSync(webRoot)) return false;
  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = resolve(webRoot, normalize(requestPath));
  if (!filePath.startsWith(`${webRoot}/`) && filePath !== join(webRoot, "index.html")) return false;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(webRoot, "index.html");
  response.writeHead(200, { "Content-Type": mime(filePath), "Cache-Control": "no-cache" });
  createReadStream(filePath).pipe(response);
  return true;
}

const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, paired: isAuthenticated(request) });
      return;
    }

    if (url.pathname === "/api/pair" && request.method === "POST") {
      const payload = await body(request);
      if (!pair(String(payload.code ?? ""), response)) {
        sendJson(response, 401, { error: "配对码不正确" });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith("/api/") && !isAuthenticated(request)) {
      sendJson(response, 401, { error: "需要先与这台 Mac 配对" });
      return;
    }

    if (url.pathname === "/api/bootstrap") {
      const [threads, rateLimits, system] = await Promise.all([
        codex.listThreads(5),
        codex.rateLimits().catch(() => null),
        readSystemInfo(),
      ]);
      sendJson(response, 200, {
        connected: true,
        codexConnectionMode: codex.connectionMode,
        threads,
        rateLimits,
        approvals: codex.listApprovals(),
        system,
        modules: [
          { id: "codex", name: "Codex", state: "connected" },
          { id: "system", name: "系统设置", state: "readOnly" },
          { id: "minimax", name: "MiniMax Code", state: "planned" },
          { id: "ghostty", name: "Ghostty", state: "planned" },
          { id: "kaku", name: "Kaku", state: "planned" },
        ],
      });
      return;
    }

    if (url.pathname === "/api/uploads" && request.method === "POST") {
      let stored;
      try {
        const image = await binaryBody(request, MAX_IMAGE_BYTES);
        stored = storeImage(
          image,
          String(request.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase(),
          url.searchParams.get("name") ?? "",
        );
      } catch (error) {
        throw new RequestError(error instanceof Error ? error.message : "图片上传失败");
      }
      sendJson(response, 201, stored);
      return;
    }

    const uploadMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (uploadMatch && request.method === "DELETE") {
      deleteImage(decodeURIComponent(uploadMatch[1]));
      sendJson(response, 200, { ok: true });
      return;
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (threadMatch && request.method === "GET") {
      sendJson(response, 200, prepareThreadForWeb(await codex.openThread(decodeURIComponent(threadMatch[1]))));
      return;
    }

    const threadImageMatch = url.pathname.match(/^\/api\/thread-images\/([a-f0-9]{32})$/);
    if (threadImageMatch && request.method === "GET") {
      const image = await readThreadImage(threadImageMatch[1]);
      if (!image) {
        sendJson(response, 404, { error: "图片已失效，请刷新任务" });
        return;
      }
      response.writeHead(200, {
        "Content-Type": image.mime,
        "Content-Length": image.size,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(image.data);
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
    if (messageMatch && request.method === "POST") {
      const payload = await body(request);
      const text = String(payload.text ?? "").trim();
      const attachmentIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds.map(String) : [];
      if (!text && !attachmentIds.length) throw new Error("请输入指令或添加图片");
      const imagePaths = resolveImages(attachmentIds);
      const threadId = decodeURIComponent(messageMatch[1]);
      const thread = await codex.readThread(threadId);
      await codex.sendMessage(thread, text, imagePaths);
      syncThreadToDesktop(threadId, (error) => console.error("无法同步打开电脑 Codex:", error));
      sendJson(response, 202, { ok: true });
      return;
    }

    const interruptMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/);
    if (interruptMatch && request.method === "POST") {
      const thread = await codex.readThread(decodeURIComponent(interruptMatch[1]));
      await codex.interrupt(thread);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/threads" && request.method === "POST") {
      const payload = await body(request);
      const cwd = String(payload.cwd ?? "").trim();
      const text = String(payload.text ?? "").trim();
      if (!cwd || !text) throw new Error("请选择工作目录并填写初始指令");
      const thread = await codex.createThread(cwd, text);
      syncThreadToDesktop(thread.id, (error) => console.error("无法同步打开电脑 Codex:", error));
      sendJson(response, 201, thread);
      return;
    }

    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (approvalMatch && request.method === "POST") {
      const payload = await body(request);
      const decision = String(payload.decision ?? "") as "decline" | "accept" | "acceptForSession";
      if (!["decline", "accept", "acceptForSession"].includes(decision)) throw new Error("无效的审批决定");
      const approval = codex.resolveApproval(decodeURIComponent(approvalMatch[1]), decision);
      const threadId = typeof approval.params.threadId === "string" ? approval.params.threadId : null;
      if (threadId) syncThreadToDesktop(threadId, (error) => console.error("无法同步打开电脑 Codex:", error));
      sendJson(response, 200, { ok: true });
      return;
    }

    const answerMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
    if (answerMatch && request.method === "POST") {
      const payload = await body(request);
      const rawAnswers = payload.answers;
      if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) throw new Error("回答内容无效");
      const answers = Object.fromEntries(
        Object.entries(rawAnswers).map(([id, value]) => [id, Array.isArray(value) ? value.map(String) : [String(value)]]),
      );
      const approval = codex.answerUserInput(decodeURIComponent(answerMatch[1]), answers);
      const threadId = typeof approval.params.threadId === "string" ? approval.params.threadId : null;
      if (threadId) syncThreadToDesktop(threadId, (error) => console.error("无法同步打开电脑 Codex:", error));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/directories" && request.method === "GET") {
      sendJson(response, 200, await listDirectories(url.searchParams.get("path") ?? undefined));
      return;
    }

    if (url.pathname === "/api/system" && request.method === "GET") {
      sendJson(response, 200, await readSystemInfo());
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "接口不存在" });
      return;
    }

    if (!serveWeb(request, response, url.pathname)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("TapPilot web build not found. Run npm run dev or npm run build.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    sendJson(response, error instanceof RequestError ? error.status : 500, { error: message });
  }
};

const server = createServer(requestHandler);
let tailscaleServer: ReturnType<typeof createServer> | null = null;

const wss = new WebSocketServer({ noServer: true });
function attachUpgradeHandler(target: ReturnType<typeof createServer>): void {
  target.on("upgrade", (request, socket, head) => {
    if (request.url !== "/events" || !isAuthenticated(request)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => wss.emit("connection", websocket, request));
  });
}
attachUpgradeHandler(server);

wss.on("connection", (socket, request) => {
  sockets.add(socket);
  const device = describeDevice(request);
  const existing = connectedDevices.get(device.id);
  connectedDevices.set(device.id, existing
    ? { device: { ...existing.device, route: device.route }, connections: existing.connections + 1 }
    : { device, connections: 1 });
  if (!isShuttingDown) writeRuntimeStatus();
  socket.send(JSON.stringify({ type: "connected", at: Date.now() }));
  broadcast("devices", [...connectedDevices.values()].map(({ device: current }) => current));
  socket.on("close", () => {
    sockets.delete(socket);
    const current = connectedDevices.get(device.id);
    if (current && current.connections > 1) connectedDevices.set(device.id, { ...current, connections: current.connections - 1 });
    else connectedDevices.delete(device.id);
    if (!isShuttingDown) writeRuntimeStatus();
    broadcast("devices", [...connectedDevices.values()].map(({ device: active }) => active));
  });
});

codex.on("notification", (notification) => broadcast("codex", notification));
codex.on("approval", (approval) => broadcast("approval", approval));
codex.on("approvalResolved", (result) => broadcast("approvalResolved", result));
codex.on("online", () => {
  codexConnected = true;
  if (!isShuttingDown) writeRuntimeStatus();
});
codex.on("offline", (reason) => {
  codexConnected = false;
  if (!isShuttingDown) writeRuntimeStatus();
  broadcast("offline", { reason });
});

server.listen(port, host, async () => {
  cleanupStaleImages();
  console.log(`TapPilot Bridge: http://${host}:${port}`);
  console.log(`本次启动配对码: ${pairingCode}`);
  writeRuntimeStatus();
  if (host !== "127.0.0.1" && host !== "::1") {
    console.warn("当前监听非回环地址；请确认该地址仅可通过可信的 Tailscale 网络访问。");
  }
  if (tailscaleHost && tailscaleHost !== host) {
    tailscaleServer = createServer(requestHandler);
    attachUpgradeHandler(tailscaleServer);
    tailscaleServer.on("error", (error) => {
      tailscaleListening = false;
      if (!isShuttingDown) writeRuntimeStatus();
      console.error(`Tailscale 地址监听失败 (${tailscaleHost}:${port}):`, error);
    });
    tailscaleServer.listen(port, tailscaleHost, () => {
      tailscaleListening = true;
      console.log(`TapPilot Tailscale: http://${tailscaleHost}:${port}`);
      writeRuntimeStatus();
    });
  }
  try {
    await codex.start();
    console.log("Codex app-server 已连接");
  } catch (error) {
    console.error("Codex app-server 连接失败:", error);
  }
});

function shutdown(): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  for (const socket of sockets) socket.close(1001, "TapPilot Bridge 正在关闭");
  wss.close();
  codex.close();
  removeOwnedRuntimeStatus();
  tailscaleServer?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
function resetPairingCredentials(): void {
  if (isShuttingDown) return;
  rotatePairingCredentials();
  writeRuntimeStatus();
  for (const socket of sockets) socket.close(4001, "TapPilot 配对已重置");
  console.log(`配对凭据已刷新，新配对码: ${pairingCode}`);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", resetPairingCredentials);
