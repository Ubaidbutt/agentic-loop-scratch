import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logsDir } from "../config.js";

const startedAt = new Date();
const timestamp = startedAt.toISOString().replaceAll(":", "-").replaceAll(".", "-");
const sessionId = `${timestamp}-${randomUUID().slice(0, 8)}`;
const logFile = path.join(logsDir, `${sessionId}.jsonl`);

let sequence = 0;
let writeQueue = Promise.resolve();
let persistenceErrorReported = false;

function formatConsoleSuffix(details) {
    const labels = [];

    if (details.round !== undefined) {
        labels.push(`round=${details.round}`);
    }

    if (details.toolName) {
        labels.push(`tool=${details.toolName}`);
    }

    if (details.exitCode !== undefined) {
        labels.push(`exitCode=${details.exitCode}`);
    }

    if (details.durationMs !== undefined) {
        labels.push(`durationMs=${details.durationMs}`);
    }

    return labels.length > 0 ? ` ${labels.join(" ")}` : "";
}

async function persist(record) {
    try {
        await mkdir(logsDir, { recursive: true });
        await appendFile(logFile, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
        if (!persistenceErrorReported) {
            persistenceErrorReported = true;
            console.error(`[agent-log] Could not write session log: ${error.message}`);
        }
    }
}

export function getSessionLogFile() {
    return logFile;
}

export async function logEvent(event, details = {}) {
    const record = {
        timestamp: new Date().toISOString(),
        sequence: ++sequence,
        sessionId,
        event,
        details
    };

    console.info(`[agent-log] ${event}${formatConsoleSuffix(details)}`);

    writeQueue = writeQueue.then(() => persist(record));
    await writeQueue;
}

export async function flushLogs() {
    await writeQueue;
}
