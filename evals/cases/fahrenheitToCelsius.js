import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
    "fahrenheit-to-celsius"
);

export default {
    id: "fahrenheit-to-celsius",
    description: "Simplest possible case: one input file, one deterministic per-record "
        + "numeric formula, fully specified in the prompt. No ambiguity, no clarifying "
        + "questions expected, no validation/rejection logic. Checks the agent's "
        + "straightforward happy path.",
    fixturesDir,
    promptFile: "prompt.txt",
    policyFile: "policy.md",
    inputFiles: ["readings.json"],
    expectedOutputs: [
        {
            filename: "celsius_readings.json",
            expectedFile: "expected/celsius_readings.json",
            keyField: "reading_id",
            fields: {
                city: "exact",
                celsius: "numeric"
            }
        }
    ]
};
