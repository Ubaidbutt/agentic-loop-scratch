import path from "node:path";
import { pythonDockerImage } from "../config.js";
import { readUserInput, writeOutput } from "../cli/terminal.js";
import { resolveDataFile } from "../files/dataFileResolver.js";
import { logEvent } from "../logging/sessionLogger.js";
import { validateExternalDependencies } from "../python/dependencyPolicy.js";
import {
    getResolvedDependencies,
    preparePythonImage,
    runPythonContainer,
    validatePythonScript
} from "../python/dockerPythonRunner.js";
import {
    createExecutionWorkspace,
    removeExecutionWorkspace,
    validateAndPublishOutput
} from "../python/executionWorkspace.js";

function failedExecutionResult({
    externalDependencies,
    outputFilename,
    error,
    environmentPrepared = false
}) {
    const failure = {
        stage: error.stage || "environment_preparation",
        reason: error.reason || "preparation_failed",
        dependency: error.dependency || null,
        message: error.message,
        retryable: error.retryable ?? true
    };

    if (error.previousReason) {
        failure.previousReason = error.previousReason;
    }

    return {
        succeeded: false,
        approved: true,
        environmentPrepared,
        executed: false,
        exitCode: error.exitCode ?? null,
        stdout: "",
        stderr: error.message,
        timedOut: error.timedOut === true,
        failure,
        externalDependencies,
        resolvedDependencies: [],
        outputFilename
    };
}

export async function executePythonScript(
    scriptFilename,
    inputFilename,
    outputFilename,
    externalDependencies
) {
    if (path.extname(scriptFilename).toLowerCase() !== ".py") {
        throw new Error("Only Python scripts ending in .py can be executed.");
    }

    const normalizedDependencies = validateExternalDependencies(externalDependencies);
    const inputPath = resolveDataFile(inputFilename);
    const outputPath = resolveDataFile(outputFilename);

    if (inputPath === outputPath) {
        throw new Error("The output file must be different from the input file.");
    }

    writeOutput("LLM wants to prepare and execute an isolated Python transformation:");
    writeOutput(`  Runtime: ${pythonDockerImage}`);
    writeOutput(`  Script: ${scriptFilename}`);
    writeOutput(`  Input: ${inputFilename} (read-only)`);
    writeOutput(`  Output: ${outputFilename}`);
    writeOutput(
        `  External dependencies: ${normalizedDependencies.join(", ") || "none"}`
    );
    writeOutput("  Transformation network: disabled");
    await logEvent("command.approval.requested", {
        toolName: "executePythonScript",
        scriptFilename,
        inputFilename,
        outputFilename,
        externalDependencies: normalizedDependencies,
        pythonDockerImage
    });

    const approval = (await readUserInput("Allow dependency preparation and execution? [y/N] "))
        .trim()
        .toLowerCase();
    const approved = approval === "y" || approval === "yes";

    await logEvent("command.approval.received", {
        toolName: "executePythonScript",
        approved
    });

    if (!approved) {
        return {
            succeeded: false,
            approved: false,
            environmentPrepared: false,
            executed: false,
            exitCode: null,
            stdout: "",
            stderr: "Dependency preparation and command execution were denied by the user.",
            timedOut: false,
            externalDependencies: normalizedDependencies,
            resolvedDependencies: [],
            outputFilename
        };
    }

    let workspace;
    const startedAt = Date.now();

    try {
        workspace = await createExecutionWorkspace(scriptFilename, inputFilename);
        await logEvent("python.environment.preparation.started", {
            toolName: "executePythonScript",
            externalDependencies: normalizedDependencies,
            pythonDockerImage
        });

        let preparedImage;

        try {
            await preparePythonImage([], workspace.buildDirectory);
            const scriptValidation = await validatePythonScript(workspace.scriptPath);

            if (!scriptValidation.valid) {
                await logEvent("python.script.validation.failed", {
                    toolName: "executePythonScript",
                    reason: scriptValidation.reason,
                    error: scriptValidation.message
                });

                return {
                    succeeded: false,
                    approved: true,
                    environmentPrepared: true,
                    executed: false,
                    exitCode: null,
                    stdout: "",
                    stderr: scriptValidation.message,
                    timedOut: false,
                    failure: {
                        stage: scriptValidation.stage,
                        reason: scriptValidation.reason,
                        dependency: null,
                        message: scriptValidation.message,
                        retryable: false
                    },
                    externalDependencies: normalizedDependencies,
                    resolvedDependencies: [],
                    outputFilename
                };
            }

            preparedImage = await preparePythonImage(
                normalizedDependencies,
                workspace.buildDirectory
            );
        } catch (error) {
            await logEvent("python.environment.preparation.failed", {
                toolName: "executePythonScript",
                durationMs: Date.now() - startedAt,
                error: error.message,
                stage: error.stage,
                reason: error.reason,
                dependency: error.dependency,
                diagnostics: error.diagnostics
            });

            return failedExecutionResult({
                externalDependencies: normalizedDependencies,
                outputFilename,
                error
            });
        }

        const resolvedDependencies = normalizedDependencies.length === 0
            ? []
            : await getResolvedDependencies(preparedImage.image);
        await logEvent("python.environment.preparation.completed", {
            toolName: "executePythonScript",
            image: preparedImage.image,
            cached: preparedImage.cached,
            resolvedDependencies
        });
        await logEvent("command.execution.started", {
            toolName: "executePythonScript",
            scriptFilename,
            inputFilename,
            outputFilename,
            image: preparedImage.image,
            network: "none"
        });

        const executionStartedAt = Date.now();
        const execution = await runPythonContainer({
            image: preparedImage.image,
            scriptPath: workspace.scriptPath,
            inputPath: workspace.inputPath,
            outputDirectory: workspace.outputDirectory,
            outputExtension: path.extname(outputFilename)
        });
        const durationMs = Date.now() - executionStartedAt;

        if (execution.exitCode !== 0) {
            await logEvent("command.execution.completed", {
                toolName: "executePythonScript",
                exitCode: execution.exitCode,
                durationMs,
                timedOut: execution.timedOut,
                stderrPreview: execution.stderr.slice(0, 500)
            });

            return {
                succeeded: false,
                approved: true,
                environmentPrepared: true,
                executed: true,
                exitCode: execution.exitCode,
                stdout: execution.stdout,
                stderr: execution.stderr,
                timedOut: execution.timedOut,
                durationMs,
                externalDependencies: normalizedDependencies,
                resolvedDependencies,
                outputFilename
            };
        }

        let publishedOutput;

        try {
            publishedOutput = await validateAndPublishOutput(
                execution.outputPath,
                workspace.outputDirectory,
                outputFilename
            );
        } catch (error) {
            await logEvent("command.output.rejected", {
                toolName: "executePythonScript",
                error: error.message
            });

            return {
                succeeded: false,
                approved: true,
                environmentPrepared: true,
                executed: true,
                exitCode: 0,
                stdout: execution.stdout,
                stderr: `Execution succeeded but output validation failed: ${error.message}`,
                timedOut: false,
                durationMs,
                externalDependencies: normalizedDependencies,
                resolvedDependencies,
                outputFilename
            };
        }

        await logEvent("command.execution.completed", {
            toolName: "executePythonScript",
            exitCode: 0,
            durationMs,
            outputFilename,
            outputBytes: publishedOutput.outputBytes
        });

        return {
            succeeded: true,
            approved: true,
            environmentPrepared: true,
            executed: true,
            exitCode: 0,
            stdout: execution.stdout,
            stderr: execution.stderr,
            timedOut: false,
            durationMs,
            externalDependencies: normalizedDependencies,
            resolvedDependencies,
            outputFilename,
            outputBytes: publishedOutput.outputBytes
        };
    } finally {
        try {
            await removeExecutionWorkspace(workspace);
        } catch (error) {
            await logEvent("python.workspace.cleanup.failed", {
                toolName: "executePythonScript",
                error: error.message
            });
        }
    }
}

