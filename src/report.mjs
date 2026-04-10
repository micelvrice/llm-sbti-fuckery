import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function sanitizeSegment(value) {
  return String(value ?? 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function buildTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function buildMarkdownReport(payload, metadata = {}) {
  const { result, transcript } = payload;
  const model = metadata.model ?? 'unknown';
  const baseUrl = metadata.baseUrl ?? 'unknown';
  const type = result.finalType;
  const lines = [
    '# LLM SBTI 人格报告',
    '',
    `- 生成时间: ${metadata.generatedAt ?? new Date().toISOString()}`,
    `- 模型: ${model}`,
    `- 接口: ${baseUrl}`,
    '',
    '## 结果摘要',
    '',
    `- 模式: ${result.modeKicker}`,
    `- 最终人格: ${type.code}（${type.cn}）`,
    `- 标识: ${result.badge}`,
    `- 说明: ${result.sub}`,
    `- 结果字符串: ${result.resultPattern}`,
    ''
  ];

  lines.push('## 人格描述', '', type.intro, '', type.desc, '');

  if (result.secondaryType) {
    lines.push(
      '## 常规主类型',
      '',
      `- ${result.secondaryType.code}（${result.secondaryType.cn}）`,
      ''
    );
  }

  lines.push(
    '## Top 5 匹配',
    ''
  );
  result.ranked.slice(0, 5).forEach((match, index) => {
    lines.push(
      `${index + 1}. ${match.code}（${match.cn}） · 相似度 ${match.similarity}% · 精准命中 ${match.exact}/15 · 总差值 ${match.distance}`
    );
  });
  lines.push('');

  lines.push('## 十五维度评分', '');
  Object.entries(result.levels).forEach(([dimensionId, level]) => {
    lines.push(`- ${dimensionId}: ${level} / ${result.rawScores[dimensionId]}分`);
  });
  lines.push('');

  lines.push('## 答题轨迹', '');
  transcript.forEach((entry, index) => {
    lines.push(`${index + 1}. [${entry.questionId}] ${entry.question}`);
    lines.push(`- 最终选项: ${entry.choice}`);
    lines.push(`- 选项文本: ${entry.selectedLabel}`);
    lines.push(`- 解析来源: ${entry.choiceSource}`);
  });
  lines.push('');

  return `${lines.join('\n')}\n`;
}

export async function writeReportFiles({
  payload,
  outputDir,
  metadata
}) {
  const timestamp = buildTimestamp();
  const modelSegment = sanitizeSegment(metadata.model);
  const baseName = `${timestamp}-${modelSegment}-sbti-report`;
  const resolvedOutputDir = path.resolve(outputDir);
  const markdownPath = path.join(resolvedOutputDir, `${baseName}.md`);
  const jsonPath = path.join(resolvedOutputDir, `${baseName}.json`);
  const generatedAt = new Date().toISOString();
  const enrichedMetadata = { ...metadata, generatedAt };
  const serializable = {
    metadata: enrichedMetadata,
    answers: payload.answers,
    result: payload.result,
    transcript: payload.transcript
  };

  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFile(markdownPath, buildMarkdownReport(payload, enrichedMetadata), 'utf8');
  await writeFile(jsonPath, JSON.stringify(serializable, null, 2), 'utf8');

  return {
    outputDir: resolvedOutputDir,
    markdownPath,
    jsonPath,
    generatedAt
  };
}
