import { useState } from "react";
import { Link2, ShieldCheck } from "lucide-react";

export function PairScreen({ onPair }: { onPair: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    try {
      setBusy(true);
      setError("");
      await onPair(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配对失败");
    } finally { setBusy(false); }
  }
  return (
    <main className="pair-screen">
      <div className="pair-mark"><Link2 size={30} /></div>
      <h1>连接你的 Mac</h1>
      <p>在 Mac 的 TapPilot Bridge 终端中找到六位配对码。</p>
      <input
        className="pair-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        placeholder="000000"
        aria-label="六位配对码"
      />
      {error && <p className="inline-error">{error}</p>}
      <button className="button primary pressable" disabled={busy || code.length !== 6} onClick={() => void submit()}>{busy ? "正在连接…" : "配对"}</button>
      <small className="privacy-note"><ShieldCheck size={15} />凭证仅保存在这台设备与 Mac 上</small>
      <div className="studio-credit"><span>由</span><img src="/brand/shanestudio-wordmark.png" alt="ShaneStudio" /></div>
    </main>
  );
}
