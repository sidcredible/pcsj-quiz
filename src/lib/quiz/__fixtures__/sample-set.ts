/**
 * A synthetic quiz set that exercises every renderer path: all seven MCQ
 * styles, a multi-correct MCQ, and subjective items with and without a word
 * limit. It is validated against the real schema in validate.test.ts, so it
 * doubles as a check that the app's reading of the contract is correct.
 *
 * The real reference file is 2026-10-04_pocso.json in the PCSJ Quizzes Drive
 * folder; drop a copy into /fixtures to test against actual generator output.
 */

import type { Question, QuizSet } from "../types";

const verification = {
  status: "verified" as const,
  checked_against: ["Bare Act"],
};

const explanation = {
  why_correct: "Section 2(1)(d) defines a child as a person below 18 years.",
  provisions: [
    {
      act: "POCSO Act, 2012",
      section: "2(1)(d)",
      old_law_equivalent: null,
      note: "Definition clause.",
    },
  ],
};

function mcq(overrides: Partial<Question> & Pick<Question, "id" | "number">) {
  const base: Question = {
    id: overrides.id,
    number: overrides.number,
    type: "mcq",
    mcq_style: "direct",
    basis: "new",
    subject_code: "SPECIAL",
    topic: "Definitions (s.2)",
    question: "Under the POCSO Act, a 'child' means any person below the age of",
    options: [
      { key: "a", text: "16 years" },
      { key: "b", text: "18 years" },
      { key: "c", text: "14 years" },
      { key: "d", text: "21 years" },
    ],
    answer: ["b"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        a: "16 is the age under an earlier bill, not the Act.",
        c: "14 years is the child-labour threshold.",
        d: "21 years has no bearing on POCSO.",
      },
    },
    resources: [
      {
        title: "POCSO Act, 2012",
        url: "https://www.indiacode.nic.in/handle/123456789/2079",
        kind: "bare_act",
      },
    ],
    verification,
  };
  return { ...base, ...overrides };
}

