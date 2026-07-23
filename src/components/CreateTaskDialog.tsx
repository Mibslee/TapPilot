import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, X } from "lucide-react";
import { api } from "../api";
import type { DirectoryListing } from "../types";

export function CreateTaskDialog({ busy, onClose, onCreate }: {
  busy: boolean;
  onClose: () => void;
  onCreate: (cwd: string, text: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");

  async function browse(path?: string) {
    try {
      setError("");
      setListing(await api.directories(path));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取目录");
    }
  }
  useEffect(() => { void browse(); }, []);

  return (
    <div className="modal-scrim" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <header><div><h2 id="new-task-title">新建任务</h2><p>沿用 Codex 当前模型与审批设置</p></div><button className="icon-button pressable" onClick={onClose} aria-label="关闭"><X /></button></header>
        <div className="form-field">
          <label>工作目录</label>
          <div className="directory-browser">
            <div className="directory-toolbar">
              <button disabled={!listing?.parent} className="icon-button pressable" onClick={() => void browse(listing?.parent ?? undefined)}><ArrowLeft /></button>
              <code>{listing?.path ?? "正在读取…"}</code>
              <button className="text-button pressable" disabled={!listing} onClick={() => setSelected(listing?.path ?? "")}>选择当前目录</button>
            </div>
            <div className="directory-list">
              {listing?.directories.map((directory) => (
                <button key={directory.path} className="directory-row pressable" onClick={() => void browse(directory.path)}>
                  <Folder size={19} /><span>{directory.name}</span><ChevronRight size={17} />
                </button>
              ))}
            </div>
          </div>
          {selected && <p className="selected-path">已选择：<code>{selected}</code></p>}
        </div>
        <div className="form-field"><label htmlFor="initial-prompt">初始指令</label><textarea id="initial-prompt" rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="告诉 Codex 要完成什么…" /></div>
        {error && <p className="inline-error">{error}</p>}
        <button className="button primary pressable" disabled={busy || !selected || !prompt.trim()} onClick={() => void onCreate(selected, prompt.trim())}>创建并开始</button>
      </section>
    </div>
  );
}
