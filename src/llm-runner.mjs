import {
  buildResultSummary,
  createSeededRandom,
  createSurveySession,
  formatOptionCode,
  getQuestionMetaLabel,
  loadSbtiRuntime
} from './runtime.mjs';

export const DEFAULT_SYSTEM_PROMPT = [
  '你正在扮演一个需要完成 SBTI 问卷的 LLM 代理。',
  '每次只回答当前题目。',
  '你必须在看完题目和选项后，从 A、B、C、D 中选择一个最符合你稳定倾向的答案。',
  '不要解释，不要输出多余文本。',
  '最终只输出一个大写字母，例如 A。'
].join('\n');

export const DEFAULT_EXTRACTION_SYSTEM_PROMPT = [
  '你是一个答案抽取器。',
  '你会收到一道选择题、候选选项以及另一模型的思考文本。',
  '你的任务不是重新思考题目，而是从已有思考中抽取该模型最终想选的选项。',
  '如果思考文本明确表达了最终倾向，只输出一个大写字母 A、B、C 或 D。',
  '不要解释，不要输出其他文本。'
].join('\n');

const CHOICE_PATTERN = /\b([A-D])\b/gi;
const STRONG_PATTERNS = [
  /"?(?:ANSWER|CHOICE)"?\s*[:=]\s*"?(A|B|C|D)"?/i,
  /(?:SELECT|SELECTED|CHOOSE|CHOSEN|PICK|PICKED|OUTPUT)\s+['"]?(A|B|C|D)['"]?/i,
  /(?:我选择|我选|选择|选)\s*['"]?(A|B|C|D)['"]?/i,
  /(?:最终答案|答案)\s*[:：]?\s*['"]?(A|B|C|D)['"]?/i
];

export function getAvailableChoiceCodes(question) {
  return question.options.map((_, optionIndex) => formatOptionCode(optionIndex).toUpperCase());
}

function normalizeAllowedChoices(allowedChoices) {
  if (!Array.isArray(allowedChoices) || !allowedChoices.length) {
    return ['A', 'B', 'C', 'D'];
  }
  return allowedChoices.map((item) => String(item).toUpperCase());
}

export function parseChoiceFromText(content, { allowedChoices } = {}) {
  const normalized = String(content ?? '').trim().toUpperCase();
  const allowedSet = new Set(normalizeAllowedChoices(allowedChoices));
  if (!normalized) {
    return null;
  }

  if (/^[A-D]$/.test(normalized) && allowedSet.has(normalized)) {
    return normalized;
  }

  for (const pattern of STRONG_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const picked = match[1].toUpperCase();
      if (allowedSet.has(picked)) {
        return picked;
      }
    }
  }

  const matches = Array.from(normalized.matchAll(CHOICE_PATTERN))
    .map((item) => item[1].toUpperCase())
    .filter((letter) => allowedSet.has(letter));

  if (matches.length === 1) {
    return matches[0];
  }

  return null;
}

export function buildQuestionPrompt(question, index, total) {
  const availableChoices = getAvailableChoiceCodes(question);
  const lines = [
    `题目进度：第 ${index + 1} 题 / ${total}`,
    `题目类型：${getQuestionMetaLabel(question)}`,
    `题目：${question.text}`,
    '选项：'
  ];

  question.options.forEach((option, optionIndex) => {
    lines.push(`${formatOptionCode(optionIndex)}. ${option.label}`);
  });

  lines.push(`请只返回一个字母：${availableChoices.join('、')}。`);
  return lines.join('\n');
}

export function buildChoiceExtractionPrompt({ question, index, total, reasoning }) {
  const availableChoices = getAvailableChoiceCodes(question);
  return [
    `题目进度：第 ${index + 1} 题 / ${total}`,
    `题目：${question.text}`,
    '选项：',
    ...question.options.map((option, optionIndex) => `${formatOptionCode(optionIndex)}. ${option.label}`),
    '',
    '下面是该模型的思考过程，请抽取它最终想选的选项：',
    reasoning,
    '',
    `只输出一个大写字母：${availableChoices.join('、')}。`
  ].join('\n');
}

export async function askQuestionWithRetries({
  askChoice,
  question,
  index,
  total,
  maxRetries = 2
}) {
  const prompt = buildQuestionPrompt(question, index, total);
  const availableChoices = getAvailableChoiceCodes(question);
  let lastResponse = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await askChoice({
      prompt,
      question,
      index,
      total,
      attempt
    });

    const choice =
      parseChoiceFromText(response.content, { allowedChoices: availableChoices }) ??
      parseChoiceFromText(response.reasoning, { allowedChoices: availableChoices });
    lastResponse = response;

    if (choice) {
      return {
        choice,
        choiceSource: response.choiceSource ?? (response.content ? 'content' : 'reasoning'),
        prompt,
        response
      };
    }
  }

  throw new Error(
    `Failed to parse a valid option for question ${question.id}. Last response: ${lastResponse?.content || lastResponse?.reasoning || '<empty>'}`
  );
}

export async function runSurveyWithChoiceProvider({
  askChoice,
  seed = null,
  maxRetries = 2
}) {
  const random = seed === null ? Math.random : createSeededRandom(seed);
  const runtime = await loadSbtiRuntime({ random });
  const session = createSurveySession(runtime);
  const transcript = [];

  while (!session.getProgress().complete) {
    const progress = session.getProgress();
    const question = session.getCurrentQuestion();

    const answered = await askQuestionWithRetries({
      askChoice,
      question,
      index: progress.done,
      total: progress.total,
      maxRetries
    });

    const optionIndex = answered.choice.charCodeAt(0) - 65;
    const option = question.options[optionIndex];

    if (!option) {
      throw new Error(`Choice ${answered.choice} is not available for question ${question.id}.`);
    }

    session.answerQuestion(question.id, option.value);
    transcript.push({
      questionId: question.id,
      question: question.text,
      choice: answered.choice,
      choiceSource: answered.choiceSource,
      selectedValue: option.value,
      selectedLabel: option.label,
      rawResponse: answered.response.content || answered.response.reasoning || ''
    });
  }

  const answers = session.getAnswers();
  const result = buildResultSummary(runtime, answers);

  return {
    runtime,
    answers,
    result,
    transcript
  };
}

export function createOpenAIChoiceProvider({
  client,
  model,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  extractionSystemPrompt = DEFAULT_EXTRACTION_SYSTEM_PROMPT,
  temperature = 0,
  maxTokens = 512,
  requestTimeoutMs = 90000,
  verbose = false
}) {
  return async function askChoice({ prompt, question, index, total, attempt }) {
    const availableChoices = getAvailableChoiceCodes(question);
    if (verbose) {
      console.error(
        `[llm] q=${question.id} index=${index + 1}/${total} attempt=${attempt + 1} sending primary request`
      );
    }

    const response = await client.createChatCompletion({
      model,
      temperature,
      maxTokens,
      timeoutMs: requestTimeoutMs,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    });

    const directChoice =
      parseChoiceFromText(response.content, { allowedChoices: availableChoices }) ??
      parseChoiceFromText(response.reasoning, { allowedChoices: availableChoices });
    if (directChoice) {
      return {
        ...response,
        choiceSource: response.content ? 'content' : 'reasoning'
      };
    }

    if (response.reasoning) {
      const extractionResponse = await client.createChatCompletion({
        model,
        temperature: 0,
        maxTokens: 32,
        timeoutMs: requestTimeoutMs,
        messages: [
          { role: 'system', content: extractionSystemPrompt },
          {
            role: 'user',
            content: buildChoiceExtractionPrompt({
              question,
              index,
              total,
              reasoning: response.reasoning
            })
          }
        ]
      });

      const extractedChoice =
        parseChoiceFromText(extractionResponse.content, { allowedChoices: availableChoices }) ??
        parseChoiceFromText(extractionResponse.reasoning, { allowedChoices: availableChoices });

      if (verbose) {
        console.error(
          `[llm] q=${question.id} extractor content=${JSON.stringify(extractionResponse.content)} reasoning=${JSON.stringify(extractionResponse.reasoning)} extracted=${JSON.stringify(extractedChoice)}`
        );
      }

      if (extractedChoice) {
        return {
          ...response,
          content: extractedChoice,
          extractedFromReasoning: true,
          choiceSource: 'reasoning-extractor'
        };
      }
    }

    if (verbose) {
      console.error(
        `[llm] q=${question.id} index=${index + 1}/${total} attempt=${attempt + 1} content=${JSON.stringify(response.content)} reasoning=${JSON.stringify(response.reasoning)}`
      );
    }

    return response;
  };
}
