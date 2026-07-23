import { AlertTriangle, Folder, Globe2, TerminalSquare } from "lucide-react";
import type { PendingApproval } from "../types";

interface Props {
  approval: PendingApproval;
  compact?: boolean;
  busy?: boolean;
  onOpen?: () => void;
  onDecide?: (decision: "decline" | "accept" | "acceptForSession") => void;
}

export function approvalSummary(approval: PendingApproval): string {
  if (approval.params.networkApprovalContext?.host) return `需要访问 ${approval.params.networkApprovalContext.host}`;
  if (approval.params.grantRoot) return `需要写入 ${approval.params.grantRoot}`;
  if (approval.params.reason) return approval.params.reason;
  if (approval.params.command) return "需要允许执行一条命令";
  return "Codex 正在等待你的决定";
}

export function ApprovalCard({ approval, compact, busy, onOpen, onDecide }: Props) {
  if (compact) {
    return (
      <button className="approval-compact pressable" onClick={onOpen}>
        <span className="approval-icon"><AlertTriangle size={21} /></span>
        <span className="approval-compact-copy">
          <strong>需要你处理</strong>
          <span>{approvalSummary(approval)}</span>
        </span>
        <span className="chevron" aria-hidden>›</span>
      </button>
    );
  }

  const cwd = approval.params.cwd || approval.params.grantRoot;
  return (
    <section className="approval-card" aria-label="待审批请求">
      <div className="approval-heading">
        <span className="approval-icon"><AlertTriangle size={20} /></span>
        <div>
          <strong>需要你的允许</strong>
          <p>{approvalSummary(approval)}</p>
        </div>
      </div>
      <div className="approval-context">
        {cwd && <div><Folder size={18} /><span><small>工作目录</small>{cwd}</span></div>}
        {approval.params.command && <div><TerminalSquare size={18} /><span><small>请求的操作</small><code>{approval.params.command}</code></span></div>}
        {approval.params.networkApprovalContext?.host && (
          <div><Globe2 size={18} /><span><small>网络目标</small>{approval.params.networkApprovalContext.host}</span></div>
        )}
      </div>
      <div className="approval-actions">
        <button disabled={busy} className="button secondary pressable" onClick={() => onDecide?.("decline")}>拒绝</button>
        <button disabled={busy} className="button outline pressable" onClick={() => onDecide?.("accept")}>仅本次允许</button>
        <button disabled={busy} className="button primary pressable" onClick={() => onDecide?.("acceptForSession")}>本任务内允许</button>
      </div>
    </section>
  );
}
