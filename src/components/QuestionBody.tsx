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
 * Two lists paired by position. Side by side from 480px up; stacked below, so
 * a match-list question stays readable at 360px without sideways scrolling.
 */
function MatchLists({ match }: { match: NonNullable<CandidateQuestion["match"]> }) {
  const rows = Math.max(match.list_i.length, match.list_ii.length);
  const pairs = Array.from({ length: rows }, (_, index) => ({
    left: match.list_i[index],
    right: match.list_ii[index],
  }));

  return (
    <div className="mt-3 card overflow-hidden">
      <div className="hidden grid-cols-2 border-b text-xs font-semibold uppercase tracking-wide min-[480px]:grid"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="px-3 py-2">
          <Muted>{match.list_i_title ?? "List I"}</Muted>
        </div>
        <div className="border-l px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <Muted>{match.list_ii_title ?? "List II"}</Muted>
        </div>
      </div>

      {pairs.map((pair, index) => (
        <div
          key={pair.left?.key ?? pair.right?.key ?? index}
          className="grid grid-cols-1 border-b last:border-b-0 min-[480px]:grid-cols-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="px-3 py-2">
            {/* The list titles become inline labels once the grid stacks. */}
            <p className="mb-0.5 text-[0.65rem] uppercase tracking-wide min-[480px]:hidden">
              <Muted>{match.list_i_title ?? "List I"}</Muted>
            </p>
            {pair.left ? (
              <div className="flex gap-2">
                <span className="option-key">{pair.left.key}.</span>
                <QuizText className="flex-1">{pair.left.text}</QuizText>
              </div>
            ) : null}
          </div>
          <div
            className="border-t px-3 py-2 min-[480px]:border-l min-[480px]:border-t-0"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="mb-0.5 text-[0.65rem] uppercase tracking-wide min-[480px]:hidden">
              <Muted>{match.list_ii_title ?? "List II"}</Muted>
            </p>
            {pair.right ? (
              <div className="flex gap-2">
                <span className="option-key">{pair.right.key}.</span>
                <QuizText className="flex-1">{pair.right.text}</QuizText>
              </div>
            ) : null}
          </div>
        </div>
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
