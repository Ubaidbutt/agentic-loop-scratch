import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RESULT_MARKER = "__EVAL_RESULT__";

async function main() {
    const [, , caseModulePath] = process.argv;

    if (!caseModulePath) {
        console.error("Usage: node evals/lib/runCase.js <path-to-case-module>");
        process.exitCode = 2;
        return;
    }

    const { default: evalCase } = await import(pathToFileURL(path.resolve(caseModulePath)));

    const result = {
        caseId: evalCase.id,
        passed: false,
        finalMessage: null,
        error: null,
        transcript: [],
        fileResults: [],
        durationMs: 0
    };

    const startedAt = Date.now();
    let sandboxDir;

    try {
        sandboxDir = await mkdtemp(path.join(os.tmpdir(), `agent-eval-${evalCase.id}-`));

        for (const inputFile of evalCase.inputFiles) {
            await cp(
                path.join(evalCase.fixturesDir, inputFile),
                path.join(sandboxDir, inputFile)
            );
        }

        // Must happen before any transitive import of src/config.js.
        process.env.DATA_DIR = sandboxDir;

        const promptText = await readFile(
            path.join(evalCase.fixturesDir, evalCase.promptFile),
            "utf8"
        );
        const policyDoc = await readFile(
            path.join(evalCase.fixturesDir, evalCase.policyFile),
            "utf8"
        );

        // Must happen before importing conversation.js, which transitively
        // imports terminal.js via the tool registry.
        const { installMockTerminal } = await import("./mockTerminal.js");
        const { createUserSimulator } = await import("./userSimulator.js");

        const answerQuestion = createUserSimulator({ promptText, policyDoc });

        installMockTerminal({
            answerQuestion,
            onTranscriptEntry: entry => result.transcript.push(entry)
        });

        const { runConversationTurn } = await import("../../src/agent/conversation.js");
        const { systemPrompt } = await import("../../src/agent/systemPrompt.js");

        const conversation = [
            { role: "system", content: systemPrompt },
            { role: "user", content: promptText }
        ];

        // runConversationTurn only returns the extracted "message" text on
        // success -- it does not expose the internal complete/needs_user/blocked
        // status (neither does the CLI). Pass/fail is judged purely by whether
        // the expected output files actually landed and match, below.
        result.finalMessage = await runConversationTurn(conversation);

        const { gradeKeyedArray } = await import("./grade.js");

        let allOutputsPassed = true;

        for (const output of evalCase.expectedOutputs) {
            const expected = JSON.parse(
                await readFile(path.join(evalCase.fixturesDir, output.expectedFile), "utf8")
            );

            let actual;
            let readError = null;

            try {
                actual = JSON.parse(
                    await readFile(path.join(sandboxDir, output.filename), "utf8")
                );
            } catch (error) {
                readError = error.message;
            }

            if (readError) {
                allOutputsPassed = false;
                result.fileResults.push({
                    filename: output.filename,
                    passed: false,
                    issues: [{ type: "file_unreadable", detail: readError }]
                });
                continue;
            }

            const grade = gradeKeyedArray(actual, expected, {
                keyField: output.keyField,
                fields: output.fields
            });

            if (!grade.passed) {
                allOutputsPassed = false;
            }

            result.fileResults.push({ filename: output.filename, ...grade });
        }

        result.passed = allOutputsPassed;
    } catch (error) {
        result.error = error.message;
        result.passed = false;
    } finally {
        result.durationMs = Date.now() - startedAt;

        if (sandboxDir) {
            if (process.env.EVAL_KEEP_SANDBOX === "1") {
                result.sandboxDir = sandboxDir;
            } else {
                await rm(sandboxDir, { recursive: true, force: true });
            }
        }
    }

    console.log(`${RESULT_MARKER}${JSON.stringify(result)}`);
    process.exitCode = result.passed ? 0 : 1;
}

main();
