import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ChevronDown, FileCode2, Image, Paperclip, Send, Square, TerminalSquare, Wrench, X } from "lucide-react";
import { stateLabel, threadState, threadTitle } from "../lib";
import type { CodexItem, CodexThread, PendingApproval, UploadAttachment } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { CodexMark } from "./BrandIcons";
import { QuestionCard } from "./QuestionCard";

function textFromUser(item: CodexItem): string {
  return item.content?.map((part) => part.text ?? "").filter(Boolean).join("\n") ?? "";
}

function MessageImages({ images }: { images: Array<{ url: string; alt: string }> }) {
  if (!images.length) return null;
  return <div className={`message-images ${images.length > 1 ? "grid" : ""}`}>{images.map((image, index) => (
    <a key={`${image.url}-${index}`} href={image.url} target="_blank" rel="noreferrer" aria-label={`打开${image.alt || "对话图片"}`}>
      <img src={image.url} alt={image.alt || "对话图片"} loading="lazy" />
    </a>
  ))}</div>;
}

function TimelineItem({ item }: { item: CodexItem }) {
  if (item.type === "userMessage") {
    const text = textFromUser(item);
    const images = item.images ?? item.content?.filter((part) => part.type === "image" && part.url).map((part) => ({ url: part.url!, alt: part.alt ?? "发送的图片" })) ?? [];
    return <article className="message user-message"><div className="message-bubble">{text && <p>{text}</p>}<MessageImages images={images} /></div><span className="avatar user">你</span></article>;
  }
  if (item.type === "agentMessage") {
    const images = item.images ?? [];
    if (!item.text?.trim() && !images.length) return null;
    return <article className="message agent-message"><span className="avatar codex"><CodexMark size={22} /></span><div className="message-bubble">{item.text?.trim() && <p>{item.text}</p>}<MessageImages images={images} /></div></article>;
  }
  if (item.type === "imageGeneration") {
    const images = item.images ?? [];
    if (!images.length) return null;
    return <article className="message agent-message image-message"><span className="avatar codex"><CodexMark size={22} /></span><div className="message-bubble"><MessageImages images={images} /></div></article>;
  }
  if (item.type === "commandExecution") {
    return (
      <details className="activity-row">
        <summary><TerminalSquare size={19} /><strong>执行工具</strong><code>{item.command}</code><span>{item.status === "completed" ? "已完成" : item.status}</span><ChevronDown size={17} /></summary>
        <div className="activity-detail"><code>{item.cwd}</code><pre>{item.aggregatedOutput || "暂无输出"}</pre></div>
      </details>
    );
  }
  if (item.type === "fileChange") {
    return (
      <details className="activity-row">
        <summary><FileCode2 size={19} /><strong>文件变更</strong><span>{item.changes?.length ?? 0} 个文件</span><ChevronDown size={17} /></summary>
        <div className="activity-detail file-list">{item.changes?.map((change, index) => <code key={index}>{change.path ?? JSON.stringify(change)}</code>)}</div>
      </details>
    );
  }
  return null;
}

type TimelineEntry = { kind: "item"; item: CodexItem; key: string } | { kind: "tools"; items: CodexItem[]; key: string };

function isToolCall(item: CodexItem): boolean {
  return item.type === "mcpToolCall" || item.type === "dynamicToolCall";
}

function isRenderedTimelineItem(item: CodexItem): boolean {
  return isToolCall(item) || ["userMessage", "agentMessage", "imageGeneration", "commandExecution", "fileChange"].includes(item.type);
}

function groupedTimeline(items: CodexItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRenderedTimelineItem(item)) continue;
    if (!isToolCall(item)) {
      entries.push({ kind: "item", item, key: item.id ?? `${item.type}-${index}` });
      continue;
    }
    const previous = entries.at(-1);
    if (previous?.kind === "tools") previous.items.push(item);
    else entries.push({ kind: "tools", items: [item], key: item.id ?? `tools-${index}` });
  }
  return entries;
}

