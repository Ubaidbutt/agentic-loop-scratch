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
            description: "Read a text file from the data directory. The filename extension may be omitted.",
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
};
