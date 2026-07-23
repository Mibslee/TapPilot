import { execFileSync } from "node:child_process";
import { readdir, realpath, stat, statfs } from "node:fs/promises";
import { homedir, hostname, platform, release, totalmem, uptime } from "node:os";
import { isAbsolute, join, normalize, parse } from "node:path";

function command(binary: string, args: string[]): string | null {
  try {
    return execFileSync(binary, args, { encoding: "utf8", timeout: 2_000 }).trim() || null;
  } catch {
    return null;
  }
}

function bytes(value: number): string {
  const units = ["B", "GB", "TB"];
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)} MB`;
  const unit = value >= 1_000_000_000_000 ? 2 : 1;
  return `${(value / 1000 ** (unit + 2)).toFixed(1)} ${units[unit]}`;
}

export async function readSystemInfo() {
  const volume = await statfs("/");
  const total = volume.blocks * volume.bsize;
  const free = volume.bavail * volume.bsize;
  return {
    deviceName: command("/usr/sbin/scutil", ["--get", "ComputerName"]) ?? hostname(),
    macOS: command("/usr/bin/sw_vers", ["-productVersion"]) ?? release(),
    chip: command("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]) ?? "Apple Silicon",
    memory: bytes(totalmem()),
    storage: { used: bytes(total - free), total: bytes(total) },
    uptimeSeconds: Math.round(uptime()),
    tailscale: command("/usr/bin/pgrep", ["-x", "Tailscale"]) ? "已连接" : "未检测到",
    platform: platform(),
  };
}

export async function listDirectories(requestedPath?: string) {
  const input = requestedPath?.trim() || join(homedir(), "Documents");
  if (!isAbsolute(input)) throw new Error("目录路径必须是绝对路径");
  const target = await realpath(normalize(input));
  const targetStat = await stat(target);
  if (!targetStat.isDirectory()) throw new Error("所选路径不是目录");

  const entries = await readdir(target, { withFileTypes: true });
  const directories = entries
    .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()))
    .map((entry) => ({ name: entry.name, path: join(target, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const root = parse(target).root;
  return {
    path: target,
    parent: target === root ? null : normalize(join(target, "..")),
    directories,
  };
}
