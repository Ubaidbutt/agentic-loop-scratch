import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const terminal = readline.createInterface({ input: stdin, output: stdout });

export async function readUserInput(prompt = "You: ") {
    return terminal.question(prompt);
}

export function writeOutput(message) {
    stdout.write(`${message}\n`);
}

export function closeTerminal() {
    terminal.close();
}
