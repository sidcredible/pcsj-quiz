/**
 * The admin view: files that failed validation, with their errors, and the
 * consistency warnings on files that imported anyway. Candidates never see
 * either; this page is why a bad file is not silently missing.
 */

import Link from "next/link";
import { Muted, Notice, PageTitle } from "@/components/primitives";
import { ConfigError } from "@/lib/config";
import { NotConfiguredError, syncQuizzes } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let snapshot;
  try {
    snapshot = await syncQuizzes();
  } catch (error) {
    if (error instanceof NotConfiguredError || error instanceof ConfigError) {
      return (
        <div>
          <PageTitle>Import status</PageTitle>
          <Notice tone="error">{error.message}</Notice>
        </div>
      );
    }
    throw error;
  }

  const warned = snapshot.quizzes.filter((quiz) => quiz.warnings.length > 0);

  return (
    <div>
      <p className="mb-4">
        <Link href="/" className="text-sm underline underline-offset-2">
          ← All quizzes
        </Link>
      </p>

      <PageTitle
        sub={
          snapshot.scannedAt
            ? `Folder checked ${new Date(snapshot.scannedAt).toLocaleString()}`
            : "Not checked yet"
        }
      >
        Import status
      </PageTitle>

      {snapshot.scanError ? (
        <Notice tone="error">
          Could not list the Drive folder: {snapshot.scanError}
        </Notice>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
          <Muted>Imported ({snapshot.quizzes.length})</Muted>
        </h2>
        {snapshot.quizzes.length === 0 ? (
          <p className="text-sm">
            <Muted>No quizzes imported.</Muted>
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {snapshot.quizzes.map((quiz) => (
              <li key={quiz.setId} className="card px-3 py-2">
                <code>{quiz.fileName}</code>{" "}
                <Muted>
                  · {quiz.set.questions.length} questions · imported{" "}
                  {new Date(quiz.importedAt).toLocaleString()}
                </Muted>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
          <Muted>Rejected ({snapshot.rejected.length})</Muted>
        </h2>
        {snapshot.rejected.length === 0 ? (
          <p className="text-sm">
            <Muted>Every file in the folder passed validation.</Muted>
          </p>
        ) : (
          <ul className="space-y-2">
            {snapshot.rejected.map((file) => (
              <li
                key={file.fileName}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--wrong)", background: "var(--wrong-soft)" }}
              >
                <code className="font-semibold">{file.fileName}</code>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {file.errors.map((error, index) => (
                    <li key={index} className="quiz-text">
                      {error}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {warned.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide">
            <Muted>Imported with warnings ({warned.length})</Muted>
          </h2>
          <ul className="space-y-2">
            {warned.map((quiz) => (
              <li
                key={quiz.setId}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--flag)", background: "var(--flag-soft)" }}
              >
                <code className="font-semibold">{quiz.fileName}</code>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {quiz.warnings.map((warning, index) => (
                    <li key={index} className="quiz-text">
                      {warning}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
