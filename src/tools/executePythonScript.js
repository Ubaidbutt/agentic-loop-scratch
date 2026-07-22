import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
    dataDir,
    maxCommandOutputBytes,
    pythonTimeoutMs
} from "../config.js";
import { readUserInput, writeOutput } from "../cli/terminal.js";
import { resolveDataFile } from "../files/dataFileResolver.js";
import { logEvent } from "../logging/sessionLogger.js";

const execFileAsync = promisify(execFile);

export async function executePythonScript(
    scriptFilename,
    inputFilename,
    outputFilename
) {
    if (path.extname(scriptFilename).toLowerCase() !== ".py") {
        throw new Error("Only Python scripts ending in .py can be executed.");
    }

    const scriptPath = resolveDataFile(scriptFilename);
    const inputPath = resolveDataFile(inputFilename);
    const outputPath = resolveDataFile(outputFilename);

    if (inputPath === outputPath) {
        throw new Error("The output file must be different from the input file.");
    }

    writeOutput("LLM wants to execute this command:");
    const displayedArguments = [scriptFilename, inputFilename, outputFilename]
        .map(argument => JSON.stringify(argument))
        .join(" ");
    writeOutput(`python3 ${displayedArguments}`);
    await logEvent("command.approval.requested", {
        toolName: "executePythonScript",
        scriptFilename,
        inputFilename,
        outputFilename
    });

    const approval = (await readUserInput("Allow this command? [y/N] "))
        .trim()
        .toLowerCase();
    const approved = approval === "y" || approval === "yes";

    await logEvent("command.approval.received", {
        toolName: "executePythonScript",
        approved
    });

    if (!approved) {
        return {
            approved: false,
            executed: false,
            exitCode: null,
            stdout: "",
            stderr: "Command execution was denied by the user.",
            timedOut: false,
            outputFilename
        };
    }

    const startedAt = Date.now();
    await logEvent("command.execution.started", {
        toolName: "executePythonScript",
        scriptFilename,
        inputFilename,
        outputFilename
    });

    try {
        const { stdout, stderr } = await execFileAsync(
            "python3",
            [scriptPath, inputPath, outputPath],
            {
                cwd: dataDir,
                timeout: pythonTimeoutMs,
                maxBuffer: maxCommandOutputBytes,
                env: {
                    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                    LANG: "C.UTF-8"
                }
            }
        );

        const durationMs = Date.now() - startedAt;
        await logEvent("command.execution.completed", {
            toolName: "executePythonScript",
            exitCode: 0,
            durationMs,
            stdoutLength: stdout.length,
            stderrLength: stderr.length
        });

        return {
            approved: true,
            executed: true,
            exitCode: 0,
            stdout,
            stderr,
            timedOut: false,
            durationMs,
            outputFilename
        };
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        const exitCode = typeof error.code === "number" ? error.code : null;
        await logEvent("command.execution.completed", {
            toolName: "executePythonScript",
            exitCode,
            durationMs,
            timedOut: error.killed === true && error.signal === "SIGTERM",
            stderrPreview: (error.stderr ?? error.message).slice(0, 500)
        });

        return {
            approved: true,
            executed: true,
            exitCode,
            stdout: error.stdout ?? "",
            stderr: error.stderr ?? error.message,
            timedOut: error.killed === true && error.signal === "SIGTERM",
            durationMs,
            outputFilename
        };
    }
}

export const executePythonScriptTool = {
    definition: {
        type: "function",
        function: {
            name: "executePythonScript",
            description: "Request user approval, then execute a Python 3 data-transformation script from the data directory. The script receives the input and output file paths as its first and second command-line arguments. If the user denies permission, the script is not executed.",
            parameters: {
                type: "object",
                properties: {
                    scriptFilename: {
                        type: "string",
                        description: "The .py script to execute from the data directory."
                    },
                    inputFilename: {
                        type: "string",
                        description: "The input data file from the data directory."
                    },
                    outputFilename: {
                        type: "string",
                        description: "The output file the script should create in the data directory. It must differ from the input filename."
                    }
                },
                required: ["scriptFilename", "inputFilename", "outputFilename"],
                additionalProperties: false
            }
        }
    },
    execute: executePythonScript
};
