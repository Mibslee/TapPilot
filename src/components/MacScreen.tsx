import { ChevronRight, Info, MonitorCog, Plus, Settings2, TerminalSquare } from "lucide-react";
import { uptimeText } from "../lib";
import type { BootstrapData, ModuleInfo } from "../types";
import { CodexMark } from "./BrandIcons";

const moduleIcons = {
  codex: CodexMark,
  system: Settings2,
  minimax: MonitorCog,
  ghostty: TerminalSquare,
  kaku: TerminalSquare,
};

function ModuleRow({ module, onOpen }: { module: ModuleInfo; onOpen?: () => void }) {
  const Icon = moduleIcons[module.id as keyof typeof moduleIcons] ?? MonitorCog;
  const state = module.state === "connected" ? "已连接" : module.state === "offline" ? "等待服务" : module.state === "available" ? "可使用" : module.state === "readOnly" ? "可展示" : "计划接入";
  return (
    <button className="module-row pressable" disabled={module.state === "planned"} onClick={onOpen}>
      <span className={`module-icon ${module.id}`}><Icon size={21} /></span>
      <span><strong>{module.name}</strong><small>{state}</small></span>
      <ChevronRight size={17} />
    </button>
  );
}

export function MacScreen({ data, onOpenGhostty }: { data: BootstrapData; onOpenGhostty: () => void }) {
  const info = data.system;
  return (
    <main className="screen mac-screen">
      <section className="section-block">
        <div className="section-title-row"><h2>我的 Mac</h2><button className="text-button pressable"><Plus size={17} />添加</button></div>
        <div className="module-list">{data.modules.map((module) => <ModuleRow module={module} key={module.id} onOpen={module.id === "ghostty" ? onOpenGhostty : undefined} />)}</div>
      </section>
      <section className="section-block about-section">
        <div className="path-hint"><Info size={16} />系统设置 → 通用 → 关于本机</div>
        <div className="about-heading"><div><h2>{info.deviceName}</h2><p>已通过 TapPilot Bridge 连接</p></div><span className="online-mark">Bridge 在线</span></div>
        <dl>
          <div><dt>macOS</dt><dd>{info.macOS}</dd></div>
          <div><dt>芯片</dt><dd>{info.chip}</dd></div>
          <div><dt>内存</dt><dd>{info.memory}</dd></div>
          <div><dt>存储空间</dt><dd>{info.storage.used} / {info.storage.total}</dd></div>
          <div><dt>运行时间</dt><dd>{uptimeText(info.uptimeSeconds)}</dd></div>
          <div><dt>Tailscale</dt><dd>{info.tailscale}</dd></div>
          <div><dt>TapPilot</dt><dd className="healthy">Bridge 在线</dd></div>
        </dl>
      </section>
    </main>
  );
}
