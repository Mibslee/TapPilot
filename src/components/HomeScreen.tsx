import { Plus } from "lucide-react";
import { ThreadList } from "./ThreadList";
import type { BootstrapData, CodexThread, RateLimitWindow } from "../types";

interface Props {
  data: BootstrapData;
  onSelect: (thread: CodexThread) => void;
  onCreate: () => void;
}

function QuotaBar({ label, used }: { label: string; used: number | null }) {
  const remaining = used === null ? null : Math.max(0, Math.round(100 - used));
  return (
    <div className="quota-row">
      <strong>{label}</strong>
      <div className="quota-track" aria-label={`${label}剩余 ${remaining ?? "未知"}%`}>
        <span style={{ width: `${remaining ?? 0}%` }} />
      </div>
      <span>{remaining === null ? "暂无" : `${remaining}%`}</span>
    </div>
  );
}

export function CodexScreen({ data, onSelect, onCreate }: Props) {
  const windows = [data.rateLimits?.primary, data.rateLimits?.secondary].filter((window): window is RateLimitWindow => Boolean(window));
  const shortWindow = windows.find((window) => (window.windowDurationMins ?? Infinity) <= 24 * 60) ?? null;
  const weeklyWindow = windows.find((window) => (window.windowDurationMins ?? 0) >= 5 * 24 * 60) ?? null;
  return (
    <main className="screen codex-screen">
      <section className="section-block quota-section">
        <div className="section-title-row"><h2>Codex 额度</h2><span>服务端快照</span></div>
        <div className="quota-panel">
          <QuotaBar label={shortWindow?.windowDurationMins === 300 ? "5 小时" : "短周期"} used={shortWindow?.usedPercent ?? null} />
          <QuotaBar label="每周" used={weeklyWindow?.usedPercent ?? null} />
        </div>
      </section>

      <section className="section-block recent-section">
        <h2>最近任务</h2>
        <ThreadList threads={data.threads} onSelect={onSelect} />
      </section>

      <button className="button primary create-button pressable" onClick={onCreate}>
        <Plus size={21} />新建任务
      </button>
    </main>
  );
}
