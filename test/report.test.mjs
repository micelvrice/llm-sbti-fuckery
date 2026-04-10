import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildMarkdownReport, writeReportFiles } from '../src/report.mjs';

function createPayload() {
  return {
    answers: { q1: 1 },
    result: {
      modeKicker: '你的主类型',
      finalType: { code: 'CTRL', cn: '控制者', intro: 'intro', desc: 'desc' },
      badge: 'badge',
      sub: 'sub',
      resultPattern: 'LMH-LMH-LMH-LMH-LMH',
      secondaryType: null,
      ranked: [
        { code: 'CTRL', cn: '控制者', similarity: 88, exact: 10, distance: 3 }
      ],
      levels: { S1: 'L' },
      rawScores: { S1: 3 }
    },
    transcript: [
      {
        questionId: 'q1',
        question: '测试题目',
        choice: 'A',
        choiceSource: 'content',
        selectedValue: 1,
        selectedLabel: '选项一',
        rawResponse: 'A'
      }
    ]
  };
}

test('buildMarkdownReport includes summary and transcript', () => {
  const report = buildMarkdownReport(createPayload(), {
    model: 'demo-model',
    baseUrl: 'https://example.com/v1',
    generatedAt: '2026-04-10T00:00:00.000Z'
  });

  assert.match(report, /LLM SBTI 人格报告/);
  assert.match(report, /CTRL（控制者）/);
  assert.match(report, /解析来源: content/);
});

test('writeReportFiles writes markdown and json outputs', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'llm-sbti-report-'));
  const report = await writeReportFiles({
    payload: createPayload(),
    outputDir,
    metadata: {
      model: 'demo-model',
      baseUrl: 'https://example.com/v1'
    }
  });

  const markdown = await readFile(report.markdownPath, 'utf8');
  const json = JSON.parse(await readFile(report.jsonPath, 'utf8'));

  assert.match(markdown, /LLM SBTI 人格报告/);
  assert.equal(json.metadata.model, 'demo-model');
  assert.equal(json.transcript[0].choice, 'A');
});
