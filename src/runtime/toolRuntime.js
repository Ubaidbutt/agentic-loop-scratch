import { toolRegistry } from "../tools/registry.js";
import { logEvent } from "../logging/sessionLogger.js";

export function getToolDefinitions() {
    return Object.values(toolRegistry).map(tool => tool.definition);
}

function parseToolArguments(toolCall) {
    const rawArguments = toolCall.function?.arguments || "{}";
    return JSON.parse(rawArguments);
}

function summarizeToolArguments(toolName, args) {
    if (toolName === "writeFile") {
        return {
            filename: args.filename,
            dataLength: typeof args.data === "string" ? args.data.length : null
        };
    }

    return args;
}

function summarizeText(value, previewLength = 500) {
    if (typeof value !== "string") {
        return value;
    }

    return {
        length: value.length,
        preview: value.slice(0, previewLength),
        truncated: value.length > previewLength
    };
}

function summarizeToolResult(toolName, result) {
    if (toolName === "readFile") {
        return summarizeText(result);
    }

    if (toolName === "executePythonScript") {
        return {
            ...result,
            stdout: summarizeText(result.stdout),
            stderr: summarizeText(result.stderr)
        };
    }

    return result;
}

export async function executeToolCall(toolCall) {
    const toolName = toolCall.function?.name;
    const tool = toolRegistry[toolName];
    const toolCallId = toolCall.id ?? null;
    const startedAt = Date.now();

    if (!tool) {
        await logEvent("tool.call.rejected", {
            toolName,
            toolCallId,
            error: `Unknown tool requested by LLM: ${toolName}`
        });

        return {
            ok: false,
            error: `Unknown tool requested by LLM: ${toolName}`
        };
    }

    try {
        const args = parseToolArguments(toolCall);
        await logEvent("tool.call.started", {
            toolName,
            toolCallId,
            arguments: summarizeToolArguments(toolName, args)
        });

        const requiredArguments = tool.definition.function.parameters.required || [];

        // Registry functions use positional parameters in the same order as their schema.
        const positionalArguments = requiredArguments.map(argumentName => args[argumentName]);
        const result = await tool.execute(...positionalArguments);

        await logEvent("tool.call.completed", {
            toolName,
            toolCallId,
            durationMs: Date.now() - startedAt,
            result: summarizeToolResult(toolName, result)
        });

        return {
            ok: true,
            result
        };
    } catch (error) {
        await logEvent("tool.call.failed", {
            toolName,
            toolCallId,
            durationMs: Date.now() - startedAt,
            error: error.message
        });

        return {
            ok: false,
            error: error.message
        };
    }
}

export function stringifyToolResult(result) {
    return JSON.stringify(result);
}