function localizedToolStatus(status?: string): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "inProgress") return "运行中";
  return status || "已调用";
}

function ToolActivityGroup({ items }: { items: CodexItem[] }) {
  const status = items.some((item) => item.status === "failed")
    ? "失败"
    : items.some((item) => item.status === "inProgress") ? "运行中" : "已完成";
  const names = [...new Set(items.map((item) => item.tool || "工具"))];
  return (
    <details className="activity-row tool-group">
      <summary><Wrench size={18} /><strong>工具调用</strong><code>{names.length === 1 ? `${names[0]}${items.length > 1 ? ` × ${items.length}` : ""}` : `${items.length} 次调用`}</code><span>{status}</span><ChevronDown size={17} /></summary>
      <div className="activity-detail tool-list">
        {items.map((item, index) => <div key={item.id ?? index}><code>{item.tool || "调用工具"}</code><span>{localizedToolStatus(item.status)}</span></div>)}
      </div>
    </details>
  );
}

interface Props {
  thread: CodexThread;
  approvals: PendingApproval[];
  busy: boolean;
  onBack: () => void;
  onSend: (text: string, attachmentIds: string[]) => Promise<boolean>;
  onUploadImage: (file: File) => Promise<UploadAttachment>;
  onRemoveUpload: (id: string) => Promise<unknown>;
  onInterrupt: () => Promise<void>;
  onDecide: (key: string, decision: "decline" | "accept" | "acceptForSession") => Promise<void>;
  onAnswer: (key: string, answers: Record<string, string[]>) => Promise<void>;
}

