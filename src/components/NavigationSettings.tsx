import { Check, Laptop, LayoutPanelTop, Minus, ShieldCheck, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PairedDevice } from "../types";

export type PinnedTab = "codex" | "ghostty" | "mac";

const entries: Array<{ id: PinnedTab; name: string; description: string }> = [
  { id: "codex", name: "Codex", description: "任务、对话和审批" },
  { id: "ghostty", name: "Ghostty", description: "终端会话与输出" },
  { id: "mac", name: "Mac", description: "已接入能力和本机信息" },
];

function DeviceIcon({ platform }: { platform: PairedDevice["platform"] }) {
  return platform === "tablet" ? <Tablet size={18} /> : platform === "computer" ? <Laptop size={18} /> : <Smartphone size={18} />;
}

function lastSeen(device: PairedDevice): string {
  const value = new Date(device.lastSeenAt);
  if (Number.isNaN(value.getTime())) return "已配对";
  return `最近使用 ${value.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

export function NavigationSettings({
  pinned,
  onChange,
  devices,
  currentDeviceId,
  onRemoveDevice,
}: {
  pinned: PinnedTab[];
  onChange: (next: PinnedTab[]) => void;
  devices: PairedDevice[];
  currentDeviceId: string | null;
  onRemoveDevice: (id: string) => Promise<boolean>;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const confirming = devices.find((device) => device.id === confirmingId) ?? null;

  return (
    <main className="screen navigation-settings">
      <section className="settings-intro"><LayoutPanelTop size={25} /><div><h2>底栏入口</h2><p>首页和设置固定保留；其余最多放 3 个入口，总数不超过 5 个。</p></div></section>
      <section className="settings-list" aria-label="配置底栏入口">
        {entries.map((entry) => {
          const enabled = pinned.includes(entry.id);
          const disabled = !enabled && pinned.length >= 3;
          return <button key={entry.id} className="settings-row pressable" disabled={disabled} onClick={() => onChange(enabled ? pinned.filter((id) => id !== entry.id) : [...pinned, entry.id])}>
            <span><strong>{entry.name}</strong><small>{entry.description}</small></span>
            <span className={`settings-toggle ${enabled ? "on" : ""}`}>{enabled ? <Check size={16} /> : <Minus size={16} />}</span>
          </button>;
        })}
      </section>
      <p className="settings-note">设置只保存到当前设备浏览器；首页和设置始终可用，不会因调整底栏而丢失返回入口。</p>

      <section className="paired-devices-section" aria-labelledby="paired-devices-title">
        <div className="section-title-row"><h2 id="paired-devices-title">已配对设备</h2><span>{devices.length} 台</span></div>
        <p className="paired-devices-copy"><ShieldCheck size={16} />每台浏览器都有独立凭据；移除后，该设备会在下一次请求时被要求重新配对。</p>
        <div className="paired-devices-list">
          {devices.map((device) => {
            const current = device.id === currentDeviceId;
            return <div className="paired-device-row" key={device.id}>
              <span className="paired-device-icon"><DeviceIcon platform={device.platform} /></span>
              <span className="paired-device-body"><strong>{device.label}{current && <em>当前设备</em>}</strong><small>{device.route} · {lastSeen(device)}</small></span>
              <button className="icon-button pressable remove-device" aria-label={`移除 ${device.label}`} disabled={removingId === device.id} onClick={() => setConfirmingId(device.id)}><Trash2 size={17} /></button>
            </div>;
          })}
          {!devices.length && <p className="empty-copy">暂时没有已配对设备。</p>}
        </div>
        {confirming && <div className="device-remove-confirm" role="alertdialog" aria-live="polite">
          <strong>移除“{confirming.label}”吗？</strong>
          <p>{confirming.id === currentDeviceId ? "当前浏览器会立即退出，需要重新输入配对码。" : "该浏览器将无法继续访问此 Mac，除非重新配对。"}</p>
          <div><button className="button outline pressable" onClick={() => setConfirmingId(null)}>取消</button><button className="button danger pressable" disabled={removingId === confirming.id} onClick={async () => {
            setRemovingId(confirming.id);
            const removed = await onRemoveDevice(confirming.id);
            setRemovingId(null);
            if (removed) setConfirmingId(null);
          }}><Trash2 size={16} />确认移除</button></div>
        </div>}
      </section>
    </main>
  );
}
