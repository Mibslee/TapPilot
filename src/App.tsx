import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, Home, Monitor, Plus, RefreshCw } from "lucide-react";
import { api, isBridgeUnavailableError } from "./api";
import { CreateTaskDialog } from "./components/CreateTaskDialog";
import { CodexScreen } from "./components/HomeScreen";
import { DashboardHome } from "./components/DashboardHome";
import { MacScreen } from "./components/MacScreen";
import { PairScreen } from "./components/PairScreen";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { CodexMark } from "./components/BrandIcons";
import { threadTitle } from "./lib";
import type { BootstrapData, CodexThread } from "./types";

type Tab = "home" | "codex" | "mac";

function Navigation({ tab, onTab, onAdd, compact }: { tab: Tab; onTab: (tab: Tab) => void; onAdd: () => void; compact?: boolean }) {
  const items = [
    { id: "home" as const, label: "首页", icon: Home },
    { id: "codex" as const, label: "Codex", icon: CodexMark },
    { id: "mac" as const, label: "Mac", icon: Monitor },
  ];
  return (
    <nav className={compact ? "bottom-nav glass" : "side-nav"} aria-label="主导航">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`nav-item pressable ${tab === id ? "active" : ""}`} onClick={() => onTab(id)}><Icon size={21} /><span>{label}</span></button>
      ))}
      {compact && <button className="nav-item add-nav pressable" onClick={onAdd}><span className="add-nav-icon"><Plus size={20} /></span><span>添加</span></button>}
    </nav>
  );
}