export function ThreadDetail({ thread, approvals, busy, onBack, onSend, onUploadImage, onRemoveUpload, onInterrupt, onDecide, onAnswer }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<UploadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unusedAttachmentsRef = useRef<UploadAttachment[]>([]);
  const positionedThreadRef = useRef<string | null>(null);
  const isNearLatestRef = useRef(true);
  const state = threadState(thread);
  const items = useMemo(() => thread.turns.flatMap((turn) => turn.items), [thread]);
  const timelineEntries = useMemo(() => groupedTimeline(items), [items]);
  const threadApprovals = approvals.filter((approval) => approval.params.threadId === thread.id);
  const lastTurn = thread.turns.at(-1);
  const lastItem = items.at(-1);
  const lastItemLength = lastItem?.text?.length
    ?? lastItem?.aggregatedOutput?.length
    ?? lastItem?.content?.reduce((total, part) => total + (part.text?.length ?? 0), 0)
    ?? 0;
  const timelineVersion = `${thread.id}:${thread.updatedAt}:${lastTurn?.status ?? "empty"}:${items.length}:${lastItem?.id ?? lastItem?.type ?? "empty"}:${lastItem?.status ?? ""}:${lastItemLength}:${lastItem?.changes?.length ?? 0}:${threadApprovals.length}`;

  function scrollToLatest(behavior: ScrollBehavior = "auto") {
    const timeline = timelineRef.current;
    if (!timeline) return;
    timeline.scrollTo({ top: timeline.scrollHeight, behavior });
    isNearLatestRef.current = true;
    setHasNewMessages(false);
  }

  useLayoutEffect(() => {
    const firstPositionForThread = positionedThreadRef.current !== thread.id;
    if (firstPositionForThread) {
      positionedThreadRef.current = thread.id;
      isNearLatestRef.current = true;
      scrollToLatest("auto");
      return;
    }
    if (isNearLatestRef.current) scrollToLatest("auto");
    else setHasNewMessages(true);
  }, [thread.id, timelineVersion]);

  useEffect(() => {
    setAttachments([]);
    setUploadError("");
    return () => {
      for (const attachment of unusedAttachmentsRef.current) void onRemoveUpload(attachment.id);
      unusedAttachmentsRef.current = [];
    };
  }, [thread.id]);

  async function submit() {
    const value = text.trim();
    if (!value && !attachments.length) return;
    isNearLatestRef.current = true;
    const sent = await onSend(value, attachments.map((attachment) => attachment.id));
    if (!sent) return;
    unusedAttachmentsRef.current = [];
    setText("");
    setAttachments([]);
    setUploadError("");
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const available = 4 - attachments.length;
    if (available <= 0) {
      setUploadError("每次最多添加 4 张图片");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const selected = Array.from(files).slice(0, available);
      for (const file of selected) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
        if (file.size > 8 * 1024 * 1024) throw new Error("单张图片不能超过 8 MB");
        const uploaded = await onUploadImage(file);
        setAttachments((current) => {
          const next = [...current, uploaded];
          unusedAttachmentsRef.current = next;
          return next;
        });
      }
      if (files.length > available) setUploadError("每次最多添加 4 张图片，多余图片未添加");
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "图片上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeImage(id: string) {
    try {
      await onRemoveUpload(id);
      setAttachments((current) => {
        const next = current.filter((attachment) => attachment.id !== id);
        unusedAttachmentsRef.current = next;
        return next;
      });
      setUploadError("");
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "无法移除图片");
    }
  }

  return (
    <main className="thread-detail">
      <header className="detail-header glass">
        <button className="icon-button mobile-only pressable" aria-label="返回" onClick={onBack}><ArrowLeft /></button>
        <div><h1>{threadTitle(thread)}</h1><span className={`detail-state ${state}`}>{stateLabel[state]}</span></div>
      </header>

      <div
        ref={timelineRef}
        className="timeline"
        aria-live="polite"
        onScroll={(event) => {
          const timeline = event.currentTarget;
          const distanceFromLatest = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
          isNearLatestRef.current = distanceFromLatest < 120;
          if (isNearLatestRef.current) setHasNewMessages(false);
        }}
      >
        {timelineEntries.length ? timelineEntries.map((entry) => entry.kind === "tools"
          ? <ToolActivityGroup key={entry.key} items={entry.items} />
          : <TimelineItem key={entry.key} item={entry.item} />) : <p className="empty-copy">任务内容正在载入。</p>}
        {threadApprovals.map((approval) => approval.method === "item/tool/requestUserInput" ? (
          <QuestionCard key={approval.key} request={approval} busy={busy} onSubmit={(answers) => void onAnswer(approval.key, answers)} />
        ) : (
          <ApprovalCard key={approval.key} approval={approval} busy={busy} onDecide={(decision) => void onDecide(approval.key, decision)} />
        ))}
      </div>

      {hasNewMessages && (
        <button
          className="new-messages-button pressable"
          onClick={() => scrollToLatest(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth")}
        >
          <ArrowDown size={16} />有新消息
        </button>
      )}

      <div className="composer-wrap glass">
        <div className="composer-mode">
          <span>{state === "running" ? "插入正在运行的任务" : "发送后续指令"}</span>
          <button className="attachment-button pressable" disabled={busy || uploading || attachments.length >= 4} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} />{uploading ? "上传中" : "图片"}</button>
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void addImages(event.target.files)} />
        </div>
        {attachments.length > 0 && <div className="attachment-strip">{attachments.map((attachment) => (
          <div className="attachment-chip" key={attachment.id}><Image size={17} /><span title={attachment.name}>{attachment.name}</span><button className="pressable" aria-label={`移除 ${attachment.name}`} onClick={() => void removeImage(attachment.id)}><X size={15} /></button></div>
        ))}</div>}
        {uploadError && <p className="attachment-error">{uploadError}</p>}
        <textarea
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="给 Codex 发送消息或指令…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
          }}
        />
        <div className="composer-actions">
          {(state === "running" || state === "waiting") && <button disabled={busy} className="button secondary pressable" onClick={() => void onInterrupt()}><Square size={14} fill="currentColor" />停止</button>}
          <button disabled={busy || uploading || (!text.trim() && !attachments.length)} className="button primary pressable" onClick={() => void submit()}><Send size={17} />发送</button>
        </div>
      </div>
    </main>
  );
}
