import { callLLM } from "../llm/llmCall.js";
import {
    executeToolCall,
    getToolDefinitions,
    stringifyToolResult
} from "../runtime/toolRuntime.js";
import { logEvent } from "../logging/sessionLogger.js";

const MAX_TOOL_CALL_ROUNDS = 10;
const MAX_STATUS_REPAIR_ATTEMPTS = 2;
const toolDefinitions = getToolDefinitions();
const terminalStatuses = new Set(["complete", "needs_user", "blocked"]);

function getAssistantMessage(response) {
    const message = response?.choices?.[0]?.message;

    if (!message) {
        throw new Error(`LLM response did not include a message: ${JSON.stringify(response)}`);
    }

    return message;
}

function getAssistantText(response) {
    return response?.choices?.[0]?.message?.content ?? JSON.stringify(response, null, 2);
}

function stripMarkdownFence(text) {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function parseTurnStatus(text) {
    if (typeof text !== "string" || text.trim() === "") {
        return {
            valid: false,
            reason: "empty_content"
        };
    }

    let parsed;

    try {
        parsed = JSON.parse(stripMarkdownFence(text));
    } catch {
        return {
            valid: false,
            reason: "invalid_json"
        };
    }

    if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        !terminalStatuses.has(parsed.status) ||
        typeof parsed.message !== "string" ||
        parsed.message.trim() === ""
    ) {
        return {
            valid: false,
            reason: "invalid_status_shape"
        };
    }

    return {
        valid: true,
        status: parsed.status,
        message: parsed.message.trim()
    };
}

function looksLikeUnfinishedWork(text) {
    if (typeof text !== "string") {
        return false;
    }

    return /\b(i will|i'll|let me|next i|now i will|i am going to|i'll proceed|let's proceed|please hold on|hold on while|i will revise|i will update|i will re-?run|i will regenerate|i'll run|i'll create)\b/i.test(text);
}

function statusRepairPrompt({ reason, content, availableToolCount }) {
    const toolInstruction = availableToolCount > 0
        ? "If work remains and a tool can make progress, call the next tool now."
        : "No tools are available in this final response, so report complete or blocked.";

    return [
        `Your previous assistant message did not follow the required turn status protocol (${reason}).`,
        toolInstruction,
        "If no tool call is needed, respond only as JSON:",
        "{\"status\":\"complete|needs_user|blocked\",\"message\":\"user-facing message\"}",
        "Do not describe future actions unless you call the tool in the same assistant message.",
        `Previous content: ${content || "<empty>"}`
    ].join("\n");
}

export async function runConversationTurn(conversation, {
    llmCaller = callLLM,
    availableTools = toolDefinitions,
    toolExecutor = executeToolCall
} = {}) {
    let statusRepairAttempts = 0;

    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
        const roundNumber = round + 1;
        await logEvent("agent.round.started", {
            round: roundNumber,
            messageCount: conversation.length
        });

        const response = await llmCaller(conversation, availableTools);
        const assistantMessage = getAssistantMessage(response);

        conversation.push(assistantMessage);

        await logEvent("assistant.message", {
            round: roundNumber,
            content: assistantMessage.content ?? null,
            requestedTools: assistantMessage.tool_calls?.map(toolCall => ({
                id: toolCall.id,
                name: toolCall.function?.name
            })) ?? []
        });

        if (!assistantMessage.tool_calls?.length) {
            const assistantText = getAssistantText(response);
            const turnStatus = parseTurnStatus(assistantText);

            await logEvent("assistant.status.evaluated", {
                round: roundNumber,
                valid: turnStatus.valid,
                status: turnStatus.status ?? null,
                reason: turnStatus.reason ?? null,
                unfinishedWorkHint: looksLikeUnfinishedWork(assistantText)
            });

            if (turnStatus.valid) {
                return turnStatus.message;
            }

            if (
                statusRepairAttempts < MAX_STATUS_REPAIR_ATTEMPTS &&
                (availableTools.length > 0 || looksLikeUnfinishedWork(assistantText))
            ) {
                statusRepairAttempts += 1;
                conversation.push({
                    role: "user",
                    content: statusRepairPrompt({
                        reason: turnStatus.reason,
                        content: assistantText,
                        availableToolCount: availableTools.length
                    })
                });
                continue;
            }

            return assistantText;
        }

        for (const toolCall of assistantMessage.tool_calls) {
            const toolResult = await toolExecutor(toolCall);

            conversation.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: stringifyToolResult(toolResult)
            });
        }
    }

    const finalRoundNumber = MAX_TOOL_CALL_ROUNDS + 1;
    await logEvent("agent.final-response.started", {
        round: finalRoundNumber,
        messageCount: conversation.length,
        reason: "maximum_tool_rounds_reached"
    });

    // Give the model one tool-free call to explain the outcome instead of
    // discarding the result of the final permitted tool execution.
    const response = await llmCaller(conversation, []);
    const assistantMessage = getAssistantMessage(response);
    conversation.push(assistantMessage);
    const assistantText = getAssistantText(response);
    const turnStatus = parseTurnStatus(assistantText);

    await logEvent("assistant.message", {
        round: finalRoundNumber,
        content: assistantMessage.content ?? null,
        requestedTools: [],
        toolsAvailable: false
    });
    await logEvent("assistant.status.evaluated", {
        round: finalRoundNumber,
        valid: turnStatus.valid,
        status: turnStatus.status ?? null,
        reason: turnStatus.reason ?? null,
        unfinishedWorkHint: looksLikeUnfinishedWork(assistantText)
    });

    return turnStatus.valid ? turnStatus.message : assistantText;
}
