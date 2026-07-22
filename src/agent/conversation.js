import { callLLM } from "../llm/llmCall.js";
import {
    executeToolCall,
    getToolDefinitions,
    stringifyToolResult
} from "../runtime/toolRuntime.js";
import { logEvent } from "../logging/sessionLogger.js";

const MAX_TOOL_CALL_ROUNDS = 10;
const toolDefinitions = getToolDefinitions();

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

export async function runConversationTurn(conversation, {
    llmCaller = callLLM,
    availableTools = toolDefinitions,
    toolExecutor = executeToolCall
} = {}) {
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
            return getAssistantText(response);
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

    await logEvent("assistant.message", {
        round: finalRoundNumber,
        content: assistantMessage.content ?? null,
        requestedTools: [],
        toolsAvailable: false
    });

    return getAssistantText(response);
}
