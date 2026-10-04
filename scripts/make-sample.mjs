/**
 * Writes the renderer sample set into ./fixtures so the app can be run with
 * QUIZ_FIXTURE_DIR and no Google credentials. Not part of the build.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { register } from "node:module";

const { SAMPLE_SET } = await import("../src/lib/quiz/__fixtures__/sample-set.ts");
await mkdir("fixtures", { recursive: true });
const name = `fixtures/${SAMPLE_SET.set_id}.json`;
await writeFile(name, JSON.stringify(SAMPLE_SET, null, 2), "utf8");
console.log(`wrote ${name}`);