export function App() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [selected, setSelected] = useState<CodexThread | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [creating, setCreating] = useState(false);
  const [showingCatalog, setShowingCatalog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const refreshTimer = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  function updateSelected(thread: CodexThread | null) {
    selectedIdRef.current = thread?.id ?? null;
    setSelected(thread);
  }

  const refresh = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setBusy(true);
      const next = await api.bootstrap();
      setData(next);
      setError("");
      setConnectionNotice("");
      const selectedId = selectedIdRef.current;
      if (selectedId) {
        const refreshed = await api.thread(selectedId);
        if (selectedIdRef.current === selectedId) setSelected(refreshed);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "无法连接 Mac";
      if (message.includes("配对")) setPaired(false);
      else if (isBridgeUnavailableError(cause)) setConnectionNotice(message);
      else if (!quiet) setError(message);
    } finally { if (!quiet) setBusy(false); }
  }, []);

  useEffect(() => {
    let disposed = false;
    let retry: number | null = null;
    const check = () => void api.health().then((health) => {
      if (disposed) return;
      setPaired(health.paired);
      setConnectionNotice("");
      if (health.paired) void refresh();
    }).catch((cause) => {
      if (disposed) return;
      const message = cause instanceof Error ? cause.message : "TapPilot Bridge 未启动";
      if (isBridgeUnavailableError(cause)) setConnectionNotice(message);
      else setError(message);
      setPaired(null);
      retry = window.setTimeout(check, 1500);
    });
    check();
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
    };
  }, [refresh]);

  useEffect(() => {
    if (!paired) return;
    let socket: WebSocket | null = null;
    let retry: number | null = null;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${location.host}/events`);
      socket.onopen = () => {
        setConnectionNotice("");
        void refresh(true);
      };
      socket.onmessage = () => {
        if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
        refreshTimer.current = window.setTimeout(() => void refresh(true), 180);
      };
      socket.onclose = (event) => {
        if (disposed) return;
        if (event.code === 4001) {
          setData(null);
          setPaired(false);
          return;
        }
        setConnectionNotice("与 Mac 的连接短暂中断，正在自动重连…");
        retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      socket?.close();
    };
  }, [paired, refresh]);

  async function selectThread(thread: CodexThread) {
    updateSelected(thread);
    setTab("codex");
    try {
      const fullThread = await api.thread(thread.id);
      if (selectedIdRef.current === thread.id) setSelected(fullThread);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取任务"); }
  }

  async function action(work: () => Promise<unknown>) {
    try {
      setBusy(true);
      setError("");
      await work();
      await refresh(true);
    } catch (cause) {
      if (isBridgeUnavailableError(cause)) setConnectionNotice(cause.message);
      else setError(cause instanceof Error ? cause.message : "操作失败");
    } finally { setBusy(false); }
  }

  if (paired === null) return <div className="loading-screen"><RefreshCw className="spin" /><span>正在连接…</span></div>;
  if (!paired) return <PairScreen onPair={async (code) => { await api.pair(code); setPaired(true); await refresh(); }} />;
  if (!data) return <div className="loading-screen"><RefreshCw className="spin" /><span>正在连接…</span>{error && <p className="inline-error">{error}</p>}</div>;

  const showDetail = tab === "codex" && selected;
  return (
    <div className={`app-shell ${showDetail ? "has-detail" : ""}`}>
      <aside className="sidebar glass">
        <div className="brand-row"><h1>指驭</h1><span><i />Mac 在线</span></div>
        <Navigation tab={tab} onAdd={() => setShowingCatalog(true)} onTab={(value) => { setTab(value); if (value !== "codex") updateSelected(null); }} />
        <button className="sidebar-add pressable" onClick={() => setShowingCatalog(true)}><Plus size={18} />添加应用</button>
        <div className="sidebar-divider" />
        <div className="sidebar-section-title">最近任务</div>
        <ThreadList threads={data.threads} selectedId={selected?.id} sidebar onSelect={(thread) => void selectThread(thread)} />
        <button className="button outline sidebar-create pressable" onClick={() => setCreating(true)}><Plus size={19} />新建任务</button>
        <div className="studio-credit sidebar-credit"><span>by</span><img src="/brand/shanestudio-wordmark.png" alt="ShaneStudio" /></div>
      </aside>

      <div className="mobile-frame">
        {!showDetail && <header className="mobile-header glass"><h1>{tab === "home" ? "指驭" : tab === "codex" ? "Codex" : "Mac"}</h1><span><i />Mac 在线</span></header>}
        {showDetail ? (
          <ThreadDetail
            thread={selected}
            approvals={data.approvals}
            busy={busy}
            onBack={() => updateSelected(null)}
            onSend={async (text, attachmentIds) => {
              let sent = false;
              await action(async () => {
                await api.send(selected.id, text, attachmentIds);
                sent = true;
              });
              return sent;
            }}
            onUploadImage={api.uploadImage}
            onRemoveUpload={(id) => api.deleteUpload(id)}
            onInterrupt={() => action(() => api.interrupt(selected.id))}
            onDecide={(key, decision) => action(() => api.decide(key, decision))}
            onAnswer={(key, answers) => action(() => api.answer(key, answers))}
          />
        ) : tab === "home" ? (
          <DashboardHome
            data={data}
            onOpenCodex={() => setTab("codex")}
            onOpenMac={() => setTab("mac")}
            onApproval={(threadId) => {
              const thread = data.threads.find((item) => item.id === threadId);
              if (thread) void selectThread(thread);
              else setTab("codex");
            }}
          />
        ) : tab === "codex" ? (
          <CodexScreen data={data} onSelect={(thread) => void selectThread(thread)} onCreate={() => setCreating(true)} />
        ) : <MacScreen data={data} />}
        {!showDetail && <Navigation compact tab={tab} onAdd={() => setShowingCatalog(true)} onTab={(value) => { setTab(value); updateSelected(null); }} />}
      </div>

      {creating && <CreateTaskDialog busy={busy} onClose={() => setCreating(false)} onCreate={async (cwd, text) => {
        await action(async () => {
          const thread = await api.createThread(cwd, text);
          setCreating(false);
          await selectThread(thread);
        });
      }} />}
      {showingCatalog && (
        <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && setShowingCatalog(false)}>
          <section className="sheet catalog-sheet" role="dialog" aria-modal="true" aria-label="添加应用">
            <header><div><h2>添加应用</h2><p>把 Mac 能力添加到指驭首页</p></div><button className="text-button pressable" onClick={() => setShowingCatalog(false)}>完成</button></header>
            <div className="catalog-list">
              {data.modules.map((module) => <div className="catalog-row" key={module.id}><span className={`catalog-mark ${module.id}`}>{module.id === "codex" ? <CodexMark /> : <Code2 />}</span><span><strong>{module.name}</strong><small>{module.state === "planned" ? "适配器正在规划" : module.state === "readOnly" ? "已添加 · 只读" : "已添加并连接"}</small></span><button className="button secondary" disabled>{module.state === "planned" ? "以后可用" : "已添加"}</button></div>)}
            </div>
          </section>
        </div>
      )}
      {error && <button className="toast" onClick={() => setError("")}><strong>操作未完成</strong><span>{error}</span></button>}
      {connectionNotice && <div className="connection-toast" role="status"><RefreshCw className="spin" size={16} /><span>{connectionNotice}</span></div>}
      {busy && <div className="busy-line" />}
    </div>
  );
}
