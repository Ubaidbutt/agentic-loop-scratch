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
            description: "Ask the user for a clarification when a requirement, data interpretation, output shape, validation policy, or execution plan is ambiguous and cannot be inferred safely. Use this before acting when guessing could change results, discard data, overwrite data, or choose an incompatible tool workflow. Prefer concise questions; include suggested options only when they cover the realistic choices.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The specific clarification to ask. Mention the ambiguous field, rule, output expectation, validation policy, or tool/workflow choice."
                    },
                    options: {
                        type: "array",
                        description: "Suggested answers. Pass an empty array for a free-form answer when the user needs to provide a policy, formula, date, or other detailed rule.",
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
