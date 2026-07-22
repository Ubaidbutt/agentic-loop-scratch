import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.dirname(srcDir);
export const dataDir = path.join(projectRoot, "data");
export const logsDir = path.join(projectRoot, "logs");
export const pythonDockerImage = "python:3.13.5-slim-bookworm@sha256:4c2cf9917bd1cbacc5e9b07320025bdb7cdf2df7b0ceaccb55e9dd7e30987419";
export const pythonDependencyTimeoutMs = 5 * 60_000;
export const pythonTimeoutMs = 30_000;
export const pythonMemoryLimit = "512m";
export const pythonCpuLimit = "1";
export const pythonProcessLimit = 64;
export const maxGeneratedFileBytes = 100 * 1024 * 1024;
export const maxCommandOutputBytes = 1024 * 1024;
