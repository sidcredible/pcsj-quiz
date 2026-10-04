# PCSJ Quiz

A quiz app for the Delhi Judicial Service (DJS) and UP PCS(J) examinations.

It reads quiz JSON files from a Google Drive folder, lets a candidate attempt
one, scores it, and logs every quiz, question and answer to a single Google
Sheet so attempts can be revised and analysed years later.

This app never writes quiz content. Quizzes are produced separately by Sid's
question generator and uploaded to Drive; the app only reads them.

## How it fits together

```
generator → Drive folder "PCSJ Quizzes" → this app → Sheet "PCSJ Quiz Log"
                                              ↑                   │
                                              └── revision quizzes ┘
```

Three rules from the handbook shape the whole build:

- **Nothing is hard-coded per quiz.** Title, question count, mix of types,
  marks and exam focus all come from the file. Question count is always
  `questions.length`, never `request.question_count`; maximum marks is always
  summed from the questions.
- **Two question types share one object.** `mcq` and `subjective` differ in a
  few fields and are rendered by the same components.
- **Everything is logged**, keyed by stable ids, so a question answered in
  three sessions shows its full history.

## Running it

### Local mode — no Google account needed

The fastest way to see it working. Quizzes come from a local directory and
attempts are logged to a local file instead of the Sheet.

```bash
npm install
npx tsx scripts/write-sample-fixture.ts     # writes fixtures/2026-10-04_sample.json
QUIZ_FIXTURE_DIR=./fixtures SHEETS_DRY_RUN=1 npm run dev
```

Drop real generator output into `fixtures/` to work against actual quizzes.
JSON files there are gitignored — quiz content is not kept in this repository.
The dry-run log lands in `.dry-run/log.json` with the same four tabs the Sheet
has.

### Connected to Drive and the Sheet

1. **Create a Google Cloud service account** and enable the **Drive API** and
   the **Sheets API** on its project. Create a JSON key.
2. **Share the Drive folder** `PCSJ Quizzes` with the service account's email
   as **Viewer** — read-only is all the app asks for, and it never writes
   there.
3. **Share the Sheet** `PCSJ Quiz Log` with the same email as **Editor**. A
   blank Sheet is fine: the four tabs and their header rows are created on
   first use.
4. **Set the environment** (copy `.env.example` to `.env.local`):

   ```
   GOOGLE_SERVICE_ACCOUNT_KEY={"client_email":"…","private_key":"…"}
   DRIVE_FOLDER_ID=1-qdGVaZd1hRQlrDTZEslGqpYVkayBVN9
   SHEET_ID=…
   ```

   The key is read server-side only and is never sent to the browser.
5. `npm run dev`, or deploy to Vercel with the same variables set in the
   project settings.

`/admin` shows what imported, what was rejected and why, and any file that
imported with warnings.

### When a deployment says "not configured"

Open **`/api/health`** on the deployment. It names the variable that is
missing or malformed and what to do about it. `/api/health?check=google` goes
further and proves the service account can actually list the Drive folder and
open the Sheet, which is a different thing from the variables being present.

It reports presence, length and JSON-parse status only — never a value, and
never any part of the private key — so it is safe to open on a public
deployment and safe to paste into a bug report.

The usual cause on Vercel is a variable added *after* the last build: adding
one does not reach already-deployed functions, so redeploy. The second usual
cause is the variable being set for only one environment — tick Production,
Preview and Development.

## How answers are kept secret

The acceptance criterion is that no answer, explanation or rubric is visible
before submit — "including in page source / network payload". The only way to
guarantee that is not to send them:

- `lib/quiz/redact.ts` builds a `CandidateQuiz` with no `answer`,
  `explanation`, `marking_points`, `pyq_original`, `answer_provenance` or
  `verification` field at all. That is what the attempt screen receives, in
  the API response and in the server-rendered HTML alike.
- Because the browser has no answer key, **scoring happens on the server**
  (`lib/quiz/score.ts`), and the submission body carries only what the
  candidate did. A `score` or `result` field sent by a client is ignored.
- The review payload, with the answer key, is returned by the submit response
  — once it can no longer affect the result.

Even after submit, the fields section 3 marks "store, do not show"
(`excluded_pyqs`, `verification`) never reach the browser.

## Losing an attempt

An attempt is written to `localStorage` **before** it is sent and removed only
once the server confirms it is logged. It is re-sent on the next page load, so
an outage, a closed tab or a flat battery costs nothing. Retries are safe
because `attempt_id` is a UUID generated once: the server adds only rows that
attempt does not already have, so a retry cannot double-log, and cannot undo a
self-score made in between.

## Layout of the code

| Path | What lives there |
| --- | --- |
| `schema/set.schema.json` | The generator's contract (draft 2020-12, v1.1) |
| `src/lib/quiz/types.ts` | Types mirroring the schema, and the per-quiz computed values |
| `src/lib/quiz/validate.ts` | Version gate, Ajv validation, readable errors, consistency warnings |
| `src/lib/quiz/redact.ts` | What a candidate may see before submit |
| `src/lib/quiz/score.ts` | Scoring (section 7) |
| `src/lib/quiz/review.ts` | What is released after submit |
| `src/lib/quiz/registry.ts` | The quiz cache, correction detection, import orchestration |
| `src/lib/drive/` | Drive listing and download, and the local fixture source |
| `src/lib/sheets/` | Columns, row mapping, the Sheets client, and the dry-run sink |
| `src/lib/client/queue.ts` | The offline submit queue |
| `src/components/` | The four screens |

## Checks

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

## Not built yet

Deliberately left for after the first real attempts, per the agreed v1 scope:

- **Revision quizzes** (handbook section 9) — assembling a session from
  question ids that were answered wrong or flagged, logged as
  `set_id = revision_<date>`. The Sheet already records everything this needs.
- **The `Insights` tab** of saved pivots.
- **AI-assisted scoring** of subjective answers (section 7, "optional v2").

## Toolchain note

Pinned to Next 15.5.27. Next 16.3.8 cannot build in this environment at all:
it fails prerendering its own `/_global-error` with a null React context,
reproduced on a trivial two-file app, so it is not this code. `npm audit`
reports no production vulnerabilities; the remaining dev-only advisory is a
transitive `fast-glob` in `eslint-config-next`, whose only "fix" is an older
version of that package.