export const SAMPLE_QUESTIONS: Question[] = [
  mcq({ id: "2026-10-04_sample_Q01", number: 1, mcq_style: "direct" }),

  mcq({
    id: "2026-10-04_sample_Q02",
    number: 2,
    mcq_style: "fact_based",
    marks: 2,
  }),

  mcq({
    id: "2026-10-04_sample_Q03",
    number: 3,
    mcq_style: "statement_based",
    question: "Consider the following statements and choose the correct option.",
    statements: [
      { key: "I", text: "POCSO is gender-neutral as to the victim." },
      { key: "II", text: "Consent of a child is a valid defence." },
    ],
    options: [
      { key: "a", text: "I only" },
      { key: "b", text: "II only" },
      { key: "c", text: "Both I and II" },
      { key: "d", text: "Neither I nor II" },
    ],
    answer: ["a"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        b: "Consent of a child is irrelevant under the Act.",
        c: "Statement II is wrong.",
        d: "Statement I is correct.",
      },
    },
  }),

  mcq({
    id: "2026-10-04_sample_Q04",
    number: 4,
    mcq_style: "assertion_reason",
    question: "Read the assertion and the reason, then choose the correct option.",
    assertion:
      "A conviction under POCSO can rest on the testimony of the child victim alone.",
    reason:
      "Corroboration is a rule of prudence, not a rule of law, where the testimony inspires confidence.",
    options: [
      { key: "a", text: "Both A and R are true and R explains A" },
      { key: "b", text: "Both A and R are true but R does not explain A" },
      { key: "c", text: "A is true but R is false" },
      { key: "d", text: "A is false but R is true" },
    ],
    answer: ["a"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        b: "The reason is precisely why the assertion holds.",
        c: "The reason is a correct statement of law.",
        d: "The assertion is true.",
      },
    },
  }),

  mcq({
    id: "2026-10-04_sample_Q05",
    number: 5,
    mcq_style: "match_list",
    question: "Match List I with List II and choose the correct option.",
    match: {
      list_i_title: "List I (offence)",
      list_ii_title: "List II (minimum punishment)",
      list_i: [
        { key: "I", text: "Sexual assault (s.8)" },
        { key: "II", text: "Aggravated sexual assault (s.10)" },
        { key: "III", text: "Sexual harassment (s.12)" },
      ],
      list_ii: [
        { key: "A", text: "Three years" },
        { key: "B", text: "Five years" },
        { key: "C", text: "Imprisonment up to three years" },
      ],
    },
    options: [
      { key: "a", text: "I-A, II-B, III-C" },
      { key: "b", text: "I-B, II-A, III-C" },
      { key: "c", text: "I-C, II-B, III-A" },
      { key: "d", text: "I-A, II-C, III-B" },
    ],
    answer: ["a"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        b: "Section 8 carries three years, not five.",
        c: "Section 8 is not punishable only up to three years.",
        d: "Section 10 carries five years.",
      },
    },
  }),

  mcq({
    id: "2026-10-04_sample_Q06",
    number: 6,
    mcq_style: "case_based",
    basis: "judgment_based",
    question:
      "A 17-year-old is examined by a doctor without a female attendant present. Which provision is engaged?",
  }),

  mcq({
    id: "2026-10-04_sample_Q07",
    number: 7,
    mcq_style: "numerical",
    question:
      "Within how many days must the Special Court complete the trial, as far as possible, from taking cognizance?",
    options: [
      { key: "a", text: "30 days" },
      { key: "b", text: "60 days" },
      { key: "c", text: "One year" },
      { key: "d", text: "Two years" },
    ],
    answer: ["c"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        a: "30 days is the period for recording the child's statement.",
        b: "60 days is not the trial period.",
        d: "Two years has no statutory basis here.",
      },
    },
  }),

  // Multi-correct: proves the UI switches to checkboxes and that scoring
  // compares key sets rather than single values.
  mcq({
    id: "2026-10-04_sample_Q08",
    number: 8,
    mcq_style: "direct",
    question: "Which of the following are aggravating circumstances? (Pick two.)",
    options: [
      { key: "a", text: "Offence by a police officer" },
      { key: "b", text: "Offence causing grievous hurt" },
      { key: "c", text: "Offence reported within 24 hours" },
      { key: "d", text: "Victim aged above 16 years" },
    ],
    answer: ["a", "b"],
    explanation: {
      ...explanation,
      why_others_wrong: {
        c: "Prompt reporting is not an aggravating circumstance.",
        d: "Age above 16 is not, of itself, aggravating.",
      },
    },
  }),

  // A real PYQ, which the schema requires to carry full provenance.
  mcq({
    id: "2026-10-04_sample_Q09",
    number: 9,
    mcq_style: "direct",
    basis: "pyq",
    question: "The POCSO Act extends to",
    options: [
      { key: "a", text: "The whole of India" },
      { key: "b", text: "The whole of India except one State" },
      { key: "c", text: "Union territories only" },
      { key: "d", text: "States that adopt it by resolution" },
    ],
    answer: ["a"],
    basis_refs: ["DJS-PRE-2019-Q12"],
    source_pyqs: [
      {
        pyq_id: "DJS-PRE-2019-Q12",
        exam: "DJS",
        stage: "prelims",
        year: 2019,
        paper: "Preliminary",
        q_no: 12,
      },
    ],
    pyq_original: {
      question: "The Protection of Children from Sexual Offences Act extends to",
      options: null,
      source_answer: ["a"],
      source_answer_status: "official key",
    },
    adaptation: { adapted: false, note: "No new-law change needed." },
    answer_provenance: { method: "official_key", publisher_answer: ["a"] },
    explanation: {
      ...explanation,
      why_others_wrong: {
        b: "No State is excluded.",
        c: "It is not limited to union territories.",
        d: "No adoption by resolution is required.",
      },
    },
  }),

  {
    id: "2026-10-04_sample_Q10",
    number: 10,
    type: "subjective",
    subjective_style: "short_answer",
    basis: "new",
    subject_code: "SPECIAL",
    topic: "Punishment (s.10)",
    question:
      "What is the punishment for aggravated sexual assault under the POCSO Act, 2012?",
    answer: null,
    marks: 3,
    word_limit: 30,
    marking_points: [
      { point: "Aggravated sexual assault is punished under s.10.", marks: 1 },
      {
        point:
          "Imprisonment of either description for not less than 5 years, extendable to 7 years.",
        marks: 1.5,
      },
      { point: "Liability to fine as well.", marks: 0.5 },
    ],
    explanation: {
      why_correct: "Section 10 prescribes the punishment.",
      model_answer:
        "Aggravated sexual assault under s.9 is punished by s.10 with imprisonment of either description for not less than five years, which may extend to seven years, and with fine.",
      provisions: [
        { act: "POCSO Act, 2012", section: "10", old_law_equivalent: null },
      ],
      exam_tip: "Quote the five-to-seven-year range verbatim.",
    },
    resources: [],
    verification,
  },

  // Subjective with no word limit: timing and rendering must not assume one.
  {
    id: "2026-10-04_sample_Q11",
    number: 11,
    type: "subjective",
    subjective_style: "judgment_writing",
    basis: "new",
    subject_code: "DRAFTING",
    topic: "Judgment writing",
    question:
      "Draft the operative portion of a judgment convicting an accused under s.10 of the POCSO Act.",
    answer: null,
    marks: 10,
    marking_points: [
      { point: "Correct charge and section stated.", marks: 4 },
      { point: "Sentence within the statutory range.", marks: 4 },
      { point: "Direction on victim compensation.", marks: 2 },
    ],
    explanation: {
      why_correct: "A conviction must state the section, sentence and fine.",
      model_answer: "In the result, the accused is convicted under s.10 ...",
      provisions: [{ act: "POCSO Act, 2012", section: "10" }],
    },
    resources: [],
    verification,
  },
];

export const SAMPLE_SET: QuizSet = {
  schema_version: "1.1",
  set_id: "2026-10-04_sample",
  created: "2026-10-04",
  title: "POCSO Act, 2012 - renderer sample set",
  request: {
    topic: "POCSO",
    question_count: 10,
    question_types: ["mcq", "subjective"],
    exam_focus: ["DJS", "UP-PCSJ"],
  },
  law_basis:
    "Protection of Children from Sexual Offences Act, 2012 as amended to date.",
  pyq_analysis: {
    related_pyqs: ["DJS-PRE-2019-Q12"],
    pattern_notes: "Definitions and punishment sections dominate prelims.",
  },
  composition: {
    requested: 10,
    pyq: 1,
    judgment: 1,
    generated: 9,
    total: 11,
    pyq_candidates_reviewed: 4,
    note: "total exceeds requested, which is normal.",
  },
  questions: SAMPLE_QUESTIONS,
};
