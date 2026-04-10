import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askQuestionWithRetries,
  buildChoiceExtractionPrompt,
  buildQuestionPrompt,
  createOpenAIChoiceProvider,
  getAvailableChoiceCodes,
  parseChoiceFromText,
  runSurveyWithChoiceProvider
} from '../src/llm-runner.mjs';

test('parseChoiceFromText accepts strict and noisy answers', () => {
  assert.equal(parseChoiceFromText('A'), 'A');
  assert.equal(parseChoiceFromText(' answer: c '), 'C');
  assert.equal(parseChoiceFromText('{"choice":"B"}'), 'B');
  assert.equal(parseChoiceFromText('我选 D，因为更符合。'), 'D');
  assert.equal(parseChoiceFromText("I will select 'A' as the final answer."), 'A');
  assert.equal(parseChoiceFromText('A B C D', { allowedChoices: ['A', 'B', 'C'] }), null);
  assert.equal(parseChoiceFromText('D', { allowedChoices: ['A', 'B', 'C'] }), null);
  assert.equal(parseChoiceFromText(''), null);
  assert.equal(parseChoiceFromText('我不确定'), null);
});

test('getAvailableChoiceCodes follows question option count', () => {
  const codes = getAvailableChoiceCodes({
    options: [{}, {}, {}]
  });
  assert.deepEqual(codes, ['A', 'B', 'C']);
});

test('buildQuestionPrompt formats a single question clearly', () => {
  const prompt = buildQuestionPrompt(
    {
      id: 'q1',
      text: '测试题目',
      options: [
        { label: '选项一', value: 1 },
        { label: '选项二', value: 2 }
      ]
    },
    0,
    31
  );

  assert.match(prompt, /第 1 题 \/ 31/);
  assert.match(prompt, /题目：测试题目/);
  assert.match(prompt, /A\. 选项一/);
  assert.match(prompt, /B\. 选项二/);
  assert.match(prompt, /A、B/);
});

test('buildChoiceExtractionPrompt includes reasoning and options', () => {
  const prompt = buildChoiceExtractionPrompt({
    question: {
      text: '测试题目',
      options: [{ label: '选项一', value: 1 }]
    },
    index: 0,
    total: 31,
    reasoning: 'I will select A as the final answer.'
  });

  assert.match(prompt, /抽取/);
  assert.match(prompt, /I will select A/);
  assert.match(prompt, /A\. 选项一/);
  assert.match(prompt, /只输出一个大写字母：A/);
});

test('askQuestionWithRetries retries until a valid option appears', async () => {
  let calls = 0;

  const result = await askQuestionWithRetries({
    maxRetries: 2,
    question: {
      id: 'q1',
      text: '测试',
      options: [{ label: 'A1', value: 1 }]
    },
    index: 0,
    total: 1,
    askChoice: async () => {
      calls += 1;
      return {
        content: calls === 1 ? '我不确定' : 'A'
      };
    }
  });

  assert.equal(result.choice, 'A');
  assert.equal(calls, 2);
});

test('askQuestionWithRetries rejects out-of-range option and retries', async () => {
  let calls = 0;

  const result = await askQuestionWithRetries({
    maxRetries: 2,
    question: {
      id: 'q21',
      text: '测试三选题',
      options: [
        { label: 'A1', value: 1 },
        { label: 'B1', value: 2 },
        { label: 'C1', value: 3 }
      ]
    },
    index: 0,
    total: 1,
    askChoice: async () => {
      calls += 1;
      return {
        content: calls === 1 ? 'D' : 'C'
      };
    }
  });

  assert.equal(result.choice, 'C');
  assert.equal(calls, 2);
});

test('askQuestionWithRetries can parse a choice from reasoning when content is empty', async () => {
  const result = await askQuestionWithRetries({
    maxRetries: 0,
    question: {
      id: 'q1',
      text: '测试',
      options: [{ label: 'A1', value: 1 }]
    },
    index: 0,
    total: 1,
    askChoice: async () => {
      return {
        content: '',
        reasoning: "I will select 'A' as the final answer."
      };
    }
  });

  assert.equal(result.choice, 'A');
});

test('createOpenAIChoiceProvider uses a second extraction call when the first response only contains opaque reasoning', async () => {
  const calls = [];
  const askChoice = createOpenAIChoiceProvider({
    model: 'demo-model',
    client: {
      async createChatCompletion(input) {
        calls.push(input);
        if (calls.length === 1) {
          return {
            content: '',
            reasoning: 'Long hidden reasoning without an explicit option.',
            raw: {}
          };
        }

        return {
          content: 'B',
          reasoning: '',
          raw: {}
        };
      }
    }
  });

  const response = await askChoice({
    prompt: '题目',
    question: {
      id: 'q1',
      text: '测试题目',
      options: [
        { label: '选项一', value: 1 },
        { label: '选项二', value: 2 }
      ]
    },
    index: 0,
    total: 2,
    attempt: 0
  });

  assert.equal(response.content, 'B');
  assert.equal(response.choiceSource, 'reasoning-extractor');
  assert.equal(calls.length, 2);
});

test('runSurveyWithChoiceProvider completes the bundled survey with a fixed answerer', async () => {
  const payload = await runSurveyWithChoiceProvider({
    seed: 1,
    askChoice: async ({ question }) => {
      if (question.options.length === 4) {
        return { content: 'D' };
      }

      return { content: 'C' };
    }
  });

  assert.equal(payload.transcript.length, 31);
  assert.equal(Object.keys(payload.answers).length, 31);
  assert.equal(typeof payload.result.finalType.code, 'string');
  assert.equal(payload.result.ranked.length > 0, true);
});
