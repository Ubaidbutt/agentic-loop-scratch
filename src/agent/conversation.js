import { callLLM } from "../llm/llmCall.js";
import {
    executeToolCall,
    getToolDefinitions,
    stringifyToolResult
} from "../runtime/toolRuntime.js";

const MAX_TOOL_CALL_ROUNDS = 5;
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

export async function runConversationTurn(conversation) {
    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
        const response = await callLLM(conversation, toolDefinitions);
        const assistantMessage = getAssistantMessage(response);

        conversation.push(assistantMessage);

        if (!assistantMessage.tool_calls?.length) {
            return getAssistantText(response);
        }

        for (const toolCall of assistantMessage.tool_calls) {
            const toolResult = await executeToolCall(toolCall);

            conversation.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: stringifyToolResult(toolResult)
            });
        }
    }

    throw new Error("Reached maximum tool-call rounds without a final LLM response.");
}
