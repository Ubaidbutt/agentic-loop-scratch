import { readFile as fsReadFile } from "node:fs/promises";
import { findDataFile } from "../files/dataFileResolver.js";

export async function readFile(filename) {
    const filePath = await findDataFile(filename);
    return fsReadFile(filePath, "utf8");
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
