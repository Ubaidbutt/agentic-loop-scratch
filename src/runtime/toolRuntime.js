import { toolRegistry } from "../tools/registry.js";

export function getToolDefinitions() {
    return Object.values(toolRegistry).map(tool => tool.definition);
}

function parseToolArguments(toolCall) {
    const rawArguments = toolCall.function?.arguments || "{}";
    return JSON.parse(rawArguments);
}

export async function executeToolCall(toolCall) {
    console.info("Executing tool call:", toolCall);

    const toolName = toolCall.function?.name;
    const tool = toolRegistry[toolName];

    if (!tool) {
        return {
            ok: false,
            error: `Unknown tool requested by LLM: ${toolName}`
        };
    }

    try {
        const args = parseToolArguments(toolCall);
        const requiredArguments = tool.definition.function.parameters.required || [];

        // Registry functions use positional parameters in the same order as their schema.
        const positionalArguments = requiredArguments.map(argumentName => args[argumentName]);
        const result = await tool.execute(...positionalArguments);

        return {
            ok: true,
            result
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message
        };
    }
}

export function stringifyToolResult(result) {
    return JSON.stringify(result);
}
