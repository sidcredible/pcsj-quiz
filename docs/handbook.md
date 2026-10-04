# PCSJ Quiz Platform – Developer Handbook

Oct 4, 2026 · @Siddhartha Anand

## 1. Overview

You will build a simple quiz web app. It reads one quiz JSON file, lets a candidate attempt it, scores it, and appends every response to one shared Google Sheet.

The quiz files are generated separately, on demand, by Sid's question generator for the Delhi Judicial Service (DJS) and UP PCS(J) exams. You never write quiz content. You only read it.

| Part | Owner | What it does |
| --- | --- | --- |
| Generator | Sid (already built) | Writes one validated JSON file per quiz and uploads it to the Google Drive folder PCSJ Quizzes |
| Quiz app | You | Lists the Drive folder newest first, lets the candidate pick a quiz, renders it, collects answers, scores, shows explanations |
| Response log | You | Writes the quiz's questions and each attempt's answers to one common Google Sheet |

&#91;embedded content: data flow · generator to Sheet, with the revision loop\]

Files flow left to right; past mistakes in the Sheet feed revision quizzes back into the app.

Three rules shape the whole build:

- **Nothing is hard-coded per quiz.** Title, question count, mix of question types, marks and exam focus all come from the file.
- **Two question types share one object.** `mcq` and `subjective` items differ only in a few fields (section 5).
- **Everything is logged.** Every quiz, every question and every answer lands in the same Sheet, keyed by stable ids, so Sid can revise and look for patterns years later.

## 2. Getting the JSON

