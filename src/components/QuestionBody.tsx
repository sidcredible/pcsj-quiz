"use client";

/**
 * Renders a question's stem and its presentation blocks, for both the attempt
 * and review screens.
 *
 * Blocks are rendered whenever the field is present, not according to the
 * style: the handbook warns that a `case_based` item could perfectly well
 * carry `statements`, so style picks the options control, while the stem,
 * statements, assertion/reason and match lists each render on their own terms.
 */

import type { CandidateQuestion } from "@/lib/quiz/redact";
import { Badge, Muted, QuizText } from "./primitives";

function StatementList({ statements }: { statements: { key: string; text: string }[] }) {
  return (
    <ol className="mt-3 space-y-1.5">
      {statements.map((statement) => (
        <li key={statement.key} className="flex gap-2">
          <span className="option-key">{statement.key}.</span>
          <QuizText className="flex-1">{statement.text}</QuizText>
        </li>
      ))}
    </ol>
  );
}

function AssertionReason({
  assertion,
  reason,
}: {
  assertion: string;
  reason: string;
}) {
  return (
    <div className="mt-3 space-y-2">
      {[
        { label: "Assertion (A)", text: assertion },
        { label: "Reason (R)", text: reason },
      ].map((block) => (
        <div key={block.label} className="card px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide">
            <Muted>{block.label}</Muted>
          </p>
          <QuizText className="mt-1">{block.text}</QuizText>
        </div>
      ))}
    </div>
  );
}

/**
 * The two lists of a match-list question, each as a whole block.
 *
 * Side by side from 480px up, stacked below. The lists must never interleave
 * when they stack: showing I, A, II, B, III, C reads as though I pairs with A,
 * which on a match-list question is exactly the thing the candidate is being
 * asked and would hand them a wrong answer. So each list stays whole, with its
 * own heading, in both layouts.
 */
function MatchLists({ match }: { match: NonNullable<CandidateQuestion["match"]> }) {
  const columns = [
    { title: match.list_i_title ?? "List I", items: match.list_i },
    { title: match.list_ii_title ?? "List II", items: match.list_ii },
  ];

  return (
    <div className="mt-3 card grid grid-cols-1 overflow-hidden min-[480px]:grid-cols-2">
      {columns.map((column, columnIndex) => (
        <section
          key={column.title}
          className={
            columnIndex === 1
              ? "border-t min-[480px]:border-l min-[480px]:border-t-0"
              : undefined
          }
          style={columnIndex === 1 ? { borderColor: "var(--border)" } : undefined}
        >
          <h3
            className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide"
            style={{ borderColor: "var(--border)" }}
          >
            <Muted>{column.title}</Muted>
          </h3>
          <ul className="px-3 py-2">
            {column.items.map((item) => (
              <li key={item.key} className="flex gap-2 py-1">
                <span className="option-key">{item.key}.</span>
                <QuizText className="flex-1">{item.text}</QuizText>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  prelims: "Prelims",
  mains: "Mains",
};

export function QuestionMeta({ question }: { question: CandidateQuestion }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <Badge>
        Q{question.number} · {question.marks}{" "}
        {question.marks === 1 ? "mark" : "marks"}
      </Badge>
      {question.pyq_badges?.map((badge) => (
        <Badge key={`${badge.exam}-${badge.stage}-${badge.year}`}>
          PYQ · {badge.exam} {STAGE_LABEL[badge.stage] ?? badge.stage} {badge.year}
        </Badge>
      ))}
      {question.topic ? <Badge>{question.topic}</Badge> : null}
    </div>
  );
}

export function QuestionBody({ question }: { question: CandidateQuestion }) {
  return (
    <div>
      <QuizText className="prose-legal text-lg leading-relaxed">
        {question.question}
      </QuizText>

      {question.statements?.length ? (
        <StatementList statements={question.statements} />
      ) : null}

      {question.assertion && question.reason ? (
        <AssertionReason assertion={question.assertion} reason={question.reason} />
      ) : null}

      {question.match ? <MatchLists match={question.match} /> : null}
    </div>
  );
}
