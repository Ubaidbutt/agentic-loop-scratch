import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESULT_MARKER = "__EVAL_RESULT__";
const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, "cases");
const runCasePath = path.join(here, "lib", "runCase.js");

function runOneCase(caseFile) {
    return new Promise(resolve => {
        const child = spawn(
            process.execPath,
            ["--experimental-test-module-mocks", runCasePath, caseFile],
            { stdio: ["ignore", "pipe", "inherit"], env: process.env }
        );

        let stdout = "";

        child.stdout.on("data", chunk => {
            stdout += chunk;
            process.stdout.write(chunk);
        });

        child.on("close", () => {
            const resultLine = stdout.split("\n").reverse()
                .find(line => line.startsWith(RESULT_MARKER));
            let result = null;

            if (resultLine) {
                try {
                    result = JSON.parse(resultLine.slice(RESULT_MARKER.length));
                } catch {
                    result = null;
                }
            }

            resolve({ caseFile, result });
        });
    });
}

function printIssue(issue) {
    if (issue.type === "field_mismatch") {
        console.log(`      ${issue.key} :: ${issue.field}: expected ${JSON.stringify(issue.expected)}, got ${JSON.stringify(issue.actual)}`);
    } else if (issue.type === "missing_record") {
        console.log(`      missing record: ${issue.key}`);
    } else if (issue.type === "unexpected_record") {
        console.log(`      unexpected record: ${issue.key}`);
    } else {
        console.log(`      ${JSON.stringify(issue)}`);
    }
}

async function main() {
    const requestedCase = process.argv[2];
    const entries = (await readdir(casesDir)).filter(file => file.endsWith(".js"));
    const caseFiles = entries
        .map(file => path.join(casesDir, file))
        .filter(file => !requestedCase || file.includes(requestedCase));

    if (caseFiles.length === 0) {
        console.error(requestedCase
            ? `No eval case file matched "${requestedCase}".`
            : "No eval cases found in evals/cases/.");
        process.exitCode = 2;
        return;
    }

    const runs = [];

    for (const caseFile of caseFiles) {
        console.log(`\n=== Running eval case: ${path.basename(caseFile)} ===`);
        runs.push(await runOneCase(caseFile));
    }

    console.log("\n=== Eval summary ===");
    let anyFailed = false;

    for (const { caseFile, result } of runs) {
        const name = result?.caseId ?? path.basename(caseFile);

        if (!result) {
            anyFailed = true;
            console.log(`FAIL  ${name}  (no result captured -- see output above)`);
            continue;
        }

        if (!result.passed) {
            anyFailed = true;
        }

        console.log(`${result.passed ? "PASS" : "FAIL"}  ${name}  (${result.durationMs}ms)`);

        if (!result.passed) {
            for (const fileResult of result.fileResults ?? []) {
                if (fileResult.passed) {
                    continue;
                }

                console.log(`    ${fileResult.filename}:`);
                for (const issue of fileResult.issues) {
                    printIssue(issue);
                }
            }

            if (result.error) {
                console.log(`    error: ${result.error}`);
            }

            if (result.finalMessage) {
                console.log(`    agent's final message: ${result.finalMessage}`);
            }
        }
    }

    process.exitCode = anyFailed ? 1 : 0;
}

main();
