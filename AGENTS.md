# Agent Instructions

## Project Overview

This is a small Node.js CLI for learning and building an agentic data-migration loop without an LLM framework or SDK. The application sends conversation history and tool definitions to an OpenAI-compatible Chat Completions endpoint, executes requested tools locally, returns each result to the LLM, and continues until the LLM produces a final text response.

The long-term project goals and phases are documented in `README.md` and `project.md`.

## Runtime

- Use Node.js 26.
- The project uses ECMAScript modules (`"type": "module"`).
- Install dependencies with `npm install`.
- Start the CLI with `npm start`.
- Set `OPENAI_API_KEY` in a local `.env` file.
- `LLM_URL` can optionally override the default OpenAI endpoint.
- Type `exit` in the CLI to end the current session.

There is currently no automated test suite. At minimum, run syntax checks on changed JavaScript files and use `printf 'exit\n' | npm start` as a non-network smoke test.

## File Responsibilities

- `index.js`: Owns the CLI session, in-memory conversation history, and turn-level error handling.
- `terminal.js`: Reads user input, writes terminal output, and closes the readline interface.
- `conversation.js`: Runs the LLM/tool-call loop and appends assistant and tool messages to the conversation.
- `llmCall.js`: Loads environment variables and makes the raw HTTP request to the LLM endpoint.
- `toolRuntime.js`: Converts registry entries to LLM tool definitions, parses tool calls, executes tools, and serializes results.
- `tools.js`: Implements local tools and exports the tool registry.
- `data/`: Contains files available to local tools. This directory is intentionally ignored by Git.

## Tool Conventions

Register each tool in `toolRegistry` with both an OpenAI-compatible function definition and its local `execute` function. The schema's `required` array must list parameters in the same order expected by the JavaScript function because the runtime currently invokes tools with positional arguments.

Tool failures should be returned to the LLM as structured results instead of terminating the conversation. Keep all file access inside the project `data/` directory and do not expose environment variables or credentials through tools or logs.

## Change Guidelines

Keep `index.js` lean and place new behavior in the module that owns that responsibility. Preserve conversation messages in OpenAI Chat Completions format, avoid adding framework abstractions unless the project requirements change, and never commit `.env`, `node_modules/`, or files under `data/`.
