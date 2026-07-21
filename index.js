import { runConversationTurn } from "./conversation.js";
import { closeTerminal, readUserInput, writeOutput } from "./terminal.js";

async function main() {
    writeOutput("Enter a message for the LLM. Type exit or press Ctrl+C to quit.");
    const conversation = [];

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
