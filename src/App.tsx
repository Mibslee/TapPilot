import { useCallback, useEffect, useRef, useState } from "react";
import { Home, Monitor, Plus, RefreshCw, Settings2, TerminalSquare } from "lucide-react";
import { api, isBridgeUnavailableError } from "./api";
import { CreateTaskDialog } from "./components/CreateTaskDialog";
import { CodexScreen } from "./components/HomeScreen";
import { DashboardHome } from "./components/DashboardHome";
import { GhosttyScreen } from "./components/GhosttyScreen";
import { MacScreen } from "./components/MacScreen";
import { NavigationSettings, type PinnedTab } from "./components/NavigationSettings";
import { PairScreen } from "./components/PairScreen";
import { ThreadDetail } from "./components/ThreadDetail";
import { ThreadList } from "./components/ThreadList";
import { CodexMark } from "./components/BrandIcons";
import { threadTitle } from "./lib";
import type { BootstrapData, CodexThread } from "./types";

type Tab = "home" | "codex" | "ghostty" | "mac" | "settings";
const defaultPinnedTabs: PinnedTab[] = ["codex", "ghostty", "mac"];

function Navigation({ tab, onTab, pinned, compact }: { tab: Tab; onTab: (tab: Tab) => void; pinned: PinnedTab[]; compact?: boolean }) {
  const allItems = [
    { id: "home" as const, label: "首页", icon: Home },
    { id: "codex" as const, label: "Codex", icon: CodexMark },
    { id: "ghostty" as const, label: "Ghostty", icon: TerminalSquare },
    { id: "mac" as const, label: "Mac", icon: Monitor },
    { id: "settings" as const, label: "设置", icon: Settings2 },
  ];
  const items = compact ? [allItems[0], ...allItems.filter((item) => pinned.includes(item.id as PinnedTab)), allItems[4]] : allItems;
  return (
    <nav className={compact ? "bottom-nav glass" : "side-nav"} aria-label="主导航">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`nav-item pressable ${tab === id ? "active" : ""}`} onClick={() => onTab(id)}><Icon size={21} /><span>{label}</span></button>
      ))}
    </nav>
  );
}

