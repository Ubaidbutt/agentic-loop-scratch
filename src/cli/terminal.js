import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

let terminal;

function getTerminal() {
    if (!terminal) {
        terminal = readline.createInterface({ input: stdin, output: stdout });
    }

    return terminal;
}

export async function readUserInput(prompt = "You: ") {
    return getTerminal().question(prompt);
}

export function writeOutput(message) {
    stdout.write(`${message}\n`);
}

export function closeTerminal() {
    terminal?.close();
    terminal = undefined;
}
