/**
 * A past attempt, reopened. Rendered on the server from the log, so the page
 * is complete on first paint and shows exactly what the candidate saw when
 * they submitted — explanations, rubric and all.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultView } from "@/components/ResultView";
import { Notice } from "@/components/primitives";
import { ConfigError } from "@/lib/config";
import { loadAttemptReview } from "@/lib/sheets/log";
import { NotConfiguredError, requireConfig, syncQuizzes } from "@/lib/server/quiz-service";

export const dynamic = "force-dynamic";

export default async function AttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;

  let config;
  try {
    config = requireConfig();
  } catch (error) {
    if (error instanceof NotConfiguredError || error instanceof ConfigError) {
      return (
        <div>
          <Notice tone="error">{error.message}</Notice>
          <Link href="/" className="text-sm underline underline-offset-2">
            ← Home
          </Link>
        </div>
      );
    }
    throw error;
  }

  await syncQuizzes().catch(() => undefined);
  const found = await loadAttemptReview(config.sheetId, decodeURIComponent(attemptId));
  if (!found) notFound();

  return (
    <ResultView
      review={found.review}
      heading={found.heading}
      title="Past attempt"
      backHref="/"
      backLabel="← Home"
    />
  );
}
