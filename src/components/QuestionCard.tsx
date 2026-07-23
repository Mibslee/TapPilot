import { useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import type { PendingApproval } from "../types";

interface Question {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }> | null;
}

export function QuestionCard({ request, busy, onSubmit }: {
  request: PendingApproval;
  busy: boolean;
  onSubmit: (answers: Record<string, string[]>) => void;
}) {
  const questions = useMemo(() => (request.params.questions as Question[] | undefined) ?? [], [request]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section className="question-card">
      <div className="approval-heading">
        <span className="question-icon"><CircleHelp size={20} /></span>
        <div><strong>Codex 需要补充信息</strong><p>回答后任务会继续运行</p></div>
      </div>
      {questions.map((question) => (
        <fieldset key={question.id}>
          <legend><small>{question.header}</small>{question.question}</legend>
          {question.options?.map((option) => (
            <label className="choice-row pressable" key={option.label}>
              <input
                type="radio"
                name={question.id}
                value={option.label}
                checked={answers[question.id] === option.label}
                onChange={() => setAnswers((value) => ({ ...value, [question.id]: option.label }))}
              />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </label>
          ))}
          {!question.options && (
            <textarea
              rows={3}
              placeholder="输入回答"
              value={answers[question.id] ?? ""}
              onChange={(event) => setAnswers((value) => ({ ...value, [question.id]: event.target.value }))}
            />
          )}
        </fieldset>
      ))}
      <button
        className="button primary pressable"
        disabled={busy || questions.some((question) => !answers[question.id]?.trim())}
        onClick={() => onSubmit(Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, [value]])))}
      >提交并继续</button>
    </section>
  );
}
