import { readUserInput, writeOutput } from "../cli/terminal.js";

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

export const askUserQuestionTool = {
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
};
