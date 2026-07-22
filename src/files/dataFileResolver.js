import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../config.js";

function normalizeFilename(filename) {
    return filename.toLowerCase().replaceAll(/[\s_-]+/g, "-");
}

function isInside(parent, child) {
    return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export function resolveDataFile(filename) {
    const filePath = path.resolve(dataDir, filename);

    if (!isInside(dataDir, filePath)) {
        throw new Error(`File must be inside the data directory: ${filename}`);
    }

    return filePath;
}

export async function findDataFile(filename) {
    const exactPath = resolveDataFile(filename);

    try {
        const fileStats = await stat(exactPath);

        if (fileStats.isFile()) {
            return exactPath;
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    const directory = path.dirname(exactPath);
    const requestedFilename = path.basename(exactPath);
    const requestedName = requestedFilename.toLowerCase();

    let entries;

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`File not found: ${filename}`);
        }

        throw error;
    }

    const matches = path.extname(filename)
        ? entries.filter(entry =>
            entry.isFile() &&
            normalizeFilename(entry.name) === normalizeFilename(requestedFilename)
        )
        : entries.filter(entry =>
            entry.isFile() &&
            entry.name.toLowerCase().startsWith(`${requestedName}.`)
        );

    if (matches.length === 0) {
        throw new Error(`File not found: ${filename}`);
    }

    if (matches.length > 1) {
        const matchingFilenames = matches.map(entry => entry.name).join(", ");
        throw new Error(
            `Multiple files match "${filename}": ${matchingFilenames}. Specify the exact filename.`
        );
    }

    return path.join(directory, matches[0].name);
}

// Resolves a symlink target's real location before use, so a link planted
// inside data/ cannot be used to read a file that lives outside it.
export async function resolveExistingDataFile(filename) {
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

export async function resolveSafeOutputPath(outputFilename) {
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

    const destinationDirectory = path.dirname(destinationPath);
    const [realDataDirectory, realDestinationDirectory] = await Promise.all([
        realpath(dataDir),
        realpath(destinationDirectory)
    ]);

    if (!isInside(realDataDirectory, realDestinationDirectory)) {
        throw new Error(`Output directory must resolve inside the data directory: ${outputFilename}`);
    }

    return destinationPath;
}
