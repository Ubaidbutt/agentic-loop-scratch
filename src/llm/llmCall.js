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

const DEFAULT_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_RESPONSES_URL = "https://api.openai.com/v1/responses";
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL_NAME = process.env.LLM_MODEL_NAME || "gpt-4o-mini";
const REQUESTED_API_MODE = process.env.LLM_API_MODE || "auto";
const REASONING_EFFORT = process.env.LLM_REASONING_EFFORT;
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 20_000;
const validApiModes = new Set(["auto", "chat_completions", "responses"]);
const validReasoningEfforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

class LLMRequestError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = "LLMRequestError";
        Object.assign(this, details);
    }
}

function isGpt56Model(modelName) {
    return /^gpt-5\.6(?:-|$)/.test(modelName);
}

function isOpenAIReasoningModel(modelName) {
    return isGpt56Model(modelName) || /^o\d/.test(modelName);
}

function explicitUrlApiMode(url) {
    if (!url) {
        return null;
    }

    if (url.endsWith("/responses")) {
        return "responses";
    }

    if (url.endsWith("/chat/completions")) {
        return "chat_completions";
    }

    return null;
}

function resolveApiMode({ requestedApiMode, modelName, tools, llmUrl }) {
    if (!validApiModes.has(requestedApiMode)) {
        throw new LLMRequestError(
            `Invalid LLM_API_MODE "${requestedApiMode}". Use auto, responses, or chat_completions.`,
            { stage: "llm_config", reason: "invalid_api_mode", retryable: false }
        );
    }

    if (requestedApiMode !== "auto") {
        return requestedApiMode;
    }

    const urlMode = explicitUrlApiMode(llmUrl);

    if (urlMode) {
        return urlMode;
    }

    if (llmUrl) {
        return "chat_completions";
    }

    if (isGpt56Model(modelName) || (isOpenAIReasoningModel(modelName) && tools.length > 0)) {
        return "responses";
    }

    return "chat_completions";
}

function resolveUrl(apiMode) {
    if (process.env.LLM_URL) {
        return process.env.LLM_URL;
    }

    return apiMode === "responses" ? DEFAULT_RESPONSES_URL : DEFAULT_CHAT_COMPLETIONS_URL;
}

function normalizedReasoningEffort(apiMode, modelName) {
    if (!REASONING_EFFORT) {
        return null;
    }

    if (!validReasoningEfforts.has(REASONING_EFFORT)) {
        throw new LLMRequestError(
            `Invalid LLM_REASONING_EFFORT "${REASONING_EFFORT}". Use none, minimal, low, medium, high, xhigh, or max.`,
            { stage: "llm_config", reason: "invalid_reasoning_effort", retryable: false }
        );
    }

    if (!isOpenAIReasoningModel(modelName)) {
        return null;
    }

    if (apiMode === "chat_completions" && REASONING_EFFORT === "minimal") {
        throw new LLMRequestError(
            "LLM_REASONING_EFFORT=minimal is only supported in Responses mode. Use none, low, medium, high, xhigh, or max for Chat Completions.",
            { stage: "llm_config", reason: "invalid_reasoning_effort", retryable: false }
        );
    }

    return REASONING_EFFORT;
}

function validateApiCombination({ apiMode, modelName, tools, reasoningEffort }) {
    if (
        apiMode === "chat_completions" &&
        tools.length > 0 &&
        isGpt56Model(modelName) &&
        reasoningEffort !== "none"
    ) {
        throw new LLMRequestError(
            [
                "GPT-5.6 function tools in Chat Completions require LLM_REASONING_EFFORT=none.",
                "Use LLM_API_MODE=responses to combine GPT-5.6 reasoning with tool calling."
            ].join(" "),
            {
                stage: "llm_config",
                reason: "unsupported_reasoning_tools_combination",
                retryable: false
            }
        );
    }
}

