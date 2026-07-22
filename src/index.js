import { runConversationTurn } from "./agent/conversation.js";
import { systemPrompt } from "./agent/systemPrompt.js";
import { closeTerminal, readUserInput, writeOutput } from "./cli/terminal.js";
import {
    flushLogs,
    getSessionLogFile,
    logEvent
} from "./logging/sessionLogger.js";

async function main() {
    await logEvent("session.started", {
        logFile: getSessionLogFile()
    });
    writeOutput("Enter a message for the LLM. Type exit or press Ctrl+C to quit.");
    writeOutput(`Session log: ${getSessionLogFile()}`);
    const conversation = [
        { role: "system", content: systemPrompt }
    ];

    while (true) {
        const userInput = (await readUserInput()).trim();

        if (!userInput) {
            continue;
        }

        if (userInput.toLowerCase() === "exit") {
            break;
        }

        await logEvent("user.message", { content: userInput });
        const conversationLengthBeforeTurn = conversation.length;
        const turnStartedAt = Date.now();

        try {
            conversation.push({ role: "user", content: userInput });

            const assistantMessage = await runConversationTurn(conversation);

            writeOutput(`LLM: ${assistantMessage}`);
            await logEvent("turn.completed", {
                durationMs: Date.now() - turnStartedAt
            });
        } catch (error) {
            conversation.length = conversationLengthBeforeTurn;
            writeOutput(`Error: ${error.message}`);
            await logEvent("turn.failed", {
                durationMs: Date.now() - turnStartedAt,
                error: error.message
            });
        }
    }

    await logEvent("session.ended");
    await flushLogs();
    closeTerminal();
}

main().catch(async error => {
    console.error(`Fatal error: ${error.message}`);
    await logEvent("session.failed", { error: error.message });
    await flushLogs();
    closeTerminal();
    process.exitCode = 1;
});
