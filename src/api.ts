import type { BootstrapData, CodexThread, DirectoryListing, GhosttyOutput, GhosttyRelay, GhosttySnapshot, UploadAttachment } from "./types";

export const bridgeUnavailableMessage = "与 Mac 的连接短暂中断，正在自动重连…";

export function isBridgeUnavailableError(cause: unknown): cause is Error {
  return cause instanceof Error && cause.message === bridgeUnavailableMessage;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const retryDelays = method === "GET" || method === "HEAD" ? [0, 250, 750] : [0];
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt] > 0) await wait(retryDelays[attempt]);
    try {
      return await fetch(input, init);
    } catch {
      if (attempt === retryDelays.length - 1) throw new Error(bridgeUnavailableMessage);
    }
  }
  throw new Error(bridgeUnavailableMessage);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await bridgeFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? `请求失败 (${response.status})`);
  return payload;
}

export const api = {
  health: () => request<{ ok: boolean; paired: boolean }>("/api/health"),
  pair: (code: string) => request<{ ok: boolean }>("/api/pair", { method: "POST", body: JSON.stringify({ code }) }),
  bootstrap: () => request<BootstrapData>("/api/bootstrap"),
  ghostty: () => request<GhosttySnapshot>("/api/ghostty"),
  startDedicatedGhosttyRelay: () => request<{ terminal: { id: string; title: string; workingDirectory: string }; relay: GhosttyRelay }>("/api/ghostty/dedicated-relay", { method: "POST" }),
  sendGhosttyInput: (terminalId: string, text: string) => request<{ ok: boolean }>(`/api/ghostty/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: "POST",
    body: JSON.stringify({ text }),
  }),
  startGhosttyRelay: (terminalId: string) => request<GhosttyRelay>(`/api/ghostty/terminals/${encodeURIComponent(terminalId)}/relay`, { method: "POST" }),
  stopGhosttyRelay: (terminalId: string) => request<GhosttyRelay>(`/api/ghostty/terminals/${encodeURIComponent(terminalId)}/relay`, { method: "DELETE" }),
  ghosttyOutput: (terminalId: string, cursor?: number) => request<GhosttyOutput>(`/api/ghostty/terminals/${encodeURIComponent(terminalId)}/output${cursor === undefined ? "" : `?cursor=${cursor}`}`),
  removeDevice: (id: string) => request<{ ok: boolean }>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  thread: (id: string) => request<CodexThread>(`/api/threads/${encodeURIComponent(id)}`),
  send: (id: string, text: string, attachmentIds: string[] = []) => request<{ ok: boolean }>(`/api/threads/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, attachmentIds }),
  }),
  uploadImage: async (file: File): Promise<UploadAttachment> => {
    const response = await bridgeFetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string } & UploadAttachment;
    if (!response.ok) throw new Error(payload.error ?? `图片上传失败 (${response.status})`);
    return payload;
  },
  deleteUpload: (id: string) => request<{ ok: boolean }>(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  interrupt: (id: string) => request<{ ok: boolean }>(`/api/threads/${encodeURIComponent(id)}/interrupt`, { method: "POST" }),
  createThread: (cwd: string, text: string) => request<CodexThread>("/api/threads", {
    method: "POST",
    body: JSON.stringify({ cwd, text }),
  }),
  decide: (key: string, decision: "decline" | "accept" | "acceptForSession") => request<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  }),
  answer: (key: string, answers: Record<string, string[]>) => request<{ ok: boolean }>(`/api/questions/${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  }),
  directories: (path?: string) => request<DirectoryListing>(`/api/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`),
};
