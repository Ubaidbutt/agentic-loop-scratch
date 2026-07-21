import { mkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(projectRoot, "data");

function resolveDataFile(filename) {
    const filePath = path.resolve(dataDir, filename);

    if (!filePath.startsWith(`${dataDir}${path.sep}`) && filePath !== dataDir) {
        throw new Error(`File must be inside the data directory: ${filename}`);
    }

    return filePath;
}

export async function readFile(filename) {
    const filePath = resolveDataFile(filename);
    return fsReadFile(filePath, "utf8");
}

export async function writeFile(filename, data) {
    const filePath = resolveDataFile(filename);

    await mkdir(path.dirname(filePath), { recursive: true });
    await fsWriteFile(filePath, data, "utf8");

    return `Wrote ${filename}`;
}

export const toolRegistry = {
    readFile: {
        definition: {
            type: "function",
            function: {
                name: "readFile",
                description: "Read a file from the data directory.",
                parameters: {
                    type: "object",
                    properties: {
                        filename: { type: "string" }
                    },
                    required: ["filename"],
                    additionalProperties: false
                }
            }
        },
        execute: readFile
    },
    writeFile: {
        definition: {
            type: "function",
            function: {
                name: "writeFile",
                description: "Write data to a file in the data directory.",
                parameters: {
                    type: "object",
                    properties: {
                        filename: { type: "string" },
                        data: { type: "string" }
                    },
                    required: ["filename", "data"],
                    additionalProperties: false
                }
            }
        },
        execute: writeFile
    }
};
