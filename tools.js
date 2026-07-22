import {
    mkdir,
    readdir,
    readFile as fsReadFile,
    stat,
    writeFile as fsWriteFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readUserInput, writeOutput } from "./terminal.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(projectRoot, "data");

function resolveDataFile(filename) {
    const filePath = path.resolve(dataDir, filename);

    if (!filePath.startsWith(`${dataDir}${path.sep}`) && filePath !== dataDir) {
        throw new Error(`File must be inside the data directory: ${filename}`);
    }

    return filePath;
}

async function findDataFile(filename) {
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

    if (path.extname(filename)) {
        throw new Error(`File not found: ${filename}`);
    }

    const directory = path.dirname(exactPath);
    const requestedName = path.basename(exactPath).toLowerCase();

    let entries;

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`File not found: ${filename}`);
        }

        throw error;
    }

    const matches = entries.filter(entry =>
        entry.isFile() &&
        entry.name.toLowerCase().startsWith(`${requestedName}.`)
    );

    if (matches.length === 0) {
        throw new Error(`File not found: ${filename}`);
    }

    if (matches.length > 1) {
        const matchingFilenames = matches.map(entry => entry.name).join(", ");
        throw new Error(
            `Multiple files match "${filename}": ${matchingFilenames}. Specify an extension.`
        );
    }

    return path.join(directory, matches[0].name);
}

export async function readFile(filename) {
    const filePath = await findDataFile(filename);
    return fsReadFile(filePath, "utf8");
}

export async function writeFile(filename, data) {
    const filePath = resolveDataFile(filename);

    await mkdir(path.dirname(filePath), { recursive: true });
    await fsWriteFile(filePath, data, "utf8");

    return `Wrote ${filename}`;
}

export async function askUserQuestion(question, options = []) {
    if (!Array.isArray(options)) {
        throw new TypeError("Question options must be an array.");
    }

    writeOutput(`LLM question: ${question}`);

    if (options.length > 0) {
        writeOutput("");
        options.forEach((option, index) => {
            writeOutput(`${index + 1}. ${option}`);
        });
        writeOutput("");
    }

    const prompt = options.length > 0
        ? "Choose an option number or enter your own answer:\nYou: "
        : "You: ";
    const answer = (await readUserInput(prompt)).trim();
    const selectedOption = /^\d+$/.test(answer) ? options[Number(answer) - 1] : undefined;

    return selectedOption ?? answer;
}

export const toolRegistry = {
    readFile: {
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
    },
    askUserQuestion: {
        definition: {
            type: "function",
            function: {
                name: "askUserQuestion",
                description: "Ask the user a clarification question, optionally with suggested answers.",
                parameters: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "The question to ask the user."
                        },
                        options: {
                            type: "array",
                            description: "Suggested answers. Pass an empty array for a free-form question.",
                            items: {
                                type: "string"
                            },
                            maxItems: 10
                        }
                    },
                    required: ["question", "options"],
                    additionalProperties: false
                }
            }
        },
        execute: askUserQuestion
    }
};
