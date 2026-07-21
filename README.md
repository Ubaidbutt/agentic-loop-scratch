# Data Migration Agent — Spec

## Goal

Build a small agentic tool, from scratch, that takes a data file and a natural-language instruction, and transforms the data accordingly — using the core agentic loop (LLM predicts, application executes tools, feeds results back) without relying on any framework/SDK abstraction beyond raw LLM calls.

## Ideal End State

A CLI tool where you point it at a CSV/JSON file, describe in plain English what you want done to the data (reformat, clean, validate, split/merge columns, aggregate, etc.), and it figures out how to do it — writing and running its own scripts, asking you for clarification when your instruction is ambiguous, recovering from its own errors, and producing a correct output file along with a clear log of what it did and why.

## High-Level Phases

1. **Core loop** — get the basic predict → execute → feed-back loop working end-to-end for the simplest possible transformation.
2. **Tooling foundation** — generalize how tools are defined and executed so new capabilities can be added without touching the loop itself.
3. **Robustness** — handle messy real-world input, failures, and ambiguity gracefully instead of just the happy path.
4. **Scale up capability** — support more complex, open-ended transformations (validation, aggregation, multi-step reasoning).
5. **Confidence & polish** — some way to verify the agent is actually doing the right thing consistently, plus visibility into its behavior.

## Running the Project

The project uses Node.js 26.

Install the dependencies:

```sh
npm install
```

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your-api-key
```

You can optionally set `LLM_URL` to use a different OpenAI-compatible endpoint. Start the CLI with:

```sh
npm start
```

Enter instructions at the prompt. Type `exit` to end the session. Files used by the agent are read from and written to the local `data/` directory.
