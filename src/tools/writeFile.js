import { randomUUID } from "node:crypto";
import { rename, rm, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { resolveSafeOutputPath } from "../files/dataFileResolver.js";

export async function writeFile(filename, data) {
    if (
        path.extname(filename).toLowerCase() === ".py" &&
        !data.includes("\n") &&
        /\\n(?:import|from|def|class|with|for|if|try|except|#)/.test(data)
    ) {
        throw new Error(
            "Python source must contain real newline characters, not escaped \\n text."
        );
    }

    const destinationPath = await resolveSafeOutputPath(filename);
    const destinationDirectory = path.dirname(destinationPath);
    const temporaryPath = path.join(destinationDirectory, `.agent-write-${randomUUID()}.tmp`);

    try {
        await fsWriteFile(temporaryPath, data, "utf8");
        await rename(temporaryPath, destinationPath);
    } finally {
        await rm(temporaryPath, { force: true });
    }

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
