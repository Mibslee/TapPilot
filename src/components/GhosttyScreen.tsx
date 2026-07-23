import { ArrowLeft, CircleAlert, Eye, EyeOff, Play, Plus, RefreshCw, Send, ShieldAlert, Square, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GhosttyOutput, GhosttySnapshot } from "../types";

type Props = {
  snapshot: GhosttySnapshot;
  busy: boolean;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onSend: (terminalId: string, text: string) => Promise<boolean>;
  onStartDedicatedRelay: () => Promise<string | null>;
  onStartRelay: (terminalId: string) => Promise<boolean>;
  onStopRelay: (terminalId: string) => Promise<boolean>;
  onReadOutput: (terminalId: string, cursor?: number) => Promise<GhosttyOutput>;
  outputSignal: number;
};

function compactDirectory(path: string): string {
  const homeRelative = path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
  return homeRelative.length > 54 ? `…${homeRelative.slice(-53)}` : homeRelative;
}

export function GhosttyScreen({ snapshot, busy, onBack, onRefresh, onSend, onStartDedicatedRelay, onStartRelay, onStopRelay, onReadOutput, outputSignal }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.terminals[0]?.id ?? null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const cursor = useRef<number | undefined>(undefined);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (selectedId && snapshot.terminals.some((terminal) => terminal.id === selectedId)) return;
    setSelectedId(snapshot.terminals[0]?.id ?? null);
  }, [selectedId, snapshot.terminals]);

  const selected = snapshot.terminals.find((terminal) => terminal.id === selectedId) ?? null;
  const relay = selected ? snapshot.relays.find((item) => item.terminalId === selected.id) ?? null : null;
  const recording = relay?.status === "capturing";
  const canSend = snapshot.status === "ready" && Boolean(selected) && Boolean(text.trim()) && !sending;

  useEffect(() => {
    cursor.current = undefined;
    setOutput("");
    setConfirmTakeover(false);
  }, [selectedId, relay?.id]);

  useEffect(() => {
    if (!selected || !recording) return;
    let disposed = false;
    const read = async () => {
      try {
        const page = await onReadOutput(selected.id, cursor.current);
        if (disposed) return;
        cursor.current = page.cursor;
        if (page.text) setOutput((previous) => `${previous}${page.text}`.slice(-120_000));
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "无法读取终端输出");
      }
    };
    void read();
    return () => { disposed = true; };
  }, [onReadOutput, outputSignal, recording, selected]);

  useEffect(() => {
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [output]);

  return (
    <main className="ghostty-screen">
      <header className="detail-header glass ghostty-header">
        <button className="icon-button pressable" onClick={onBack} aria-label="返回"><ArrowLeft /></button>
        <div><TerminalSquare size={20} /><h1>Ghostty</h1></div>
        <button className="icon-button pressable" onClick={() => void onRefresh()} aria-label="刷新 Ghostty 会话" disabled={busy}><RefreshCw className={busy ? "spin" : ""} /></button>
      </header>

      <div className="ghostty-content">
        <section className={`ghostty-status ${snapshot.status}`}>
          <TerminalSquare size={22} />
          <div><strong>{snapshot.status === "ready" ? "Ghostty 已接入" : "等待 Ghostty 就绪"}</strong><p>{snapshot.detail}</p></div>
        </section>

        <section>
          <div className="section-title-row"><h2>已打开的终端</h2><span>{snapshot.version ? `Ghostty ${snapshot.version}` : ""}</span></div>
          {snapshot.terminals.length ? (
            <div className="ghostty-terminal-list">
              {snapshot.terminals.map((terminal) => {
                const isSelected = terminal.id === selectedId;
                const isRecording = snapshot.relays.some((item) => item.terminalId === terminal.id && item.status === "capturing");
                return <button key={terminal.id} className={`ghostty-terminal pressable ${isSelected ? "selected" : ""}`} onClick={() => setSelectedId(terminal.id)}>
                  <span className="terminal-radio" aria-hidden="true" />
                  <span><strong>{terminal.title}</strong><code title={terminal.workingDirectory}>{compactDirectory(terminal.workingDirectory)}</code></span>
                  {isRecording && <span className="relay-mark">同步中</span>}
                </button>;
              })}
            </div>
          ) : <p className="empty-copy">当前没有可供手机选择的 Ghostty 终端。</p>}
        </section>

        <section className="ghostty-output-card">
          <div className="section-title-row"><h2>手机输出</h2>{recording ? <span className="output-live"><i />实时同步</span> : <span>尚未接管</span>}</div>
          {selected && !recording && <div className="relay-empty"><Eye size={21} /><div><strong>优先新建受控终端</strong><p>默认会新建一个 Ghostty 标签页，再开始记录。已有工作终端不会被修改；接管已有终端需要再次确认。</p></div></div>}
          {selected && recording && <pre ref={outputRef} className="ghostty-output" aria-live="polite">{output || "正在等待终端输出…"}</pre>}
          {!selected && <p className="empty-copy">选择一个终端后即可开启手机输出。</p>}
          {selected && (recording ? <button className="button secondary pressable" disabled={busy} onClick={async () => {
            const stopped = await onStopRelay(selected.id);
            if (!stopped) setError("未能停止同步；请先检查当前 Ghostty 会话。");
          }}><Square size={16} />结束本次同步</button> : <div className="relay-actions">
            <button className="button primary pressable" disabled={busy || snapshot.status !== "ready"} onClick={async () => {
              const terminalId = await onStartDedicatedRelay();
              if (terminalId) { setSelectedId(terminalId); setError(""); }
              else setError("未能新建受控终端；请检查 Mac 上的 Ghostty 自动化授权。");
            }}><Plus size={17} />新建受控终端并同步</button>
            <button className="text-button pressable takeover-link" disabled={busy || snapshot.status !== "ready"} onClick={() => setConfirmTakeover(true)}><Play size={16} />接管当前终端</button>
          </div>)}
          {selected && !recording && confirmTakeover && <div className="takeover-confirm" role="alertdialog" aria-live="polite"><ShieldAlert size={19} /><div><strong>确认接管“{selected.title}”</strong><p>TapPilot 会在这个终端启动受记录的子 shell。它不会读取此前历史；停止同步会向该子 shell 发送 <code>exit</code>。</p><div className="takeover-confirm-actions"><button className="button outline pressable" onClick={() => setConfirmTakeover(false)}>取消</button><button className="button danger pressable" disabled={busy} onClick={async () => {
            const started = await onStartRelay(selected.id);
            if (started) { setConfirmTakeover(false); setError(""); }
            else setError("未能开启输出同步；请检查 Mac 上的 Ghostty 自动化授权。");
          }}>确认接管</button></div></div></div>}
        </section>

        <section className="ghostty-send-card">
          <div className="section-title-row"><h2>发送到指定终端</h2></div>
          {selected && <p className="selected-terminal-copy">目标：<strong>{selected.title}</strong>{recording ? " · 输出会同步到上方" : " · 未开启输出同步"}</p>}
          <textarea value={text} onInput={(event) => { setText(event.currentTarget.value); setError(""); }} placeholder="例如：git status" rows={4} disabled={!selected || snapshot.status !== "ready"} />
          <div className="ghostty-safety"><CircleAlert size={16} /><span>发送后会立即粘贴并按下回车。不会读取接管前的终端屏幕或历史输出。</span></div>
          {error && <p className="ghostty-error">{error}</p>}
          <button className="button primary pressable" disabled={!canSend} onClick={async () => {
            if (!selected || sending) return;
            setSending(true);
            try {
              const sent = await onSend(selected.id, text);
              if (sent) setText("");
              else setError("发送未完成，请检查 Mac 上的 Ghostty 自动化授权后重试。");
            } finally {
              setSending(false);
            }
          }}><Send size={18} />发送命令</button>
        </section>

        <p className="ghostty-boundary"><EyeOff size={15} />全屏 TUI（如 vim、htop）会产生控制字符，手机端仅保证普通命令的可读输出，不冒充桌面画面。</p>
      </div>
    </main>
  );
}
