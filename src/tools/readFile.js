import { readFile as fsReadFile, stat } from "node:fs/promises";
import { maxReadableFileBytes } from "../config.js";
import { resolveExistingDataFile } from "../files/dataFileResolver.js";

export async function readFile(filename) {
    const filePath = await resolveExistingDataFile(filename);
    const fileStats = await stat(filePath);

    if (fileStats.size > maxReadableFileBytes) {
        throw new Error(
            `File is ${fileStats.size} bytes; only files up to ${maxReadableFileBytes} bytes can be read.`
        );
    }

    const buffer = await fsReadFile(filePath);

    if (buffer.includes(0)) {
        throw new Error(`File appears to be binary and cannot be read as text: ${filename}`);
    }

    return buffer.toString("utf8");
}

export const readFileTool = {
    definition: {
        type: "function",
        function: {
            name: "readFile",
            description: "Read an existing UTF-8 text file from the data directory. Use this before transforming data so you can inspect the real schema and values. This tool cannot read files outside data/, cannot read binary files, and does not create or modify files. The filename extension may be omitted only when it still resolves to one existing data file.",
            parameters: {
                type: "object",
                properties: {
                    filename: {
                        type: "string",
                        description: "Name of the existing file to read from data/. Do not include paths outside data/."
                    }
                },
                required: ["filename"],
                additionalProperties: false
            }
        }
    },
    execute: readFile
};
