#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';

import { createOpenAICompatibleClient } from './openai-client.mjs';
import {
  DEFAULT_SYSTEM_PROMPT,
  createOpenAIChoiceProvider,
  runSurveyWithChoiceProvider
} from './llm-runner.mjs';
import { writeReportFiles } from './report.mjs';

function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
    verbose: false,
    baseUrl: process.env.OPENAI_BASE_URL ?? process.env.OPENAI_BASEURL ?? null,
    apiKey: process.env.OPENAI_API_KEY ?? null,
    model: process.env.OPENAI_MODEL ?? null,
    systemPrompt: process.env.LLM_SBTI_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
    seed: null,
    temperature: 0,
    maxRetries: 2,
    maxTokens: 512,
    outputDir: process.env.LLM_SBTI_OUTPUT_DIR ?? 'reports'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1] ?? null;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--verbose') {
      options.verbose = true;
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

    if (arg === '--system-prompt') {
      options.systemPrompt = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--seed') {
      options.seed = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--temperature') {
      options.temperature = Number(nextValue);
      index += 1;
      continue;
    }

    if (arg === '--max-retries') {
      options.maxRetries = Number(nextValue);
      index += 1;
      continue;
    }

    if (arg === '--max-tokens') {
      options.maxTokens = Number(nextValue);
      index += 1;
      continue;
    }

    if (arg === '--output-dir') {
      options.outputDir = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`LLM SBTI CLI

Usage:
  llm-sbti-cli --base-url <url> --api-key <key> --model <name>
  llm-sbti-cli --json

Options:
  --base-url <url>             OpenAI-compatible base URL.
  --api-key <key>              API key for the provider.
  --model <name>               Model name.
  --system-prompt <text>       Override the default evaluator persona.
  --seed <number>              Use deterministic question ordering.
  --temperature <number>       Sampling temperature.
  --max-tokens <number>        Max completion tokens per question.
  --max-retries <number>       Retries per question if parsing fails.
  --output-dir <path>          Directory for the generated local report files.
  --json                       Print the final result as JSON.
  --verbose                    Print raw model answers to stderr.
  --help, -h                   Show this help message.
`);
}

function requireOption(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function printResult(payload) {
  const { result, transcript } = payload;
  const type = result.finalType;

  console.log('LLM SBTI 测试结果');
  console.log('');
  console.log(result.modeKicker);
  console.log(`${type.code}（${type.cn}）`);
  console.log(result.badge);
  console.log(result.sub);
  console.log(`结果字符串: ${result.resultPattern}`);
  console.log('');
  console.log(type.intro);
  console.log(type.desc);

  if (result.secondaryType) {
    console.log('');
    console.log(`常规主类型: ${result.secondaryType.code}（${result.secondaryType.cn}）`);
  }

  console.log('');
  console.log(
    `普通人格第一名: ${result.bestNormal.code}（${result.bestNormal.cn}） · 相似度 ${result.bestNormal.similarity}% · 精准命中 ${result.bestNormal.exact}/15 · 总差值 ${result.bestNormal.distance}`
  );

  console.log('\n答题轨迹');
  transcript.forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.choice} · ${entry.selectedLabel}`);
  });
}

function toSerializablePayload(payload) {
  return {
    answers: payload.answers,
    result: payload.result,
    transcript: payload.transcript,
    report: payload.report ?? null
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
    apiKey: requireOption(options.apiKey, 'OpenAI API key')
  });

  const askChoice = createOpenAIChoiceProvider({
    client,
    model: requireOption(options.model, 'Model'),
    systemPrompt: options.systemPrompt,
    temperature: Number.isFinite(options.temperature) ? options.temperature : 0,
    maxTokens: Number.isFinite(options.maxTokens) ? options.maxTokens : 512,
    verbose: options.verbose
  });

  const payload = await runSurveyWithChoiceProvider({
    askChoice,
    seed: options.seed,
    maxRetries: Number.isInteger(options.maxRetries) ? options.maxRetries : 2
  });

  payload.report = await writeReportFiles({
    payload,
    outputDir: path.resolve(options.outputDir),
    metadata: {
      model: options.model,
      baseUrl: options.baseUrl
    }
  });

  if (options.json) {
    console.log(JSON.stringify(toSerializablePayload(payload), null, 2));
    return;
  }

  printResult(payload);
  console.log('');
  console.log(`报告已保存: ${payload.report.markdownPath}`);
  console.log(`JSON 已保存: ${payload.report.jsonPath}`);
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
