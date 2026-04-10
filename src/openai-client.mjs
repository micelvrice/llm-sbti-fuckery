function stripTrailingSlashes(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

function extractTextFromContentPart(part) {
  if (typeof part === 'string') {
    return part;
  }

  if (!part || typeof part !== 'object') {
    return '';
  }

  if (typeof part.text === 'string') {
    return part.text;
  }

  if (typeof part.content === 'string') {
    return part.content;
  }

  if (typeof part.output_text === 'string') {
    return part.output_text;
  }

  if (typeof part.value === 'string') {
    return part.value;
  }

  return '';
}

function extractCompletionText(payload) {
  const choice = payload?.choices?.[0] ?? null;
  const message = choice?.message ?? null;

  const candidates = [
    message?.content,
    message?.text,
    choice?.text,
    payload?.output_text,
    payload?.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }

    if (Array.isArray(candidate)) {
      const joined = candidate
        .map((part) => extractTextFromContentPart(part))
        .join('\n')
        .trim();

      if (joined) {
        return joined;
      }
    }
  }

  if (Array.isArray(payload?.output)) {
    const joined = payload.output
      .flatMap((item) => {
        if (typeof item?.content === 'string') {
          return [item.content];
        }

        if (Array.isArray(item?.content)) {
          return item.content.map((part) => extractTextFromContentPart(part));
        }

        return [];
      })
      .join('\n')
      .trim();

    if (joined) {
      return joined;
    }
  }

  return '';
}

function extractReasoningText(payload) {
  const choice = payload?.choices?.[0] ?? null;
  const message = choice?.message ?? null;

  const candidates = [
    message?.reasoning,
    message?.reasoning_content,
    choice?.reasoning,
    payload?.reasoning
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }

    if (Array.isArray(candidate)) {
      const joined = candidate
        .map((part) => extractTextFromContentPart(part))
        .join('\n')
        .trim();

      if (joined) {
        return joined;
      }
    }
  }

  return '';
}

export function normalizeBaseUrl(baseUrl) {
  const normalized = stripTrailingSlashes(baseUrl);
  if (!normalized) {
    throw new Error('An OpenAI-compatible base URL is required.');
  }

  if (normalized.endsWith('/v1')) {
    return normalized;
  }

  return `${normalized}/v1`;
}

export function createOpenAICompatibleClient({
  baseUrl,
  apiKey,
  requestTimeoutMs = 90000,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    async createChatCompletion({
      model,
      messages,
      temperature = 0,
      maxTokens = 64,
      timeoutMs = requestTimeoutMs,
      responseFormat
    }) {
      if (!model) {
        throw new Error('A model name is required.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            response_format: responseFormat
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(`OpenAI-compatible request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const text = await response.text();
      let payload = null;

      try {
        payload = text ? JSON.parse(text) : null;
      } catch (error) {
        throw new Error(`The API returned non-JSON content: ${text}`);
      }

      if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || text || response.statusText;
        throw new Error(`OpenAI-compatible request failed (${response.status}): ${detail}`);
      }

      const content = extractCompletionText(payload);
      const reasoning = extractReasoningText(payload);

      if (!content && !reasoning) {
        throw new Error(
          `The API returned an empty completion. Available top-level keys: ${Object.keys(payload ?? {}).join(', ')}`
        );
      }

      return {
        id: payload?.id ?? null,
        model: payload?.model ?? model,
        content,
        reasoning,
        raw: payload
      };
    }
  };
}
