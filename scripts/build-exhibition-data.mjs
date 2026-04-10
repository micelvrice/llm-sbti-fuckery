import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const reportsDir = path.join(repoRoot, 'exhibition', 'reports');
const dataDir = path.join(repoRoot, 'exhibition', 'data');
const outputPath = path.join(dataDir, 'summary.json');

const LEVEL_NUM = { L: 1, M: 2, H: 3 };

function providerFromModel(modelName) {
  const normalized = String(modelName || '').toLowerCase();
  if (normalized.includes('qwen')) return 'qwen';
  if (normalized.includes('minimax')) return 'minimax';
  if (normalized.includes('gpt')) return 'openai';
  return normalized.split('-')[0] || 'unknown';
}

function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, item) => sum + item, 0) / numbers.length;
}

function buildChoiceSourceStats(transcript = []) {
  const counts = {};
  for (const item of transcript) {
    const source = item.choiceSource || 'unknown';
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

function pairwiseDistance(leftLevels, rightLevels, dimensionOrder) {
  let distance = 0;
  for (const dimensionId of dimensionOrder) {
    distance += Math.abs((leftLevels[dimensionId] || 0) - (rightLevels[dimensionId] || 0));
  }
  return distance;
}

const entries = await readdir(reportsDir, { withFileTypes: true });
const jsonFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => path.join(reportsDir, entry.name))
  .sort();

if (!jsonFiles.length) {
  throw new Error(`No JSON reports found in ${reportsDir}`);
}

const reports = [];
for (const filePath of jsonFiles) {
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  reports.push({
    fileName: path.basename(filePath),
    markdownFileName: path.basename(filePath).replace(/\.json$/i, '.md'),
    ...parsed
  });
}

reports.sort(
  (left, right) =>
    new Date(left.metadata?.generatedAt || 0).getTime() -
    new Date(right.metadata?.generatedAt || 0).getTime()
);

const dimensionOrder = Object.keys(reports[0].result.levels);
const models = reports.map((report) => {
  const levelNumbers = Object.fromEntries(
    Object.entries(report.result.levels).map(([dimensionId, level]) => [
      dimensionId,
      LEVEL_NUM[level] || 0
    ])
  );

  const modelName = report.metadata.model;
  return {
    id: report.fileName.replace(/\.json$/i, ''),
    fileName: report.fileName,
    markdownFileName: report.markdownFileName,
    model: modelName,
    provider: providerFromModel(modelName),
    generatedAt: report.metadata.generatedAt,
    baseUrl: report.metadata.baseUrl,
    finalType: {
      code: report.result.finalType.code,
      cn: report.result.finalType.cn,
      intro: report.result.finalType.intro
    },
    modeKicker: report.result.modeKicker,
    resultPattern: report.result.resultPattern,
    bestNormal: report.result.bestNormal
      ? {
          code: report.result.bestNormal.code,
          cn: report.result.bestNormal.cn,
          similarity: report.result.bestNormal.similarity,
          distance: report.result.bestNormal.distance
        }
      : null,
    rawScores: report.result.rawScores,
    levels: report.result.levels,
    levelNumbers,
    top5: report.result.ranked.slice(0, 5).map((item) => ({
      code: item.code,
      cn: item.cn,
      similarity: item.similarity,
      distance: item.distance
    })),
    choiceSourceStats: buildChoiceSourceStats(report.transcript),
    answerCount: Object.keys(report.answers || {}).length
  };
});

const typeCounts = {};
for (const item of models) {
  typeCounts[item.finalType.code] = (typeCounts[item.finalType.code] || 0) + 1;
}

const providerCounts = {};
for (const item of models) {
  providerCounts[item.provider] = (providerCounts[item.provider] || 0) + 1;
}

const dimensionAverages = {};
for (const dimensionId of dimensionOrder) {
  dimensionAverages[dimensionId] = average(models.map((item) => item.levelNumbers[dimensionId] || 0));
}

const pairwise = [];
for (let i = 0; i < models.length; i += 1) {
  for (let j = i + 1; j < models.length; j += 1) {
    pairwise.push({
      left: models[i].model,
      right: models[j].model,
      distance: pairwiseDistance(models[i].levelNumbers, models[j].levelNumbers, dimensionOrder)
    });
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  totalModels: models.length,
  uniqueFinalTypes: Object.keys(typeCounts).length,
  dimensionOrder,
  models,
  typeCounts,
  providerCounts,
  dimensionAverages,
  pairwise
};

await mkdir(dataDir, { recursive: true });
await writeFile(outputPath, JSON.stringify(summary, null, 2), 'utf8');

console.log(`Wrote exhibition summary: ${outputPath}`);
