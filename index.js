import { runConversationTurn } from "./conversation.js";
import { closeTerminal, readUserInput, writeOutput } from "./terminal.js";

const SYSTEM_PROMPT = `You are a data-transformation agent. Your goal is to help the user transform data files according to their instructions.

All files available to you are inside the data directory. Use the provided tools to inspect inputs, create transformation scripts, execute them, and verify their outputs.

When performing a transformation:
1. Read the input file before deciding how to transform it.
2. Ask the user a question when a requirement is ambiguous and the answer cannot be inferred safely.
3. Write a Python script that accepts an input file path as its first command-line argument and an output file path as its second command-line argument.
4. Run the script with executeBashCommand, providing the script, input, and output filenames.
5. If execution fails, use the returned error details to repair the script and try again.
6. Read the generated output file and verify that it satisfies the user's request.
7. Do not overwrite the input file unless the user explicitly asks you to.
8. In your final response, briefly describe the transformation and identify the output file.

Never claim that a transformation succeeded before executing the script and verifying its output.`;

async function main() {
    writeOutput("Enter a message for the LLM. Type exit or press Ctrl+C to quit.");
    const conversation = [
        { role: "system", content: SYSTEM_PROMPT }
    ];

    while (true) {
        const userInput = (await readUserInput()).trim();

        if (!userInput) {
            continue;
        }

        if (userInput.toLowerCase() === "exit") {
            break;
        }

        const conversationLengthBeforeTurn = conversation.length;

        try {
            conversation.push({ role: "user", content: userInput });

            const assistantMessage = await runConversationTurn(conversation);

            writeOutput(`LLM: ${assistantMessage}`);
        } catch (error) {
            conversation.length = conversationLengthBeforeTurn;
            writeOutput(`Error: ${error.message}`);
        }
    }

    closeTerminal();
}

main();
