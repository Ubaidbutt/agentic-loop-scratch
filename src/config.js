import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.dirname(srcDir);
export const dataDir = path.join(projectRoot, "data");
export const logsDir = path.join(projectRoot, "logs");
export const pythonTimeoutMs = 10_000;
export const maxCommandOutputBytes = 1024 * 1024;
