import { ChevronRight } from "lucide-react";
import { relativeTime, stateLabel, threadState, threadTitle } from "../lib";
import type { CodexThread } from "../types";

interface Props {
  threads: CodexThread[];
  selectedId?: string | null;
  onSelect: (thread: CodexThread) => void;
  sidebar?: boolean;
}

export function ThreadList({ threads, selectedId, onSelect, sidebar }: Props) {
  if (!threads.length) return <p className="empty-copy">还没有 Codex 任务。</p>;
  return (
    <div className={sidebar ? "thread-list sidebar-list" : "thread-list"}>
      {threads.map((thread) => {
        const state = threadState(thread);
        return (
          <button
            key={thread.id}
            className={`thread-row pressable ${selectedId === thread.id ? "selected" : ""}`}
            onClick={() => onSelect(thread)}
          >
            <span className={`status-dot ${state}`} />
            <span className="thread-copy">
              <strong>{threadTitle(thread)}</strong>
              {sidebar ? <span className={`state-text ${state}`}>{stateLabel[state]}</span> : null}
            </span>
            {!sidebar && <><span className={`state-text ${state}`}>{stateLabel[state]}</span><time>{relativeTime(thread.updatedAt)}</time><ChevronRight size={17} /></>}
          </button>
        );
      })}
    </div>
  );
}
