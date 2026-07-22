import { randomUUID } from "node:crypto";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    readdir,
    rename,
    rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { maxGeneratedFileBytes } from "../config.js";
import { resolveExistingDataFile, resolveSafeOutputPath } from "../files/dataFileResolver.js";

export async function createExecutionWorkspace(scriptFilename, inputFilename) {
    const [sourceScriptPath, sourceInputPath] = await Promise.all([
        resolveExistingDataFile(scriptFilename),
        resolveExistingDataFile(inputFilename)
    ]);
    const root = await mkdtemp(path.join(os.tmpdir(), "agentic-python-"));
    const jobDirectory = path.join(root, "job");
    const outputDirectory = path.join(root, "output");
    const buildDirectory = path.join(root, "build");
    const scriptPath = path.join(jobDirectory, "transform.py");
    const inputPath = path.join(jobDirectory, `input${path.extname(sourceInputPath)}`);

    await Promise.all([
        mkdir(jobDirectory),
        mkdir(outputDirectory),
        mkdir(buildDirectory)
    ]);
    await Promise.all([
        copyFile(sourceScriptPath, scriptPath),
        copyFile(sourceInputPath, inputPath)
    ]);
    await Promise.all([
        chmod(scriptPath, 0o444),
        chmod(inputPath, 0o444),
        chmod(outputDirectory, 0o777)
    ]);

    return {
        root,
        buildDirectory,
        scriptPath,
        inputPath,
        outputDirectory
    };
}

export async function removeExecutionWorkspace(workspace) {
    if (workspace?.root) {
        await rm(workspace.root, { recursive: true, force: true });
    }
}

export async function validateAndPublishOutput(
    stagedOutputPath,
    outputDirectory,
    outputFilename
) {
    const entries = await readdir(outputDirectory);
    const expectedName = path.basename(stagedOutputPath);

    if (entries.length !== 1 || entries[0] !== expectedName) {
        throw new Error(
            `The script must create exactly one output file named ${expectedName}. Created: ${entries.join(", ") || "none"}.`
        );
    }

    const stagedStats = await lstat(stagedOutputPath);

    if (!stagedStats.isFile() || stagedStats.isSymbolicLink()) {
        throw new Error("The generated output must be a regular file, not a link or directory.");
    }

    if (stagedStats.size > maxGeneratedFileBytes) {
        throw new Error(
            `The generated output is ${stagedStats.size} bytes; the limit is ${maxGeneratedFileBytes} bytes.`
        );
    }

    const destinationPath = await resolveSafeOutputPath(outputFilename);
    const destinationDirectory = path.dirname(destinationPath);
    const temporaryDestination = path.join(
        destinationDirectory,
        `.agent-output-${randomUUID()}.tmp`
    );

    try {
        await copyFile(stagedOutputPath, temporaryDestination);
        await rename(temporaryDestination, destinationPath);
    } finally {
        await rm(temporaryDestination, { force: true });
    }

    return {
        outputFilename,
        outputBytes: stagedStats.size
    };
}
