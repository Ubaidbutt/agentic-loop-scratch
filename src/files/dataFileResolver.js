import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "../config.js";

function normalizeFilename(filename) {
    return filename.toLowerCase().replaceAll(/[\s_-]+/g, "-");
}

export function resolveDataFile(filename) {
    const filePath = path.resolve(dataDir, filename);

    if (!filePath.startsWith(`${dataDir}${path.sep}`) && filePath !== dataDir) {
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