export const executePythonScriptTool = {
    definition: {
        type: "function",
        function: {
            name: "executePythonScript",
            description: "Request user approval, prepare a dependency-specific Docker image, and execute one Python data-transformation script in an offline, resource-limited container. Use this for transformations that need computation in Python and can publish one output artifact per execution. Contract: the script file and input file are read-only; the container filesystem is read-only except for the provided output path; the script receives exactly two arguments, sys.argv[1] for input and sys.argv[2] for output; the script must create exactly one regular file at sys.argv[2]. Treat sys.argv[2] as the complete output file path, not as a directory. Do not write to the current working directory or create side files. Only the validated sys.argv[2] artifact is copied back to data/. If the requested result needs more than one artifact, choose a compatible plan before execution, such as separate tool calls, a single archive artifact, or asking the user which representation they prefer.",
            parameters: {
                type: "object",
                properties: {
                    scriptFilename: {
                        type: "string",
                        description: "Name of an existing .py script in data/ to execute. Write it first with writeFile. The script must read sys.argv[1] and write exactly one output file to sys.argv[2]."
                    },
                    inputFilename: {
                        type: "string",
                        description: "Name of the existing input data file in data/. It is mounted read-only for the script."
                    },
                    outputFilename: {
                        type: "string",
                        description: "Name of the single output file to publish into data/. It must differ from the input filename and should include an extension such as .json, .csv, or .zip. This is a file name, not a directory name. Inside Python, write to sys.argv[2] exactly."
                    },
                    externalDependencies: {
                        type: "array",
                        description: "Third-party Python distributions required by the script, such as pandas. Usually omit versions so the runtime can select compatible binary packages. Use exact pins only when required. Do not list standard-library modules like json, csv, datetime, decimal, pathlib, or zipfile. Use an empty array when none are required.",
                        items: { type: "string" },
                        maxItems: 20
                    }
                },
                required: [
                    "scriptFilename",
                    "inputFilename",
                    "outputFilename",
                    "externalDependencies"
                ],
                additionalProperties: false
            }
        }
    },
    execute: executePythonScript
};
