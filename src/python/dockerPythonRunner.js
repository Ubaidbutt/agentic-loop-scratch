import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
    maxCommandOutputBytes,
    pythonCpuLimit,
    pythonDependencyTimeoutMs,
    pythonDockerImage,
    pythonMemoryLimit,
    pythonProcessLimit,
    pythonTimeoutMs
} from "../config.js";

const execFileAsync = promisify(execFile);
const DEPENDENCY_IMAGE_FORMAT_VERSION = 2;
const PREPARATION_FAILURE_CACHE_TTL_MS = 5 * 60_000;
const preparationFailures = new Map();

class PythonPreparationError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "PythonPreparationError";
        Object.assign(this, details);
    }
}

function dockerEnvironment() {
    const environment = {
        LANG: "C.UTF-8",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin"
    };

    for (const name of ["HOME", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST"]) {
        if (process.env[name]) {
            environment[name] = process.env[name];
        }
    }

    return environment;
}

async function runDocker(arguments_, timeout) {
    return execFileAsync("docker", arguments_, {
        timeout,
        maxBuffer: maxCommandOutputBytes,
        env: dockerEnvironment()
    });
}

function dependencyImageName(externalDependencies) {
    const fingerprint = createHash("sha256")
        .update(JSON.stringify({
            formatVersion: DEPENDENCY_IMAGE_FORMAT_VERSION,
            pythonDockerImage,
            externalDependencies
        }))
        .digest("hex")
        .slice(0, 24);

    return `agentic-loop-python:${fingerprint}`;
}

function dockerfileContents() {
    return `FROM ${pythonDockerImage} AS resolver\n` +
        "ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1\n" +
        "COPY requirements.txt /tmp/requirements.txt\n" +
        "RUN python -m pip install --no-cache-dir --only-binary=:all: --requirement /tmp/requirements.txt && python -m pip freeze > /requirements.lock\n" +
        `FROM ${pythonDockerImage}\n` +
        "ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1\n" +
        "COPY --from=resolver /requirements.lock /opt/agent/requirements.lock\n" +
        "RUN python -m pip install --no-cache-dir --only-binary=:all: --requirement /opt/agent/requirements.lock\n";
}

function classifyPreparationError(error, externalDependencies) {
    const diagnostics = error.stderr || error.stdout || error.message;
    const noDistributionMatch = diagnostics.match(
        /No matching distribution found for ([^\s]+)/i
    );
    const unsatisfiedRequirementMatch = diagnostics.match(
        /Could not find a version that satisfies the requirement ([^\s(]+)/i
    );
    const dependency = noDistributionMatch?.[1] ||
        unsatisfiedRequirementMatch?.[1] || null;

    if (error.killed === true) {
        return new PythonPreparationError(
            "Dependency preparation timed out.",
            {
                stage: "dependency_resolution",
                reason: "timeout",
                dependency,
                retryable: true,
                timedOut: true,
                diagnostics,
                exitCode: null
            }
        );
    }

    if (noDistributionMatch || unsatisfiedRequirementMatch) {
        return new PythonPreparationError(
            `No compatible binary distribution was found${dependency ? ` for ${dependency}` : ""} on the pinned Python runtime. Remove the exact version pin or choose a package that supports this Python 3.13 platform.`,
            {
                stage: "dependency_resolution",
                reason: "no_compatible_binary_distribution",
                dependency,
                retryable: false,
                timedOut: false,
                diagnostics,
                exitCode: typeof error.code === "number" ? error.code : null
            }
        );
    }

    if (diagnostics.includes("ResolutionImpossible")) {
        return new PythonPreparationError(
            "The declared dependencies have incompatible version requirements.",
            {
                stage: "dependency_resolution",
                reason: "dependency_conflict",
                dependency: null,
                retryable: false,
                timedOut: false,
                diagnostics,
                exitCode: typeof error.code === "number" ? error.code : null
            }
        );
    }

    if (error.code === "ENOENT") {
        return new PythonPreparationError(
            "Docker is not installed or is not available on PATH.",
            {
                stage: "environment_preparation",
                reason: "docker_unavailable",
                dependency: null,
                retryable: true,
                timedOut: false,
                diagnostics,
                exitCode: null
            }
        );
    }

    return new PythonPreparationError(
        "Docker could not prepare the Python dependency environment.",
        {
            stage: "environment_preparation",
            reason: "docker_build_failed",
            dependency: externalDependencies.length === 1
                ? externalDependencies[0]
                : null,
            retryable: true,
            timedOut: false,
            diagnostics,
            exitCode: typeof error.code === "number" ? error.code : null
        }
    );
}

function repeatedPreparationError(previousFailure) {
    return new PythonPreparationError(
        `This dependency set failed recently and was not rebuilt. Previous failure: ${previousFailure.message}`,
        {
            stage: "dependency_resolution",
            reason: "repeated_dependency_failure",
            dependency: previousFailure.dependency,
            retryable: false,
            timedOut: previousFailure.timedOut,
            diagnostics: previousFailure.diagnostics,
            exitCode: previousFailure.exitCode,
            previousReason: previousFailure.reason
        }
    );
}

async function imageExists(image) {
    try {
        await runDocker(["image", "inspect", image], 10_000);
        return true;
    } catch {
        return false;
    }
}

export async function preparePythonImage(externalDependencies, buildDirectory) {
    if (externalDependencies.length === 0) {
        if (!(await imageExists(pythonDockerImage))) {
            let pullResult;

            try {
                pullResult = await runDocker(
                    ["pull", pythonDockerImage],
                    pythonDependencyTimeoutMs
                );
            } catch (error) {
                throw classifyPreparationError(error, externalDependencies);
            }

            return {
                image: pythonDockerImage,
                cached: false,
                stdout: pullResult.stdout,
                stderr: pullResult.stderr
            };
        }

        return {
            image: pythonDockerImage,
            cached: true,
            stdout: "",
            stderr: ""
        };
    }

    const image = dependencyImageName(externalDependencies);

    if (await imageExists(image)) {
        return { image, cached: true, stdout: "", stderr: "" };
    }

    const previousFailure = preparationFailures.get(image);

    if (
        previousFailure &&
        Date.now() - previousFailure.failedAt < PREPARATION_FAILURE_CACHE_TTL_MS
    ) {
        throw repeatedPreparationError(previousFailure);
    }

    preparationFailures.delete(image);

    await mkdir(buildDirectory, { recursive: true });
    await writeFile(
        path.join(buildDirectory, "requirements.txt"),
        `${externalDependencies.join("\n")}\n`,
        "utf8"
    );
    await writeFile(
        path.join(buildDirectory, "Dockerfile"),
        dockerfileContents(),
        "utf8"
    );

    let buildResult;

    try {
        buildResult = await runDocker([
            "build",
            "--tag", image,
            "--file", path.join(buildDirectory, "Dockerfile"),
            buildDirectory
        ], pythonDependencyTimeoutMs);
    } catch (error) {
        const preparationError = classifyPreparationError(
            error,
            externalDependencies
        );
        preparationFailures.set(image, {
            ...preparationError,
            message: preparationError.message,
            failedAt: Date.now()
        });
        throw preparationError;
    }

    preparationFailures.delete(image);

    return {
        image,
        cached: false,
        stdout: buildResult.stdout,
        stderr: buildResult.stderr
    };
}

export async function validatePythonScript(scriptPath) {
    const validationCode = "import ast, pathlib; source = pathlib.Path('/job/transform.py').read_text(encoding='utf-8'); ast.parse(source, filename='/job/transform.py')";

    try {
        await runDocker([
            "run", "--rm",
            "--network", "none",
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--memory", "128m",
            "--cpus", pythonCpuLimit,
            "--pids-limit", "16",
            "--user", "65532:65532",
            "--mount", `type=bind,src=${scriptPath},dst=/job/transform.py,readonly`,
            pythonDockerImage,
            "python", "-c", validationCode
        ], 10_000);

        return { valid: true };
    } catch (error) {
        const diagnostics = (error.stderr || error.message).trim();
        const lines = diagnostics.split("\n");
        const locationLine = [...lines]
            .reverse()
            .find(line => line.trimStart().startsWith("File "));
        const syntaxLine = [...lines]
            .reverse()
            .find(line => /^(SyntaxError|IndentationError|TabError):/.test(line));
        const message = [locationLine, syntaxLine]
            .filter(Boolean)
            .join("\n") || "The generated Python script has invalid syntax.";

        return {
            valid: false,
            stage: "script_validation",
            reason: "invalid_python_syntax",
            message
        };
    }
}

export async function getResolvedDependencies(image) {
    try {
        const result = await runDocker([
            "run", "--rm",
            "--network", "none",
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            image,
            "cat", "/opt/agent/requirements.lock"
        ], 30_000);

        return result.stdout
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

export async function runPythonContainer({
    image,
    scriptPath,
    inputPath,
    outputDirectory,
    outputExtension
}) {
    const containerName = `agentic-loop-${randomUUID()}`;
    const containerInputPath = `/job/input${path.extname(inputPath)}`;
    const containerOutputPath = `/output/result${outputExtension}`;
    const arguments_ = [
        "run", "--rm",
        "--name", containerName,
        "--init",
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", pythonMemoryLimit,
        "--cpus", pythonCpuLimit,
        "--pids-limit", String(pythonProcessLimit),
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
        "--user", "65532:65532",
        "--env", "HOME=/tmp",
        "--env", "PYTHONDONTWRITEBYTECODE=1",
        "--env", "PYTHONUNBUFFERED=1",
        "--workdir", "/job",
        "--mount", `type=bind,src=${scriptPath},dst=/job/transform.py,readonly`,
        "--mount", `type=bind,src=${inputPath},dst=${containerInputPath},readonly`,
        "--mount", `type=bind,src=${outputDirectory},dst=/output`,
        image,
        "python", "/job/transform.py",
        containerInputPath,
        containerOutputPath
    ];

    try {
        const result = await runDocker(arguments_, pythonTimeoutMs);

        return {
            exitCode: 0,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: false,
            outputPath: path.join(outputDirectory, `result${outputExtension}`)
        };
    } catch (error) {
        const timedOut = error.killed === true;

        if (timedOut) {
            try {
                await runDocker(["rm", "--force", containerName], 10_000);
            } catch {
                // The --rm container may already have disappeared.
            }
        }

        return {
            exitCode: typeof error.code === "number" ? error.code : null,
            stdout: error.stdout ?? "",
            stderr: error.stderr ?? error.message,
            timedOut,
            outputPath: path.join(outputDirectory, `result${outputExtension}`)
        };
    }
}
