#!/usr/bin/env node

import process from 'node:process';

import { createOpenAICompatibleClient } from './openai-client.mjs';
import {
  DEFAULT_EXTRACTION_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  askQuestionWithRetries,
  createOpenAIChoiceProvider
} from './llm-runner.mjs';
import {
  createSeededRandom,
  createSurveySession,
  loadSbtiRuntime
} from './runtime.mjs';

function parseArgs(argv) {
  const options = {
    help: false,
    baseUrl: process.env.OPENAI_BASE_URL ?? process.env.OPENAI_BASEURL ?? null,
    apiKey: process.env.OPENAI_API_KEY ?? null,
    model: process.env.OPENAI_MODEL ?? null,
    systemPrompt: process.env.LLM_SBTI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    extractionSystemPrompt:
      process.env.LLM_SBTI_EXTRACTION_SYSTEM_PROMPT ?? DEFAULT_EXTRACTION_SYSTEM_PROMPT,
    seed: 1,
    questionId: null,
    temperature: 0,
    maxTokens: 512,
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 90000),
    maxRetries: 2,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1] ?? null;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--base-url') {
      options.baseUrl = nextValue;
      index += 1;
      continue;
    }
    if (arg === '--api-key') {
      options.apiKey = nextValue;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      options.model = nextValue;
      index += 1;
      continue;
    }
    if (arg === '--seed') {
      options.seed = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--question-id') {
      options.questionId = nextValue;
      index += 1;
      continue;
    }
    if (arg === '--temperature') {
      options.temperature = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--max-tokens') {
      options.maxTokens = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      options.timeoutMs = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--max-retries') {
      options.maxRetries = Number(nextValue);
      index += 1;
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Test One SBTI Question

Usage:
  node src/test-one-question.mjs --base-url <url> --api-key <key> --model <name>

Options:
  --base-url <url>             OpenAI-compatible base URL.
  --api-key <key>              API key for the provider.
  --model <name>               Model name.
  --seed <number>              Deterministic shuffle seed, default 1.
  --question-id <id>           Optional question id, e.g. q1 or drink_gate_q1.
  --temperature <number>       Sampling temperature.
  --max-tokens <number>        Max completion tokens per call.
  --timeout-ms <number>        Timeout per API call in milliseconds.
  --max-retries <number>       Parse retries for this one question.
  --verbose                    Print raw response traces.
  --help, -h                   Show this help message.
`);
}

function requireOption(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function pickQuestion(session, questionId) {
  const visible = session.getVisibleQuestions();
  if (!questionId) {
    return {
      question: session.getCurrentQuestion(),
      index: session.getProgress().done,
      total: session.getProgress().total
    };
  }

  const foundIndex = visible.findIndex((item) => item.id === questionId);
  if (foundIndex === -1) {
    throw new Error(`Question id not found in visible list: ${questionId}`);
  }

  return {
    question: visible[foundIndex],
    index: foundIndex,
    total: visible.length
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const client = createOpenAICompatibleClient({
    baseUrl: requireOption(options.baseUrl, 'OpenAI-compatible base URL'),
    apiKey: requireOption(options.apiKey, 'OpenAI API key'),
    requestTimeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 90000
  });

  const askChoice = createOpenAIChoiceProvider({
    client,
    model: requireOption(options.model, 'Model'),
    systemPrompt: options.systemPrompt,
    extractionSystemPrompt: options.extractionSystemPrompt,
    temperature: Number.isFinite(options.temperature) ? options.temperature : 0,
    maxTokens: Number.isFinite(options.maxTokens) ? options.maxTokens : 512,
    requestTimeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 90000,
    verbose: options.verbose
  });

  const runtime = await loadSbtiRuntime({
    random: createSeededRandom(options.seed)
  });
  const session = createSurveySession(runtime);
  const { question, index, total } = pickQuestion(session, options.questionId);

  if (!question) {
    throw new Error('No question available to test.');
  }

  const answered = await askQuestionWithRetries({
    askChoice,
    question,
    index,
    total,
    maxRetries: Number.isInteger(options.maxRetries) ? options.maxRetries : 2
  });

  const optionIndex = answered.choice.charCodeAt(0) - 65;
  const option = question.options[optionIndex] ?? null;
  if (!option) {
    throw new Error(`Model returned choice ${answered.choice}, but this option does not exist.`);
  }

  console.log('One-question check passed');
  console.log(`question_id: ${question.id}`);
  console.log(`question_text: ${question.text}`);
  console.log(`choice: ${answered.choice}`);
  console.log(`choice_source: ${answered.choiceSource}`);
  console.log(`selected_value: ${option.value}`);
  console.log(`selected_label: ${option.label}`);
  console.log(`raw_response: ${(answered.response.content || answered.response.reasoning || '').slice(0, 400)}`);
}

run().catch((error) => {
  console.error(`One-question check failed: ${error.message}`);
  process.exitCode = 1;
});
