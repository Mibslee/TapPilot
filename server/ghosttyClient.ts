import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { stateDirectory } from "./auth.js";

const execFileAsync = promisify(execFile);
const ghosttyAppPath = "/Applications/Ghostty.app";
const fieldSeparator = String.fromCharCode(31);
const relayDirectory = join(stateDirectory, "ghostty-relays");
const maximumOutputBytes = 64 * 1024;

export type GhosttyStatus = "ready" | "notRunning" | "notInstalled" | "unsupported" | "needsAutomationPermission" | "unavailable";

export type GhosttyTerminal = {
  id: string;
  title: string;
  workingDirectory: string;
};

export type GhosttyRelay = {
  id: string;
  terminalId: string;
  startedAt: string;
  status: "capturing" | "stopped";
};

type StoredGhosttyRelay = GhosttyRelay & { logPath: string };

export type GhosttySnapshot = {
  installed: boolean;
  version: string | null;
  running: boolean;
  status: GhosttyStatus;
  detail: string;
  terminals: GhosttyTerminal[];
  relays: GhosttyRelay[];
};

export class GhosttyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: unknown; stderr?: unknown };
  return [value.stderr, value.message].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n");
}

function versionSupported(version: string | null): boolean {
  if (!version) return false;
  const [major, minor] = version.split(".").map((part) => Number(part));
  return Number.isFinite(major) && Number.isFinite(minor) && (major > 1 || (major === 1 && minor >= 3));
}

export function parseGhosttyTerminals(output: string): GhosttyTerminal[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [id, title, workingDirectory] = line.split(fieldSeparator);
    if (!id?.trim()) return [];
    return [{ id: id.trim(), title: title?.trim() || "未命名终端", workingDirectory: workingDirectory?.trim() || "—" }];
  });
}

export function cleanGhosttyOutput(output: string): string {
  return output
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g, "");
}

const listTerminalsScript = `
tell application "Ghostty"
  set fieldDelimiter to ASCII character 31
  set rowDelimiter to linefeed
  set rows to {}
  repeat with aWindow in windows
    repeat with aTab in tabs of aWindow
      repeat with aTerminal in terminals of aTab
        set end of rows to ((id of aTerminal as text) & fieldDelimiter & (name of aTerminal as text) & fieldDelimiter & (working directory of aTerminal as text))
      end repeat
    end repeat
  end repeat
  set AppleScript's text item delimiters to rowDelimiter
  return rows as text
end tell
`;

const sendTextScript = `
on run argv
  if (count of argv) is not 2 then error "Ghostty 命令参数无效"
  set terminalId to item 1 of argv
  set commandText to item 2 of argv
  tell application "Ghostty"
    set selectedTerminal to first terminal whose id is terminalId
    input text commandText to selectedTerminal
    send key "enter" to selectedTerminal
  end tell
end run
`;

// Ghostty 1.3 exposes windows, tabs and terminals through its native
// AppleScript dictionary. A dedicated tab keeps TapPilot's recorder out of a
// shell the user may already be using for unrelated work.
const createDedicatedTerminalScript = `
tell application "Ghostty"
  activate
  if (count of windows) is 0 then
    set targetWindow to make new window
    set targetTab to selected tab of targetWindow
  else
    set targetWindow to front window
    set targetTab to new tab in targetWindow
  end if
  delay 0.15
  set targetTerminal to focused terminal of targetTab
  return id of targetTerminal as text
end tell
`;