Every quiz is one UTF-8 JSON file in a Google Drive folder named **PCSJ Quizzes**. The generator uploads each new quiz there as soon as it passes validation (a copy is also kept on Sid's PC). The app's job is to list that folder, show the quizzes newest first, and let the candidate pick one and attempt it.

| Item | Rule | Example |
| --- | --- | --- |
| Location | Google Drive folder `PCSJ Quizzes`, flat, quiz files only | Folder ID 1-qdGVaZd1hRQlrDTZEslGqpYVkayBVN9 |
| File name | `<set_id>.json`, where `set_id` = `YYYY-MM-DD_<topic-slug>` | `2026-10-04_pocso.json` |
| Same topic twice on one day | Suffix `-2`, `-3` | `2026-10-04_pocso-2.json` |
| Corrections | Same file name and same question ids; either the file is overwritten or a newer copy appears | Keep only the newest copy per `set_id` |
| Contract | JSON Schema draft 2020-12, version 1.1 | `set.schema.json` (Sid sends it) |
| Version check | `schema_version` must equal `"1.1"` | Skip and flag anything else |
| Size | Roughly 3–4 KB per question | 50 questions ≈ 170 KB |
| Encoding | UTF-8, plain English text, `\n` for line breaks, no HTML or markdown |  |

**How the app fetches quizzes**

1. **Access.** Create a Google Cloud service account with the Drive API (read-only scope `drive.readonly`) and the Sheets API enabled. Sid shares the `PCSJ Quizzes` folder with the service account's email as Viewer, and the Sheet as Editor. Keep the key on the server only.
2. **List.** On app load (and on a "Refresh" button, or every 10 minutes), call `files.list` with `q = "'<FOLDER_ID>' in parents and name contains '.json' and trashed = false"`, fields `id, name, modifiedTime, size`.
3. **Order.** Sort by `name` descending: the name starts with the date, so this is newest quiz first. Break ties by `modifiedTime`.
4. **De-duplicate.** If two files share a name, keep the one with the latest `modifiedTime`.
5. **Download and cache.** For each file not already cached, or whose `modifiedTime` changed, download it (`files.get` with `alt=media`), validate it against the schema, and cache the parsed quiz with its Drive `id` and `modifiedTime`. A changed file means a correction: re-upsert its `Quizzes` and `Questions` rows in the Sheet (section 8).
6. **Show.** The quiz list (section 6) shows only valid quizzes. A file that fails validation is hidden from candidates and shown to the admin with the error.
7. **Attempt.** The candidate selects a quiz from the list and starts it; the attempt references the quiz by `set_id`.

Validate with Ajv (JavaScript) or `jsonschema` (Python). Never write to the Drive folder: it is input only. The app needs no upload page.

The first quiz in the folder will be `2026-10-04_pocso.json` (50 questions, MCQ + subjective); use it as the reference sample.

## 3. Set-level structure (the per-quiz variables)

The top level of a file describes the quiz. Every value here varies by quiz and must drive the UI; nothing is fixed in code.

| Field | Type | Use in the app |
| --- | --- | --- |
| `schema_version` | `"1.1"` | Import check |
| `set_id` | string, `YYYY-MM-DD_slug` | Primary key of the quiz everywhere (URL, Sheet) |
| `created` | date `YYYY-MM-DD` | Shown on quiz card; sort order |
| `title` | string, optional | Quiz heading (fallback: `request.topic`) |
| `request.topic` | string | Topic label, filter |
| `request.question_count` | integer | What was asked for; the real count is `questions.length` and may be higher |
| `request.question_types` | `["mcq","subjective"]` | Show a badge per type present |
| `request.exam_focus` | `["DJS","UP-PCSJ"]` | Exam badges, filter |
| `request.sources_requested` | string\[\] | Info only |
| `law_basis` | string | "Law as on" note on the start screen |
| `pyq_analysis.related_pyqs` | string\[\] | Info only |
| `pyq_analysis.pattern_notes` | string | Optional "how this topic is examined" note on the start screen |
| `composition` | object | Start-screen summary (below) |
| `questions` | array | The items, already in display order (`number` 1..N) |

**`composition`** says how the set was filled. Show it on the start screen as one line, e.g. "50 questions: 16 previous-year, 14 from judgments, 20 new".

| Key | Meaning |
| --- | --- |
| `requested` | Count Sid asked for (a minimum) |
| `pyq` | Items with `basis = pyq` |
| `judgment` | Items with `basis` = `judgment_based` or `recent_development` |
| `generated` | Items with `basis` = `new` or `pyq_inspired` |
| `total` | Equals `questions.length` |
| `pyq_candidates_reviewed`, `excluded_pyqs[]`, `note` | Audit info; store, do not show to candidates |

Values the app must compute per quiz from the file, never assume:

- Number of questions = `questions.length`.
- Maximum score = sum of `marks` over all items (MCQ default 1 when `marks` is absent).
- Whether a subjective answer box is needed = any item with `type = subjective`.
- Suggested time = your choice of formula, e.g. 1 minute per MCQ + 1 minute per 10 words of `word_limit`; make it a setting, not a constant.

Trimmed example of the top level:

```json
{
  "schema_version": "1.1",
  "set_id": "2026-10-04_pocso",
  "created": "2026-10-04",
  "title": "POCSO Act, 2012 - 50-question practice set",
  "request": {"topic": "POCSO", "question_count": 50,
              "question_types": ["mcq", "subjective"],
              "exam_focus": ["DJS", "UP-PCSJ"]},
  "law_basis": "Protection of Children from Sexual Offences Act, 2012 ...",
  "composition": {"requested": 50, "pyq": 16, "judgment": 14,
                  "generated": 20, "total": 50},
  "questions": [ ... ]
}
```

## 4. The question object

Every item in `questions[]` uses the same object. Fields marked "when" appear only for some items; treat any missing optional field as empty.

**Identity and classification**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | `<set_id>_Q01`. Globally unique and stable: the key for the Sheet |
| `number` | integer | 1..N display order |
| `type` | `mcq` \| `subjective` | Picks the renderer |
| `mcq_style` | enum, when mcq | `direct`, `fact_based`, `statement_based`, `assertion_reason`, `match_list`, `case_based`, `numerical` |
| `subjective_style` | enum, when subjective | `problem`, `short_note`, `essay`, `short_answer`, `one_word`, `judgment_writing`, `drafting`, `explain` |
| `basis` | enum | `pyq` (real previous-year question), `pyq_inspired`, `new`, `judgment_based`, `recent_development` |
| `basis_refs` | string\[\] | PYQ ids and/or case names |
| `exam_focus` | string\[\] | `DJS`, `UP-PCSJ` |
| `subject_code` | string | e.g. `SPECIAL` (special Acts), `DRAFTING`; use as a filter |
| `topic` | string | Sub-topic, e.g. "Medical examination (s.27)" |
| `tags` | string\[\] | Free tags; good for pattern analysis |

**What the candidate sees**

| Field | Type | Notes |
| --- | --- | --- |
| `question` | string | The stem. May contain `\n` |
| `statements[]` | `{key, text}` | When statement-type: numbered statements shown under the stem |
| `assertion`, `reason` | string | When `mcq_style = assertion_reason` |
| `match` | object | When `mcq_style = match_list`: `list_i_title`, `list_ii_title`, `list_i[]`, `list_ii[]` (each `{key, text}`) |
| `options[]` | `{key, text}` | MCQ only; keys `a`–`e` in order |
| `marks` | number | Required for subjective; optional for MCQ (default 1) |
| `word_limit` | integer | Subjective; show as "About N words" |

**Answer key and feedback (show only after submit)**

| Field | Type | Notes |
| --- | --- | --- |
| `answer` | string\[\] \| null | MCQ: correct key(s), e.g. `["c"]`. Subjective: always `null` |
| `marking_points[]` | `{point, marks}` | Subjective: scoring rubric; marks sum to `marks` |
| `explanation.why_correct` | string | Always present |
| `explanation.why_others_wrong` | `{key: text}` | MCQ: one entry per wrong option |
| `explanation.model_answer` | string | Subjective: full model answer |
| `explanation.provisions[]` | `{act, section, old_law_equivalent, note}` | Law sections relied on |
| `explanation.cases[]` | `{name, court, decided, citation, bench, point}` | `citation`/`bench` may be null |
| `explanation.exam_tip` | string | One-line tip |
| `resources[]` | `{title, url, kind}` | Links (https). `kind`: `bare_act`, `judgment`, `case_report`, `commentary`, `official` |

**Provenance (store; show a small "PYQ" badge, rest optional)**

| Field | When | Notes |
| --- | --- | --- |
| `source_pyqs[]` | `basis = pyq` | `{pyq_id, exam, stage, year, paper, q_no}`. Render as "DJS Prelims 2019" badges |
| `pyq_original` | `basis = pyq` | The question as originally printed (often under the old IPC/CrPC); optional "see original" toggle |
| `adaptation` | `basis = pyq` | `{adapted, note}`, e.g. "IPC 376 → BNS 64" |
| `answer_provenance` | `basis = pyq` | `{method, publisher_answer, note}` |
| `verification` | always | `{status, checked_against[], note}`; store only |

## 5. MCQ vs subjective

Samples below are trimmed ("..." marks cut text); the plain MCQ is illustrative, the others come from the POCSO file. Switch on `type`. The two types differ in five fields; everything else is shared.

| Field | `mcq` | `subjective` |
| --- | --- | --- |
| Style field | `mcq_style` (required) | `subjective_style` (required) |
| `options` | Required, 2–5 items | Absent |
| `answer` | Array of keys, e.g. `["b"]` | Always `null` |
| `marks` | Optional (default 1) | Required |
| `word_limit` | Absent | Usually present |
| `marking_points` | Absent | Required; marks add up to `marks` |
| Feedback | `why_correct` + `why_others_wrong` | `model_answer` + `marking_points` + `why_correct` |

**MCQ, plain (`direct`, `fact_based`, `case_based`, `numerical`)**: stem + options only.

```json
{"id": "2026-10-04_example_Q01", "number": 1, "type": "mcq", "mcq_style": "direct",
 "question": "Under the POCSO Act, a 'child' means any person below the age of",
 "options": [{"key": "a", "text": "16 years"}, {"key": "b", "text": "18 years"},
             {"key": "c", "text": "14 years"}, {"key": "d", "text": "21 years"}],
 "answer": ["b"], "explanation": {"why_correct": "...", "why_others_wrong": {"a": "...", "c": "...", "d": "..."}}}
```

**MCQ, `statement_based`**: numbered statements under the stem, options refer to them ("1 and 2 only"). Some statement questions put the statements inside the options instead; then `statements` is absent and you just render options.

```json
{"mcq_style": "statement_based",
 "question": "Consider the following statements and choose the correct option.",
 "statements": [{"key": "I", "text": "..."}, {"key": "II", "text": "..."}],
 "options": [{"key": "a", "text": "I only"}, {"key": "b", "text": "II only"},
             {"key": "c", "text": "Both I and II"}, {"key": "d", "text": "Neither I nor II"}],
 "answer": ["c"]}
```

**MCQ, `assertion_reason`**: two labelled blocks, then the standard four options.

```json
{"mcq_style": "assertion_reason",
 "question": "Read the assertion and the reason, then choose the correct option.",
 "assertion": "A conviction under POCSO can rest on the testimony of the child victim alone ...",
 "reason": "The Supreme Court held in Bhanei Prasad @ Raju v. State of Himachal Pradesh (2025) ...",
 "options": [{"key": "a", "text": "The assertion is false but the reason is true"}, "..."],
 "answer": ["b"]}
```

**MCQ, `match_list`**: two side-by-side lists, options are codes like "I-B, II-C, III-A, IV-D".

```json
{"mcq_style": "match_list",
 "match": {"list_i_title": "List I (offence)", "list_ii_title": "List II (punishment)",
           "list_i": [{"key": "I", "text": "Sexual assault (s.8)"}, "..."],
           "list_ii": [{"key": "A", "text": "Imprisonment which may extend to 3 years, and fine"}, "..."]},
 "options": [{"key": "c", "text": "I-B, II-C, III-A, IV-D"}, "..."],
 "answer": ["c"]}
```

**Subjective (any `subjective_style`)**: stem, marks, word limit, free-text answer box. No options; `answer` is `null`.

```json
{"id": "2026-10-04_pocso_Q13", "type": "subjective", "subjective_style": "short_answer",
 "marks": 3, "word_limit": 30,
 "question": "What is the punishment for aggravated sexual assault under the POCSO Act, 2012?",
 "answer": null,
 "marking_points": [
   {"point": "Aggravated sexual assault is punished under s.10 ...", "marks": 1},
   {"point": "Imprisonment of either description for not less than 5 years, which may extend to 7 years.", "marks": 1.5},
   {"point": "Liability to fine as well.", "marks": 0.5}],
 "explanation": {"why_correct": "...", "model_answer": "..."}}
```

`answer` is an array so a future multi-correct MCQ needs no format change. Treat it as a set: correct only if the chosen keys equal the answer keys exactly.

## 6. Rendering the quiz

Four screens are enough. Build them once; every quiz fills them from its own file.

1. **Quiz list.** One card per imported file: `title`, `created`, exam badges, question count, type badges, and the candidate's last score if any. Filters: topic, exam, subject.
2. **Start screen.** Title, `law_basis`, composition line, number of questions, maximum marks, time (if timed), candidate name or login, Start button.
3. **Attempt screen.** One question per page with a question palette (answered / skipped / marked for review), Previous / Next, and Submit. Hide `answer`, `explanation`, `marking_points` and provenance until submit.
4. **Review screen.** Score summary, then every question with the candidate's answer, the correct answer and the explanation.

**Per-style rendering on the attempt screen**

| Style | Render |
| --- | --- |
| `direct`, `fact_based`, `case_based`, `numerical` | Stem, then radio options `(a)`–`(e)` |
| `statement_based` | Stem, then `statements` as a list labelled by their `key` ("I.", "II."), then radio options |
| `assertion_reason` | Stem, then two boxes "Assertion (A)" and "Reason (R)", then radio options |
| `match_list` | Stem, then a two-column table: `list_i_title` / `list_ii_title`, rows paired by position, each item prefixed with its key; then radio options |
| any subjective style | Stem, "\[`marks` marks, about `word_limit` words\]", a textarea with a live word count; for `drafting` and `judgment_writing` give a taller box |

Generic rules: render fields when present regardless of style (a `case_based` item could carry `statements`); one MCQ answer = radio buttons, `answer.length > 1` = checkboxes; show a "PYQ · DJS Prelims 2019" badge from `source_pyqs` when `basis = pyq`.

**Review screen per item**

- MCQ: options with the correct one marked green and a wrong pick red; `why_correct`; `why_others_wrong` as a list under each wrong option (look up by key); provisions; cases; `exam_tip`; `resources` as links opening in a new tab.
- Subjective: the candidate's text; `model_answer`; `marking_points` as a checklist the candidate ticks for self-scoring (section 7); provisions, cases, tip, resources.
- Optional "Original PYQ" toggle showing `pyq_original.question` and `adaptation.note`, so the candidate sees how an old IPC/CrPC question was moved to BNS/BNSS/BSA.

**Text handling**

- All strings are plain text. Render `\n` as a line break (CSS `white-space: pre-line`). Escape everything; never inject as HTML.
- Never shuffle option keys without remapping `answer` and `why_others_wrong`. Simplest: do not shuffle in v1. Explanations never mention option letters, so shuffling is safe later if you remap.
- Mobile first: most candidates will use a phone. Match-list tables must fit 360 px width (stack the lists on narrow screens).
- Tablet second: from 768 px the type and the tap targets grow a step; from 1024 px the attempt screen puts the question palette in a sticky column beside the question and the quiz list runs two cards across. Arrow keys move between questions for anyone with a keyboard attached.

## 7. Scoring

MCQs are scored automatically on submit; subjective items are self-scored by the candidate on the review screen against `marking_points`.

| Case | Result | Score |
| --- | --- | --- |
| MCQ, chosen keys = `answer` (as a set) | `correct` | `marks` (default 1) |
| MCQ, any other choice | `wrong` | `-negative_marking × marks` (a quiz setting, default 0) |
| MCQ, nothing chosen | `skipped` | 0 |
| Subjective, text submitted | `pending_self_score`, then `self_scored` | Sum of ticked `marking_points[].marks` |
| Subjective, empty | `skipped` | 0 |

Rules:

- Negative marking is an app setting chosen per attempt or per quiz (e.g. 0 or 0.25), not a file field. Record the value used in the Sheet.
- Report three totals: MCQ score, subjective score (once self-scored) and overall, each out of its maximum.
- An attempt is complete when submitted; self-scoring can happen later and updates the same rows.
- Optional v2: AI-assisted scoring of subjective answers against `marking_points`. Store it in a separate column so self and AI scores can be compared.

## 8. The common Google Sheet

All quizzes and all attempts go into ONE Google Sheet, "PCSJ Quiz Log", with four tabs. Questions are stored once; each answer is one row that points to its question by `question_id`. Never create a sheet per quiz.

**Tab `Quizzes`**: one row per imported file, written on import.

| Column | Source |
| --- | --- |
| set\_id | `set_id` (key) |
| title, topic, created | `title`, `request.topic`, `created` |
| exam\_focus | `request.exam_focus` joined with ", " |
| requested, total, pyq, judgment, generated | `composition` |
| pyq\_candidates\_reviewed, excluded\_count | `composition` |
| max\_marks | Computed |
| law\_basis | `law_basis` |
| imported\_at, file\_name, schema\_version | App |

**Tab `Questions`**: one row per question, written on import; re-importing a corrected file overwrites rows with the same `question_id`.

| Column | Source |
| --- | --- |
| question\_id | `id` (key) |
| set\_id, number | `set_id`, `number` |
| type, style | `type`, `mcq_style` or `subjective_style` |
| basis, subject\_code, topic, tags | Same names; tags joined with ", " |
| exam\_focus | Joined |
| question\_text | `question` + statements / assertion / reason / match lists flattened as text |
| option\_a … option\_e | `options[].text` by key |
| correct\_answer | `answer` joined, or blank for subjective |
| marks, word\_limit | Same |
| marking\_points | `point (marks)` lines joined with `\n` |
| why\_correct, model\_answer, exam\_tip | `explanation` |
| why\_others\_wrong | `a: text` lines joined |
| provisions | `act section (old: x)` lines joined |
| cases | `name, court, decided` lines joined |
| resources | URLs joined with `\n` |
| pyq\_sources | `source_pyqs` as "DJS-Prelims-2019-Q12" joined |
| pyq\_years | Years joined, e.g. "2015, 2019" |
| adapted\_from\_old\_law | `adaptation.adapted` |
| answer\_provenance | `answer_provenance.method` |
| verification\_status | `verification.status` |
| json | The full question object as JSON (lossless backup) |

**Tab `Attempts`**: one row per attempt, written on submit.

| Column | Notes |
| --- | --- |
| attempt\_id | UUID (key) |
| set\_id | The quiz |
| candidate | Name or email |
| started\_at, submitted\_at, duration\_sec | ISO timestamps, Asia/Kolkata |
| mode | `practice` or `timed` |
| negative\_marking | Value used |
| attempted, correct, wrong, skipped | MCQ counts |
| mcq\_score, subjective\_score, total\_score, max\_score, percent | Totals |
| device | `mobile` / `desktop` |

**Tab `Responses`**: one row per question per attempt, written on submit. This is the main revision log.

| Column | Notes |
| --- | --- |
| response\_id | `<attempt_id>_<question_id>` (key) |
| attempt\_id, set\_id, question\_id, candidate | Keys |
| answered\_at | Timestamp |
| question\_number, type, style, basis, subject\_code, topic, tags | Copied from `Questions` so the tab can be filtered alone |
| question\_text | Short copy (first 300 characters) for readability |
| chosen\_answer | Keys joined, e.g. "b"; blank if skipped |
| correct\_answer | From the file |
| result | `correct`, `wrong`, `skipped`, `pending_self_score`, `self_scored` |
| subjective\_text | The candidate's written answer |
| points\_ticked | Indexes of `marking_points` ticked |
| score, max\_marks | Numbers |
| time\_spent\_sec | Time on this question |
| changed\_answer | TRUE if the choice was changed before submit |
| marked\_for\_review | TRUE if flagged during the attempt |
| confidence | Optional: `sure` / `guess`, if you add the toggle |
| revisit\_flag, notes | Candidate's "revise this" star and own note, editable later |

**How to write**

1. Use the Google Sheets API v4 with a service account; share the Sheet with that account. Keep the credentials server-side only.
2. On import: upsert `Quizzes` and `Questions` (match on key; update, else append).
3. On submit: append one `Attempts` row and N `Responses` rows in one `values.append` batch call. Keep a local queue and retry if Google is unreachable, so no attempt is lost.
4. Self-scoring and revisit flags update existing `Responses` rows by `response_id`, then recompute the `Attempts` totals.
5. Never delete rows. A corrected quiz file keeps the same question ids, so old responses stay linked.

Scale check: a 50-question quiz adds 50 response rows per attempt; at 2 attempts a day that is about 36,500 rows a year, well inside a Sheet's 10-million-cell limit at about 25 columns. Archive `Responses` by year if it ever grows past \~300,000 rows.

## 9. Revision and pattern analysis

The Sheet is built so these questions can be answered later with a filter or a pivot table, with no code. Add a fifth tab `Insights` with these as saved formulas or pivots, or build the same views as screens in the app.

| Question Sid will ask | How (on `Responses`, joined to `Questions` by `question_id`) |
| --- | --- |
| Which questions did I get wrong, ever? | Filter `result = wrong`; group by `question_id` |
| What should I revise today? | Wrong or `revisit_flag = TRUE`, oldest `answered_at` first; a "Revision quiz" button that builds a quiz from those question ids |
| Which topics are weakest? | Accuracy % by `topic` and by `subject_code` |
| Am I weaker on PYQs or on judgment questions? | Accuracy by `basis` |
| Which question formats trip me up? | Accuracy by `style` (assertion-reason, match-list, …) |
| Am I improving? | `percent` from `Attempts` over `submitted_at`, per topic |
| Where am I slow? | Average `time_spent_sec` by `style` and `topic` |
| Do I change right answers to wrong ones? | `changed_answer = TRUE` split by `result` |
| Which areas does each exam favour? | Count of `Questions` with `basis = pyq` by `topic` and `pyq_years` |
| Which subjective points do I keep missing? | `points_ticked` vs all `marking_points` for that question |

A revision quiz needs no new file: the app assembles a session from existing question ids (taken from any set) and logs it like a normal attempt, with `set_id = revision_<date>`. Because each question id is permanent, a question answered in three different sessions shows its full history.

## 10. Edge cases and acceptance checklist

**Edge cases to handle**

- `questions.length` greater than `request.question_count` is normal (the count is a minimum). Always use the real length.
- A quiz may be all MCQ, all subjective or mixed.
- Optional fields may be absent or `null` (`statements`, `match`, `cases`, `citation`, `bench`, `old_law_equivalent`, `word_limit`, `exam_tip`). Render nothing for them.
- Options can number 2 to 5; keys are always consecutive from `a`.
- `marks` can be a decimal (e.g. 1.5).
- A corrected file can replace an existing `set_id`. Keep ids, upsert `Questions`, keep past responses; record `imported_at`.
- Unknown future fields: ignore them, but keep the whole object in the `json` column.

**Acceptance checklist**

- [ ] With the Drive folder shared, the app lists `2026-10-04_pocso.json` at the top, passes schema validation and creates 1 `Quizzes` row and 50 `Questions` rows.
- [ ] A file failing the schema is rejected with a readable error.
- [ ] Start screen shows title, composition line (16 / 14 / 20), 50 questions and the computed max marks.
- [ ] All seven MCQ styles and the subjective layout render correctly on a 360 px phone and on desktop.
- [ ] No answer, explanation or rubric is visible (including in page source / network payload) before submit.
- [ ] Submit writes 1 `Attempts` row and 50 `Responses` rows; totals match the review screen.
- [ ] Self-scoring a subjective item updates its `Responses` row and the attempt totals.
- [ ] Offline or Google error on submit: the attempt is queued and written later, never lost.
- [ ] Re-importing the same file creates no duplicate rows.
- [ ] A revision quiz built from wrong answers across two sets works and is logged.
- [ ] Links in `resources` open in a new tab; `\n` shows as line breaks; no HTML is interpreted.

**Hand-over files:** `Generated\_schema\set.schema.json` (the contract) and `Generated\2026-10-04_pocso.json` (the reference sample). Sid will send the schema and share the Drive folder ID and the Sheet.
