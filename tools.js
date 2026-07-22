import {
    mkdir,
    readdir,
    readFile as fsReadFile,
    stat,
    writeFile as fsWriteFile
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readUserInput, writeOutput } from "./terminal.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(projectRoot, "data");
const execFileAsync = promisify(execFile);
const PYTHON_TIMEOUT_MS = 10_000;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

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

export async function executeBashCommand(
    scriptFilename,
    inputFilename,
    outputFilename
) {
    if (path.extname(scriptFilename).toLowerCase() !== ".py") {
        throw new Error("Only Python scripts ending in .py can be executed.");
    }

    const scriptPath = resolveDataFile(scriptFilename);
    const inputPath = resolveDataFile(inputFilename);
    const outputPath = resolveDataFile(outputFilename);

    if (inputPath === outputPath) {
        throw new Error("The output file must be different from the input file.");
    }

    writeOutput("LLM wants to execute this command:");
    const displayedArguments = [scriptFilename, inputFilename, outputFilename]
        .map(argument => JSON.stringify(argument))
        .join(" ");
    writeOutput(`python3 ${displayedArguments}`);

    const approval = (await readUserInput("Allow this command? [y/N] "))
        .trim()
        .toLowerCase();

    if (approval !== "y" && approval !== "yes") {
        return {
            approved: false,
            executed: false,
            exitCode: null,
            stdout: "",
            stderr: "Command execution was denied by the user.",
            timedOut: false,
            outputFilename
        };
    }

    const startedAt = Date.now();

    try {
        const { stdout, stderr } = await execFileAsync(
            "python3",
            [scriptPath, inputPath, outputPath],
            {
                cwd: dataDir,
                timeout: PYTHON_TIMEOUT_MS,
                maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
                env: {
                    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                    LANG: "C.UTF-8"
                }
            }
        );

        return {
            approved: true,
            executed: true,
            exitCode: 0,
            stdout,
            stderr,
            timedOut: false,
            durationMs: Date.now() - startedAt,
            outputFilename
        };
    } catch (error) {
        return {
            approved: true,
            executed: true,
            exitCode: typeof error.code === "number" ? error.code : null,
            stdout: error.stdout ?? "",
            stderr: error.stderr ?? error.message,
            timedOut: error.killed === true && error.signal === "SIGTERM",
            durationMs: Date.now() - startedAt,
            outputFilename
        };
    }
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
    executeBashCommand: {
        definition: {
            type: "function",
            function: {
                name: "executeBashCommand",
                description: "Request user approval, then execute a Python 3 data-transformation script from the data directory. The script receives the input and output file paths as its first and second command-line arguments. If the user denies permission, the script is not executed.",
                parameters: {
                    type: "object",
                    properties: {
                        scriptFilename: {
                            type: "string",
                            description: "The .py script to execute from the data directory."
                        },
                        inputFilename: {
                            type: "string",
                            description: "The input data file from the data directory."
                        },
                        outputFilename: {
                            type: "string",
                            description: "The output file the script should create in the data directory. It must differ from the input filename."
                        }
                    },
                    required: ["scriptFilename", "inputFilename", "outputFilename"],
                    additionalProperties: false
                }
            }
        },
        execute: executeBashCommand
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
