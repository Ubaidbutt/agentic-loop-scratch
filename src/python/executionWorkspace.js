import { randomUUID } from "node:crypto";
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    mkdtemp,
    realpath,
    readdir,
    rename,
    rm,
    stat
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dataDir, maxGeneratedFileBytes } from "../config.js";
import { findDataFile, resolveDataFile } from "../files/dataFileResolver.js";

function isInside(parent, child) {
    return child === parent || child.startsWith(`${parent}${path.sep}`);
}

async function findSafeInput(filename) {
    const filePath = await findDataFile(filename);
    const [realDataDirectory, realFilePath] = await Promise.all([
        realpath(dataDir),
        realpath(filePath)
    ]);

    if (!isInside(realDataDirectory, realFilePath)) {
        throw new Error(`File must resolve inside the data directory: ${filename}`);
    }

    const fileStats = await stat(realFilePath);

    if (!fileStats.isFile()) {
        throw new Error(`Expected a regular file: ${filename}`);
    }

    return realFilePath;
}

async function createSafeOutputDirectory(outputFilename) {
    const destinationPath = resolveDataFile(outputFilename);

    if (destinationPath === dataDir) {
        throw new Error("The output filename must identify a file inside the data directory.");
    }

    const relativeDirectory = path.relative(dataDir, path.dirname(destinationPath));
    const segments = relativeDirectory === "" ? [] : relativeDirectory.split(path.sep);
    let currentDirectory = dataDir;

    for (const segment of segments) {
        currentDirectory = path.join(currentDirectory, segment);

        try {
            const currentStats = await lstat(currentDirectory);

            if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
                throw new Error(
                    `Output directories must not contain links or non-directories: ${outputFilename}`
                );
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }

            await mkdir(currentDirectory);
        }
    }

    return destinationPath;
}

export async function createExecutionWorkspace(scriptFilename, inputFilename) {
    const [sourceScriptPath, sourceInputPath] = await Promise.all([
        findSafeInput(scriptFilename),
        findSafeInput(inputFilename)
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

    const destinationPath = await createSafeOutputDirectory(outputFilename);
    const destinationDirectory = path.dirname(destinationPath);

    const [realDataDirectory, realDestinationDirectory] = await Promise.all([
        realpath(dataDir),
        realpath(destinationDirectory)
    ]);

    if (!isInside(realDataDirectory, realDestinationDirectory)) {
        throw new Error(`Output directory must resolve inside the data directory: ${outputFilename}`);
    }

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
