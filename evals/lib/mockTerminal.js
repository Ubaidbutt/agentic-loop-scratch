import { mock } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const terminalModuleUrl = pathToFileURL(path.join(projectRoot, "src", "cli", "terminal.js"));

const QUESTION_PREFIX = "LLM question: ";
const APPROVAL_PREFIX = "Allow dependency preparation";

/**
 * Replaces src/cli/terminal.js for the running process so askUserQuestion and
 * the executePythonScript approval gate never block on real stdin. Must be
 * called before anything that transitively imports terminal.js (i.e. before
 * conversation.js / toolRegistry.js are imported).
 */
export function installMockTerminal({ answerQuestion, onTranscriptEntry }) {
    let pendingLines = [];

    mock.module(terminalModuleUrl, {
        namedExports: {
            writeOutput(message) {
                pendingLines.push(message);
            },

            async readUserInput(prompt) {
                if (prompt.startsWith(APPROVAL_PREFIX)) {
                    pendingLines = [];
                    onTranscriptEntry?.({ type: "approval", prompt, answer: "y" });
                    return "y";
                }

                const questionLine = [...pendingLines].reverse()
                    .find(line => line.startsWith(QUESTION_PREFIX));
                const question = questionLine
                    ? questionLine.slice(QUESTION_PREFIX.length)
                    : prompt;
                const options = pendingLines
                    .filter(line => /^\d+\. /.test(line))
                    .map(line => line.replace(/^\d+\. /, ""));

                pendingLines = [];

                const answer = await answerQuestion(question, options);
                onTranscriptEntry?.({ type: "clarification", question, options, answer });
                return answer;
            },

            closeTerminal() {}
        }
    });
}
