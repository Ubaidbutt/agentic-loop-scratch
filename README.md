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

The project uses Node.js 26 and has no third-party runtime dependencies.

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your-api-key
```

You can optionally set `LLM_URL` to use a different OpenAI-compatible endpoint. Start the CLI with:

```sh
npm start
```

Enter instructions at the prompt. Type `exit` to end the session. Files used by the agent are read from and written to the local `data/` directory.

## Isolated Python execution

Docker Desktop must be installed and running. Generated Python transformations do not run directly on the host. For each approved execution, the application:

1. Validates the LLM's third-party dependency declarations while rejecting URLs, paths, install flags, markers, and version ranges.
2. Builds or reuses a dependency image based on a digest-pinned `python:3.13.5-slim-bookworm` image.
3. Copies only the requested script and input into a temporary workspace.
4. Runs the transformation as an unprivileged user with no network, a read-only root filesystem, dropped Linux capabilities, and CPU, memory, process, and time limits.
5. Validates that exactly one regular output file was produced, then atomically copies it into `data/`.

The LLM normally declares package names without guessing versions. The resolver selects packages that provide binary wheels for the pinned Python runtime, captures exact transitive versions, and installs a clean runtime stage from that lock. Source builds are disabled. The dependency-build context contains only a generated Dockerfile and requirements file; it does not contain the transformation script, input data, project files, environment variables, or credentials. Dependency images are cached by the Python image and normalized direct-dependency list, and identical recent build failures are not immediately retried.

Python syntax is checked before dependency preparation. Dependency failures are returned to the agent as concise, stage-specific results while full Docker diagnostics remain in the session log. After ten tool-using rounds, the model receives one final tool-free round so it can report the last outcome instead of terminating with an unhandled round-limit error.

## Evaluations

`evals/` holds end-to-end regression tests for the agent itself: each case gives
the agent a real input file and prompt, lets it run for real (real LLM calls,
real Docker execution, real clarifying questions), and grades the files it
produces against a hand-verified golden answer key. Run them with:

```sh
npm run eval
```

or a single case by name: `npm run eval -- vendorInvoicesPayables`.

Cases form a difficulty ladder, from a pure happy-path smoke test up to the
kind of messy, ambiguous request the agent is ultimately meant to handle:

| Case | What it exercises |
| --- | --- |
| `fahrenheit-to-celsius` | Simplest possible transformation: one input file, one deterministic per-record formula, fully specified in the prompt. No ambiguity, no clarifying questions expected. Checks the straightforward happy path. |
| `orders-summary` | A step up: CSV input, light string cleanup (stripping a `$` prefix), and a group-by-sum aggregation into one JSON output. Still fully specified, no ambiguity. |
| `vendor-invoices-payables` | The hard case: two output files, real validation/rejection logic, currency conversion, date/lateness rules, and deliberately missing policy decisions that require the agent to ask clarifying questions before it can proceed. |

Each case runs in its own temporary sandbox directory (via `DATA_DIR`), never
touching the real `data/` directory, and answers the agent's `askUserQuestion`
calls using a second LLM that plays "the user," grounded in a written policy
doc for that case (`evals/fixtures/<case>/policy.md`). The Python-execution
approval prompt is auto-approved. A case passes only when every expected
output file exists and matches the golden fixture on the graded fields.

This makes real, billed LLM calls and runs Docker containers, so it costs a
small amount and takes a bit of time — expect it to take a couple of minutes
and a few cents at the default model. Because it's a real model, occasional
non-determinism across runs is expected; treat a single failure as a signal
to look closer, not as certain proof of a regression.

To add a case: create a fixtures folder under `evals/fixtures/<case-id>/`
(input file(s), `prompt.txt`, `policy.md`, and an `expected/` folder with
golden output files), then add a case definition in `evals/cases/` describing
which fields to grade and how (`exact`, `numeric`, `set`, or `ignore`).

## Session Logs

Each CLI run creates a structured JSON Lines log in `logs/`. The CLI prints the exact log path when the session starts. Every line is a timestamped event covering the session lifecycle, LLM requests, agent rounds, tool calls, command approvals, command execution, and errors.

The logs include user and assistant messages. File-writing payloads are recorded only by filename and character count, file-reading results use a bounded preview, and environment variables and API keys are never logged. The `logs/` directory is ignored by Git.

Read a session chronologically with:

```sh
cat logs/<session-id>.jsonl
```

If `jq` is available, a more compact timeline is:

```sh
jq -r '[.timestamp, .event, (.details.toolName // "")] | @tsv' logs/<session-id>.jsonl
```
