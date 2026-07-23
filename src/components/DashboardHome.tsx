import { ChevronRight, MonitorCog, Settings2 } from "lucide-react";
import { ApprovalCard } from "./ApprovalCard";
import { CodexMark, DeviceLinkIcon } from "./BrandIcons";
import type { BootstrapData } from "../types";

export function DashboardHome({ data, onOpenCodex, onOpenMac, onApproval }: {
  data: BootstrapData;
  onOpenCodex: () => void;
  onOpenMac: () => void;
  onApproval: (threadId?: string) => void;
}) {
  const pending = data.approvals[0];
  const activeCount = data.threads.filter((thread) => thread.status.type === "active").length;
  return (
    <main className="screen dashboard-home">
      <section className="hero-status">
        <div className="signal-orbit"><span /><DeviceLinkIcon size={29} /></div>
        <div><h2>Mac 已就绪</h2><p>{activeCount ? `${activeCount} 个 AI 任务正在运行` : "随时可以从指尖接管任务"}</p></div>
      </section>

      {pending && <section className="section-block"><h2>需要你处理</h2><ApprovalCard approval={pending} compact onOpen={() => onApproval(pending.params.threadId)} /></section>}

      <section className="section-block">
        <h2>已添加的能力</h2>
        <div className="capability-list">
          <button className="capability-row pressable" onClick={onOpenCodex}>
            <span className="capability-icon codex"><CodexMark /></span>
            <span><strong>Codex</strong><small>{activeCount ? `${activeCount} 个任务运行中` : "已连接"}</small></span>
            <ChevronRight />
          </button>
          <button className="capability-row pressable" onClick={onOpenMac}>
            <span className="capability-icon system"><Settings2 /></span>
            <span><strong>系统设置</strong><small>关于本机 · 只读</small></span>
            <ChevronRight />
          </button>
        </div>
      </section>

      <section className="continuity-note"><MonitorCog /><div><strong>{data.system.deviceName}</strong><span>TapPilot Bridge 与 Tailscale 服务正常</span></div></section>
      <div className="studio-credit home-credit"><span>由</span><img src="/brand/shanestudio-wordmark.png" alt="ShaneStudio" /><span>构建</span></div>
    </main>
  );
}
