import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataFile } from "../files/dataFileResolver.js";

export async function writeFile(filename, data) {
    const filePath = resolveDataFile(filename);

    await mkdir(path.dirname(filePath), { recursive: true });
    await fsWriteFile(filePath, data, "utf8");

    return `Wrote ${filename}`;
}

export const writeFileTool = {
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
};
