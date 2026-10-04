/** Small presentational pieces shared by the four screens. */

import type { ReactNode } from "react";

/**
 * Quiz-file text. React escapes the value, and `white-space: pre-line` turns
 * the file's \n into line breaks without any HTML being interpreted.
 */
export function QuizText({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return <p className={`quiz-text ${className}`}>{children}</p>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}

export function PageTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="mb-5">
      <h1 className="prose-legal text-2xl font-semibold leading-tight sm:text-3xl">
        {children}
      </h1>
      {sub ? (
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {sub}
        </p>
      ) : null}
    </header>
  );
}

export function Muted({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={className} style={{ color: "var(--muted)" }}>
      {children}
    </span>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}) {
  const palette = {
    info: { border: "var(--border)", background: "var(--surface)" },
    warn: { border: "var(--flag)", background: "var(--flag-soft)" },
    error: { border: "var(--wrong)", background: "var(--wrong-soft)" },
  }[tone];

  return (
    <div
      className="mb-4 rounded-lg border px-3 py-2 text-sm"
      style={{ borderColor: palette.border, background: palette.background }}
      role={tone === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

/** Links from `resources` open in a new tab, per the handbook. */
export function ResourceLink({ href, title }: { href: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      style={{ color: "var(--accent)" }}
    >
      {title}
    </a>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
      {label}
    </p>
  );
}
