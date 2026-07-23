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
            description: "Write one UTF-8 text file directly into the data directory. Use this for transformation scripts, small generated text files, or final outputs that do not require isolated execution. This tool writes exactly the requested filename; it does not execute code. For Python scripts, data must contain real newline characters, not escaped \\n sequences. Do not use this to write outside data/.",
            parameters: {
                type: "object",
                properties: {
                    filename: {
                        type: "string",
                        description: "Output filename to create or replace in data/. Include the intended extension, such as transform.py or report.json."
                    },
                    data: {
                        type: "string",
                        description: "Complete UTF-8 file contents to write. For .py files, include actual newline characters."
                    }
                },
                required: ["filename", "data"],
                additionalProperties: false
            }
        }
    },
    execute: writeFile
};