// The rest of the application speaks chat-completions shapes (messages in,
// {choices:[{message}]} out). Responses-mode assistant messages carry
// _responsesOutput so this adapter can replay reasoning/function-call items
// losslessly on the next request.
function toResponsesInput(messages) {
    const input = [];

    for (const message of messages) {
        if (message._responsesOutput) {
            input.push(...message._responsesOutput);
            continue;
        }

        if (message.role === "tool") {
            input.push({
                type: "function_call_output",
                call_id: message.tool_call_id,
                output: message.content
            });
            continue;
        }

        if (message.role === "assistant" && message.tool_calls?.length) {
            if (message.content) {
                input.push({ role: "assistant", content: message.content });
            }

            for (const toolCall of message.tool_calls) {
                input.push({
                    type: "function_call",
                    call_id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                });
            }
            continue;
        }

        input.push({ role: message.role, content: message.content });
    }

    return input;
}

function toResponsesTools(tools) {
    return tools.map(tool => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: false
    }));
}

function toChatCompletionsTools(tools) {
    return tools;
}

function toChatCompletionsShapeFromResponses(responsesApiResult) {
    let content = null;
    const toolCalls = [];

    for (const item of responsesApiResult.output ?? []) {
        if (item.type === "message") {
            const text = (item.content ?? [])
                .filter(part => part.type === "output_text")
                .map(part => part.text)
                .join("");

            if (text) {
                content = (content ?? "") + text;
            }
        } else if (item.type === "function_call") {
            toolCalls.push({
                id: item.call_id,
                type: "function",
                function: { name: item.name, arguments: item.arguments }
            });
        }
    }

    return {
        choices: [{
            message: {
                role: "assistant",
                content,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                _responsesOutput: responsesApiResult.output ?? [],
                _responsesId: responsesApiResult.id ?? null
            }
        }]
    };
}

function buildResponsesRequestBody(messages, tools, reasoningEffort) {
    const requestBody = {
        model: MODEL_NAME,
        input: toResponsesInput(messages),
        store: false
    };

    if (reasoningEffort && isOpenAIReasoningModel(MODEL_NAME)) {
        requestBody.reasoning = { effort: reasoningEffort };
    }

    if (tools.length > 0) {
        requestBody.tools = toResponsesTools(tools);
    }

    return requestBody;
}

function buildChatCompletionsRequestBody(messages, tools, reasoningEffort) {
    const requestBody = {
        model: MODEL_NAME,
        messages: messages.map(message => {
            const { _responsesOutput, _responsesId, ...chatMessage } = message;
            return chatMessage;
        }),
        store: false
    };

    if (reasoningEffort && isOpenAIReasoningModel(MODEL_NAME)) {
        requestBody.reasoning_effort = reasoningEffort;
    }

    if (tools.length > 0) {
        requestBody.tools = toChatCompletionsTools(tools);
    }

    return requestBody;
}

async function parseLLMResponse(response, apiMode) {
    const responseBody = await response.json();
    return apiMode === "responses"
        ? toChatCompletionsShapeFromResponses(responseBody)
        : responseBody;
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
    const apiMode = resolveApiMode({
        requestedApiMode: REQUESTED_API_MODE,
        modelName: MODEL_NAME,
        tools,
        llmUrl: process.env.LLM_URL
    });
    const llmUrl = resolveUrl(apiMode);
    const reasoningEffort = normalizedReasoningEffort(apiMode, MODEL_NAME);

    validateApiCombination({
        apiMode,
        modelName: MODEL_NAME,
        tools,
        reasoningEffort
    });

    const requestBody = apiMode === "responses"
        ? buildResponsesRequestBody(messages, tools, reasoningEffort)
        : buildChatCompletionsRequestBody(messages, tools, reasoningEffort);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const startedAt = Date.now();
        await logEvent("llm.request.started", {
            attempt,
            messageCount: messages.length,
            toolCount: tools.length,
            model: MODEL_NAME,
            apiMode,
            reasoningEffort
        });

        let response;

        try {
            response = await fetch(llmUrl, {
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

        return parseLLMResponse(response, apiMode);
    }
}