export function App() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [data, setData] = useState<BootstrapData | null>(null);
  const [selected, setSelected] = useState<CodexThread | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [creating, setCreating] = useState(false);
  const [pinnedTabs, setPinnedTabs] = useState<PinnedTab[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tappilot-pinned-tabs") ?? "null");
      if (Array.isArray(saved)) return defaultPinnedTabs.filter((id) => saved.includes(id));
    } catch { /* use safe defaults below */ }
    return defaultPinnedTabs;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [ghosttyOutputSignal, setGhosttyOutputSignal] = useState(0);
  const refreshTimer = useRef<number | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  function updateSelected(thread: CodexThread | null) {
    selectedIdRef.current = thread?.id ?? null;
    setSelected(thread);
  }

  function selectTab(next: Tab) {
    setTab(next);
    if (next !== "codex") updateSelected(null);
  }

  useEffect(() => { localStorage.setItem("tappilot-pinned-tabs", JSON.stringify(pinnedTabs)); }, [pinnedTabs]);

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
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "ghosttyOutput") {
            setGhosttyOutputSignal(Date.now());
            return;
          }
        } catch {
          // An unknown realtime event should still refresh the semantic model.
        }
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

  async function action(work: () => Promise<unknown>): Promise<boolean> {
    try {
      setBusy(true);
      setError("");
      await work();
      await refresh(true);
      return true;
    } catch (cause) {
      if (isBridgeUnavailableError(cause)) setConnectionNotice(cause.message);
      else setError(cause instanceof Error ? cause.message : "操作失败");
      return false;
    } finally { setBusy(false); }
  }

  if (paired === null) return <div className="loading-screen"><RefreshCw className="spin" /><span>正在连接…</span></div>;
  if (!paired) return <PairScreen onPair={async (code) => { await api.pair(code); setPaired(true); await refresh(); }} />;
  if (!data) return <div className="loading-screen"><RefreshCw className="spin" /><span>正在连接…</span>{error && <p className="inline-error">{error}</p>}</div>;

  const showThreadDetail = tab === "codex" && selected !== null;
  const showDetail = showThreadDetail || tab === "ghostty";
  const serviceLabel = data.bridge.codexOnline ? "Bridge 与 Codex 在线" : "Bridge 在线 · Codex 等待";
  return (
    <div className={`app-shell ${showThreadDetail ? "has-thread-detail" : ""}`}>
      <aside className="sidebar glass">
        <div className="brand-row"><h1>指驭</h1><span className={data.bridge.codexOnline ? "service-online" : "service-waiting"}><i />{serviceLabel}</span></div>
        <Navigation tab={tab} pinned={pinnedTabs} onTab={selectTab} />
        <button className="sidebar-add pressable" onClick={() => selectTab("settings")}><Settings2 size={18} />配置底栏</button>
        <div className="sidebar-divider" />
        <div className="sidebar-section-title">最近任务</div>
        <ThreadList threads={data.threads} selectedId={selected?.id} sidebar onSelect={(thread) => void selectThread(thread)} />
        <button className="button outline sidebar-create pressable" onClick={() => setCreating(true)}><Plus size={19} />新建任务</button>
        <div className="studio-credit sidebar-credit"><span>by</span><img src="/brand/shanestudio-wordmark.png" alt="ShaneStudio" /></div>
      </aside>

      <div className="mobile-frame">
        {!showDetail && <header className="mobile-header glass"><h1>{tab === "home" ? "指驭" : tab === "codex" ? "Codex" : tab === "mac" ? "Mac" : "设置"}</h1><span className={data.bridge.codexOnline ? "service-online" : "service-waiting"}><i />{data.bridge.codexOnline ? "已连接" : "Codex 等待"}</span></header>}
        {showDetail ? (
          tab === "ghostty" ? <GhosttyScreen
            snapshot={data.ghostty}
            busy={busy}
            onBack={() => selectTab("home")}
            onRefresh={async () => { await action(() => api.ghostty()); }}
            onSend={(terminalId, text) => action(() => api.sendGhosttyInput(terminalId, text))}
            onStartDedicatedRelay={async () => {
              let terminalId: string | null = null;
              const started = await action(async () => { terminalId = (await api.startDedicatedGhosttyRelay()).terminal.id; });
              return started ? terminalId : null;
            }}
            onStartRelay={(terminalId) => action(() => api.startGhosttyRelay(terminalId))}
            onStopRelay={(terminalId) => action(() => api.stopGhosttyRelay(terminalId))}
            onReadOutput={api.ghosttyOutput}
            outputSignal={ghosttyOutputSignal}
          /> : <ThreadDetail
            thread={selected!}
            approvals={data.approvals}
            busy={busy}
            onBack={() => updateSelected(null)}
            onSend={async (text, attachmentIds) => {
              let sent = false;
              await action(async () => {
                await api.send(selected!.id, text, attachmentIds);
                sent = true;
              });
              return sent;
            }}
            onUploadImage={api.uploadImage}
            onRemoveUpload={(id) => api.deleteUpload(id)}
            onInterrupt={async () => { await action(() => api.interrupt(selected!.id)); }}
            onDecide={async (key, decision) => { await action(() => api.decide(key, decision)); }}
            onAnswer={async (key, answers) => { await action(() => api.answer(key, answers)); }}
          />
        ) : tab === "home" ? (
          <DashboardHome
            data={data}
            onOpenCodex={() => setTab("codex")}
            onOpenGhostty={() => selectTab("ghostty")}
            onOpenMac={() => setTab("mac")}
            onApproval={(threadId) => {
              const thread = data.threads.find((item) => item.id === threadId);
              if (thread) void selectThread(thread);
              else setTab("codex");
            }}
          />
        ) : tab === "codex" ? (
          <CodexScreen data={data} onSelect={(thread) => void selectThread(thread)} onCreate={() => setCreating(true)} />
        ) : tab === "mac" ? <MacScreen data={data} onOpenGhostty={() => selectTab("ghostty")} />
          : <NavigationSettings
            pinned={pinnedTabs}
            onChange={setPinnedTabs}
            devices={data.pairedDevices}
            currentDeviceId={data.currentDeviceId}
            onRemoveDevice={(id) => action(() => api.removeDevice(id))}
          />}
        {!showThreadDetail && <Navigation compact tab={tab} pinned={pinnedTabs} onTab={selectTab} />}
      </div>

      {creating && <CreateTaskDialog busy={busy} onClose={() => setCreating(false)} onCreate={async (cwd, text) => {
        await action(async () => {
          const thread = await api.createThread(cwd, text);
          setCreating(false);
          await selectThread(thread);
        });
      }} />}
      {error && <button className="toast" onClick={() => setError("")}><strong>操作未完成</strong><span>{error}</span></button>}
      {connectionNotice && <div className="connection-toast" role="status"><RefreshCw className="spin" size={16} /><span>{connectionNotice}</span></div>}
      {busy && <div className="busy-line" />}
    </div>
  );
}
