import path from "node:path";
import { loadEnvFile } from "node:process";
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

export async function callLLM(messages, tools = []) {
    const startedAt = Date.now();
    await logEvent("llm.request.started", {
        messageCount: messages.length,
        toolCount: tools.length,
        model: MODEL_NAME
    });

    try {
        const requestBody = {
            model: MODEL_NAME,
            messages
        };

        if (tools.length > 0) {
            requestBody.tools = tools;
        }

        const response = await fetch(LLM_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        await logEvent("llm.request.completed", {
            durationMs: Date.now() - startedAt,
            status: response.status,
            ok: response.ok
        });

        return data;
    } catch (error) {
        await logEvent("llm.request.failed", {
            durationMs: Date.now() - startedAt,
            error: error.message
        });
        throw error;
    }
}