async function ghosttyIsRunning(): Promise<boolean> {
  try {
    const result = await execFileAsync("/usr/bin/osascript", ["-e", 'return application id "com.mitchellh.ghostty" is running'], { timeout: 1_500 });
    return result.stdout.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function plistValue(key: string): Promise<string | null> {
  try {
    const result = await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, `${ghosttyAppPath}/Contents/Info.plist`], { timeout: 1_500 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function automationDetail(error: unknown): string {
  const detail = errorText(error).toLowerCase();
  if (detail.includes("not authorized") || detail.includes("not permitted") || detail.includes("-1743")) {
    return "请在 Mac 本机的系统弹窗中允许 TapPilot 控制 Ghostty，然后回到这里刷新。";
  }
  if (detail.includes("not running")) return "Ghostty 未运行。请先在 Mac 上打开一个终端会话。";
  if (detail.includes("disabled") || detail.includes("doesn't understand")) return "Ghostty 的 AppleScript 自动化不可用；请确认未在配置中关闭 macos-applescript。";
  return "无法读取 Ghostty 会话。请确认 Ghostty 已打开，并在 Mac 本机的“系统设置 → 隐私与安全性 → 自动化”中允许 TapPilot 控制 Ghostty。";
}

function relayKey(terminalId: string): string {
  return createHash("sha256").update(terminalId).digest("hex");
}

function relayMetadataPath(terminalId: string): string {
  return join(relayDirectory, `${relayKey(terminalId)}.json`);
}

function publicRelay(relay: StoredGhosttyRelay): GhosttyRelay {
  return { id: relay.id, terminalId: relay.terminalId, startedAt: relay.startedAt, status: relay.status };
}

function readRelay(terminalId: string): StoredGhosttyRelay | null {
  try {
    const value = JSON.parse(readFileSync(relayMetadataPath(terminalId), "utf8")) as StoredGhosttyRelay;
    return value.terminalId === terminalId && value.logPath.startsWith(`${relayDirectory}/`) ? value : null;
  } catch {
    return null;
  }
}

function writeRelay(relay: StoredGhosttyRelay): void {
  mkdirSync(relayDirectory, { recursive: true, mode: 0o700 });
  const destination = relayMetadataPath(relay.terminalId);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(relay, null, 2), { mode: 0o600 });
  renameSync(temporary, destination);
}

function allRelays(): GhosttyRelay[] {
  try {
    return readdirSync(relayDirectory)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => {
        try { return [publicRelay(JSON.parse(readFileSync(join(relayDirectory, file), "utf8")) as StoredGhosttyRelay)]; }
        catch { return []; }
      });
  } catch {
    return [];
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class GhosttyClient {
  async snapshot(): Promise<GhosttySnapshot> {
    const installed = existsSync(ghosttyAppPath);
    if (!installed) return { installed: false, version: null, running: false, status: "notInstalled", detail: "未在 /Applications 找到 Ghostty。", terminals: [], relays: allRelays() };

    const version = await plistValue("CFBundleShortVersionString");
    if (!versionSupported(version)) return { installed: true, version, running: false, status: "unsupported", detail: "需要 Ghostty 1.3 或更高版本的 AppleScript 接口。", terminals: [], relays: allRelays() };

    const running = await ghosttyIsRunning();
    if (!running) return { installed: true, version, running: false, status: "notRunning", detail: "在 Mac 上打开 Ghostty 后，这里会显示终端会话。", terminals: [], relays: allRelays() };

    try {
      const result = await execFileAsync("/usr/bin/osascript", ["-e", listTerminalsScript], { timeout: 2_500 });
      const terminals = parseGhosttyTerminals(result.stdout);
      return { installed: true, version, running: true, status: "ready", detail: terminals.length ? "已连接到 Ghostty 会话。" : "Ghostty 已打开，但没有可用终端。", terminals, relays: allRelays() };
    } catch (error) {
      console.warn(`Ghostty AppleScript 会话读取失败：${errorText(error).slice(0, 600)}`);
      const detail = automationDetail(error);
      const status: GhosttyStatus = detail.includes("自动化") ? "needsAutomationPermission" : "unavailable";
      return { installed: true, version, running: true, status, detail, terminals: [], relays: allRelays() };
    }
  }

  async sendText(terminalId: string, text: string): Promise<void> {
    if (!terminalId.trim()) throw new GhosttyError("请选择要发送到的 Ghostty 终端");
    if (!text.trim()) throw new GhosttyError("请输入要发送到终端的内容");
    if (text.length > 10_000) throw new GhosttyError("单次发送不能超过 10,000 个字符");

    const state = await this.snapshot();
    if (state.status !== "ready") throw new GhosttyError(state.detail, state.status === "notInstalled" ? 404 : 409);
    if (!state.terminals.some((terminal) => terminal.id === terminalId)) throw new GhosttyError("该 Ghostty 终端已关闭，请刷新会话列表", 404);

    try {
      await execFileAsync("/usr/bin/osascript", ["-e", sendTextScript, "--", terminalId, text], { timeout: 4_000 });
    } catch (error) {
      console.warn(`Ghostty AppleScript 命令发送失败：${errorText(error).slice(0, 600)}`);
      throw new GhosttyError(automationDetail(error), 409);
    }
  }

  async createDedicatedTerminal(): Promise<GhosttyTerminal> {
    const state = await this.snapshot();
    if (!state.installed) throw new GhosttyError(state.detail, 404);
    if (!versionSupported(state.version)) throw new GhosttyError(state.detail, 409);
    try {
      const result = await execFileAsync("/usr/bin/osascript", ["-e", createDedicatedTerminalScript], { timeout: 4_000 });
      const terminalId = result.stdout.trim();
      if (!terminalId) throw new GhosttyError("Ghostty 没有返回新建终端，请在 Mac 上检查自动化权限", 409);
      // The terminal is created asynchronously by the app; allow its metadata
      // to settle once before returning a touch-safe selection to the phone.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const refreshed = await this.snapshot();
      const terminal = refreshed.terminals.find((item) => item.id === terminalId);
      if (!terminal) throw new GhosttyError("已新建 Ghostty 标签页，但暂时无法读取它。请刷新会话列表后重试。", 409);
      return terminal;
    } catch (error) {
      if (error instanceof GhosttyError) throw error;
      console.warn(`Ghostty AppleScript 受控终端创建失败：${errorText(error).slice(0, 600)}`);
      throw new GhosttyError(automationDetail(error), 409);
    }
  }

  async startRelay(terminalId: string): Promise<GhosttyRelay> {
    const existing = readRelay(terminalId);
    if (existing?.status === "capturing") return publicRelay(existing);

    const state = await this.snapshot();
    if (state.status !== "ready") throw new GhosttyError(state.detail, state.status === "notInstalled" ? 404 : 409);
    if (!state.terminals.some((terminal) => terminal.id === terminalId)) throw new GhosttyError("该 Ghostty 终端已关闭，请刷新会话列表", 404);

    mkdirSync(relayDirectory, { recursive: true, mode: 0o700 });
    const relay: StoredGhosttyRelay = {
      id: randomUUID(),
      terminalId,
      startedAt: new Date().toISOString(),
      status: "capturing",
      logPath: join(relayDirectory, `${randomUUID()}.log`),
    };
    writeFileSync(relay.logPath, "", { mode: 0o600 });
    writeRelay(relay);
    try {
      await this.sendText(terminalId, `/usr/bin/script -q -F ${shellQuote(relay.logPath)} /bin/zsh -il`);
      return publicRelay(relay);
    } catch (error) {
      try { unlinkSync(relayMetadataPath(terminalId)); } catch { /* task-owned metadata did not persist */ }
      try { unlinkSync(relay.logPath); } catch { /* task-owned output file did not persist */ }
      throw error;
    }
  }

  async stopRelay(terminalId: string): Promise<GhosttyRelay> {
    const relay = readRelay(terminalId);
    if (!relay) throw new GhosttyError("这个终端尚未开启手机输出同步", 404);
    if (relay.status === "capturing") await this.sendText(terminalId, "exit");
    const stopped = { ...relay, status: "stopped" as const };
    try { unlinkSync(relayMetadataPath(terminalId)); } catch { /* already removed */ }
    try { unlinkSync(relay.logPath); } catch { /* already removed */ }
    return publicRelay(stopped);
  }

  readRelayOutput(terminalId: string, cursor?: number): { relay: GhosttyRelay; cursor: number; hasMore: boolean; text: string } {
    const relay = readRelay(terminalId);
    if (!relay) throw new GhosttyError("请先在这个终端开启手机输出同步", 404);
    let size = 0;
    try { size = statSync(relay.logPath).size; }
    catch { return { relay: publicRelay(relay), cursor: 0, hasMore: false, text: "" }; }
    const requested = Number.isFinite(cursor) && cursor! >= 0 ? Math.floor(cursor!) : Math.max(0, size - maximumOutputBytes);
    const start = Math.min(requested, size);
    const length = Math.min(size - start, maximumOutputBytes);
    const output = Buffer.alloc(length);
    if (length > 0) {
      const descriptor = openSync(relay.logPath, "r");
      try { readSync(descriptor, output, 0, length, start); }
      finally { closeSync(descriptor); }
    }
    const nextCursor = start + length;
    return { relay: publicRelay(relay), cursor: nextCursor, hasMore: nextCursor < size, text: cleanGhosttyOutput(output.toString("utf8")) };
  }

  activeRelayTerminalIds(): string[] {
    return allRelays().filter((relay) => relay.status === "capturing").map((relay) => relay.terminalId);
  }
}
