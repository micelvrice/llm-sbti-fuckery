import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAICompatibleClient, normalizeBaseUrl } from '../src/openai-client.mjs';

test('normalizeBaseUrl appends /v1 exactly once', () => {
  assert.equal(normalizeBaseUrl('https://example.com'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com/v1');
  assert.equal(normalizeBaseUrl('https://example.com/v1'), 'https://example.com/v1');
});

test('createOpenAICompatibleClient posts a chat completion request', async () => {
  let request = null;

  const client = createOpenAICompatibleClient({
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            id: 'chatcmpl_1',
            model: 'demo-model',
            choices: [
              {
                message: {
                  content: 'A'
                }
              }
            ]
          });
        }
      };
    }
  });

  const response = await client.createChatCompletion({
    model: 'demo-model',
    messages: [{ role: 'user', content: 'hello' }]
  });

  assert.equal(request.url, 'https://example.com/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.match(request.options.headers.Authorization, /^Bearer /);
  assert.equal(response.content, 'A');
});

test('createOpenAICompatibleClient accepts compatibility payloads that use choice.text', async () => {
  const client = createOpenAICompatibleClient({
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
    fetchImpl: async () => {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            choices: [
              {
                text: 'B'
              }
            ]
          });
        }
      };
    }
  });

  const response = await client.createChatCompletion({
    model: 'demo-model',
    messages: [{ role: 'user', content: 'hello' }]
  });

  assert.equal(response.content, 'B');
});

test('createOpenAICompatibleClient accepts array-based message content', async () => {
  const client = createOpenAICompatibleClient({
    baseUrl: 'https://example.com',
    apiKey: 'sk-test',
    fetchImpl: async () => {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: 'output_text', text: 'C' }
                  ]
                }
              }
            ]
          });
        }
      };
    }
  });

  const response = await client.createChatCompletion({
    model: 'demo-model',
    messages: [{ role: 'user', content: 'hello' }]
  });

  assert.equal(response.content, 'C');
});
