# llm-sbti-fuckery

Run the same SBTI questionnaire against different LLMs and compare their personality outputs.

This project is a local benchmark-style CLI for:
- asking one model to complete the full SBTI test,
- generating a structured report (`.md` + `.json`),
- repeating across models/endpoints for side-by-side analysis.

## Why this repo

- Same question set and scoring logic for every run
- OpenAI-compatible API support (`/v1/chat/completions`)
- Works with reasoning-heavy models
- Extracts final `A/B/C/D` even when the model returns long `thinking` text
- Produces local artifacts you can aggregate later

## Project layout

- `src/cli.mjs`: full 31-question run and report generation
- `src/test-one-question.mjs`: quick single-question health check
- `src/llm-runner.mjs`: prompting, answer parsing, retry/extraction flow
- `src/openai-client.mjs`: OpenAI-compatible client
- `src/runtime.mjs`: local scoring runtime
- `src/bundled-data.mjs`: bundled SBTI snapshot
- `src/report.mjs`: markdown/json report writer
- `test/*.test.mjs`: parser/runtime/report tests

## Quick start

```bash
git clone https://github.com/micelvrice/llm-sbti-fuckery.git
cd llm-sbti-fuckery
npm test
```

Set provider env vars:

```bash
export OPENAI_BASE_URL="https://your-endpoint/v1"
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="qwen-latest"
```

Run a full test:

```bash
node src/cli.mjs --verbose --max-tokens 512 --output-dir reports
```

Run one-question smoke test:

```bash
node src/test-one-question.mjs --question-id q1 --verbose
```

## Exhibition board (multi-LLM comparison)

This repo includes a static exhibition page for visual comparison:
- personality cards per model
- similarity bar chart
- 15-dimension radar overlay
- L/M/H heatmap
- pairwise personality distance table
- answer-source breakdown (`content` vs `reasoning`)

Data flow:

1. Put report files (`*.json` + `*.md`) into `exhibition/reports/`
2. Build aggregated data:

```bash
npm run build:exhibition
```

3. Open `exhibition/index.html` (or publish `exhibition/` with GitHub Pages)

## Output

Each completed full run writes:
- `reports/<timestamp>-<model>-sbti-report.md`
- `reports/<timestamp>-<model>-sbti-report.json`

The JSON includes:
- model metadata
- answers
- final type + ranking + dimension scores
- transcript with `choiceSource` (`content`, `reasoning`, or `reasoning-extractor`)

## CLI options (full run)

- `--base-url <url>`
- `--api-key <key>`
- `--model <name>`
- `--system-prompt <text>`
- `--seed <number>`
- `--temperature <number>`
- `--max-tokens <number>`
- `--max-retries <number>`
- `--output-dir <path>`
- `--verbose`
- `--json`

## Notes

- Scoring is local and deterministic. Only answering calls the remote model.
- For models that expose only reasoning text, the runner performs an extra extraction call to force a final option.
