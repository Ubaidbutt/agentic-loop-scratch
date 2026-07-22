import path from "node:path";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { projectRoot } from "../config.js";
import { logEvent } from "../logging/sessionLogger.js";

try {
    loadEnvFile(path.join(projectRoot, ".env"));
} catch (error) {
    if (error.code !== "ENOENT") {
        throw error;
    }
}

const LLM_URL = process.env.LLM_URL || "https://api.openai.com/v1/chat/completions";
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = process.env.LLM_MODEL_NAME || "gpt-4o-mini";
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 20_000;

class LLMRequestError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "LLMRequestError";
        Object.assign(this, details);
    }
}

function isRetryableStatus(status) {
    return status === 429 || status >= 500;
}

function retryDelayMs(attempt, retryAfterHeader) {
    if (typeof retryAfterHeader === "string") {
        const retryAfterSeconds = Number(retryAfterHeader);

        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
            return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
        }
    }

    const exponential = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
    const jitter = Math.random() * BASE_RETRY_DELAY_MS;
    return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
}

export async function callLLM(messages, tools = []) {
    const requestBody = {
        model: MODEL_NAME,
        messages
    };

    if (tools.length > 0) {
        requestBody.tools = tools;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();
        await logEvent("llm.request.started", {
            attempt,
            messageCount: messages.length,
            toolCount: tools.length,
            model: MODEL_NAME
        });

        let response;

        try {
            response = await fetch(LLM_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_KEY}`
                },
                body: JSON.stringify(requestBody)
            });
        } catch (error) {
            const willRetry = attempt < MAX_ATTEMPTS;
            await logEvent(willRetry ? "llm.request.retrying" : "llm.request.failed", {
                attempt,
                durationMs: Date.now() - startedAt,
                reason: "network_error",
                error: error.message
            });

            if (!willRetry) {
                throw new LLMRequestError(
                    `LLM request failed after ${attempt} attempts due to a network error: ${error.message}`,
                    { stage: "llm_request", reason: "network_error", retryable: true }
                );
            }

            await delay(retryDelayMs(attempt));
            continue;
        }

        if (!response.ok && isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
            const delayMs = retryDelayMs(attempt, response.headers.get("retry-after"));
            await logEvent("llm.request.retrying", {
                attempt,
                durationMs: Date.now() - startedAt,
                status: response.status,
                delayMs
            });
            await delay(delayMs);
            continue;
        }

        await logEvent("llm.request.completed", {
            attempt,
            durationMs: Date.now() - startedAt,
            status: response.status,
            ok: response.ok
        });

        if (!response.ok) {
            const errorBody = (await response.text()).slice(0, 500);

            throw new LLMRequestError(
                `LLM request failed with status ${response.status}: ${errorBody}`,
                {
                    stage: "llm_request",
                    reason: response.status === 429
                        ? "rate_limited"
                        : response.status >= 500
                            ? "server_error"
                            : "request_rejected",
                    status: response.status,
                    retryable: isRetryableStatus(response.status)
                }
            );
        }

        return response.json();
    }
}
