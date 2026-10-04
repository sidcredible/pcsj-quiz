/**
 * Writes the renderer sample set into ./fixtures, so the app can be run with
 * QUIZ_FIXTURE_DIR and no Google credentials:
 *
 *   npx tsx scripts/write-sample-fixture.ts
 *   QUIZ_FIXTURE_DIR=./fixtures SHEETS_DRY_RUN=1 npm run dev
 */

import { mkdir, writeFile } from "node:fs/promises";
import { SAMPLE_SET } from "../src/lib/quiz/__fixtures__/sample-set";

async function main(): Promise<void> {
  const name = `fixtures/${SAMPLE_SET.set_id}.json`;
  await mkdir("fixtures", { recursive: true });
  await writeFile(name, `${JSON.stringify(SAMPLE_SET, null, 2)}\n`, "utf8");
  console.log(`wrote ${name} (${SAMPLE_SET.questions.length} questions)`);
}

void main();
