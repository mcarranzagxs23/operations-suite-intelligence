import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../legacy/v0.1/lib/csv.mjs';
import { ANALYTIC_COLUMNS, runEtlFromCsv, transformRawRecord, validateRawRecord } from '../legacy/v0.1/lib/dataset-etl.mjs';
import { scoreByTool } from '../legacy/v0.1/lib/model-analysis.mjs';
import { buildIntelligenceSummary } from '../legacy/v0.1/lib/health-priority.mjs';
import {
  SYNTHETIC_RAW_COLUMNS,
  buildSyntheticMetadata,
  generateSyntheticTelemetry,
} from '../legacy/v0.1/lib/synthetic-telemetry.mjs';

test('synthetic telemetry is deterministic, private and mostly successful even when anomalous', () => {
  const first = generateSyntheticTelemetry({ seed: 71, eventCount: 180 });
  const second = generateSyntheticTelemetry({ seed: 71, eventCount: 180 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 180);
  assert.ok(first.every((row) => row.data_origin === 'SYNTHETIC'));
  assert.ok(first.every((row) => !Object.keys(row).some((key) => /file|path|email|mac|secret/i.test(key))));

  const anomalies = first.filter((row) => row.expected_anomaly === 'true');
  assert.ok(anomalies.length > 0);
  assert.ok(anomalies.filter((row) => row.status === 'success').length / anomalies.length >= 0.6);
});

test('ETL derives analytical features without retaining invalid records', () => {
  const rows = generateSyntheticTelemetry({ seed: 91, eventCount: 180 });
  const result = runEtlFromCsv(toCsv(rows, SYNTHETIC_RAW_COLUMNS));

  assert.equal(result.report.inputRows, 180);
  assert.equal(result.report.acceptedRows, 180);
  assert.equal(result.report.rejectedRows, 0);
  assert.equal(result.transformed.length, 180);
  assert.deepEqual(Object.keys(result.transformed[0]), ANALYTIC_COLUMNS);
  assert.match(result.transformed[0].log_duration, /^\d+\.\d{6}$/);
  assert.ok(Number(result.transformed[0].hour_sin) <= 1);
  assert.ok(Number(result.transformed[0].hour_sin) >= -1);
});

test('validation separates a broken record from a valid operational outlier', () => {
  const [sample] = generateSyntheticTelemetry({ seed: 11, eventCount: 90 });
  const longButValid = { ...sample, duration_ms: String(42 * 1000), expected_anomaly: 'true', synthetic_pattern: 'duration_spike' };
  const invalid = { ...sample, duration_ms: '0' };

  assert.equal(validateRawRecord(longButValid).valid, true);
  assert.equal(transformRawRecord(longButValid).duration_seconds, '42.000');
  assert.equal(validateRawRecord(invalid).valid, false);
  assert.ok(validateRawRecord(invalid).issues.includes('duration_ms.invalid'));
});

test('metadata and CSV artifacts are inspectable without any external service', async () => {
  const rows = generateSyntheticTelemetry({ seed: 42, eventCount: 90 });
  const metadata = buildSyntheticMetadata(rows, { seed: 42 });
  const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(join(projectDirectory, '.test-temp-'));
  const file = join(directory, 'synthetic.csv');

  try {
    await writeFile(file, toCsv(rows, SYNTHETIC_RAW_COLUMNS), 'utf8');
    const reloaded = await readFile(file, 'utf8');
    const result = runEtlFromCsv(reloaded);
    assert.equal(metadata.generatedEventCount, 90);
    assert.equal(result.report.expectedAnomalies, metadata.anomalies.total);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Isolation Forest scores held-out synthetic anomalies without using status or opaque identities', () => {
  const raw = generateSyntheticTelemetry({ seed: 2026, eventCount: 360 });
  const prepared = runEtlFromCsv(toCsv(raw, SYNTHETIC_RAW_COLUMNS));
  const result = scoreByTool(prepared.transformed, { minimumGroupSize: 90, seed: 2026 });

  assert.equal(result.models.length, 2);
  assert.ok(result.rows.length > 0);
  assert.ok(result.models.every((model) => model.metrics.recall > 0));
  assert.ok(result.rows.some((row) => row.expected_anomaly === 'true' && row.status === 'success' && row.is_anomaly === 'true'));
});

test('health and priority are deterministic, grouped and explainable', () => {
  const raw = generateSyntheticTelemetry({ seed: 765, eventCount: 360 });
  const prepared = runEtlFromCsv(toCsv(raw, SYNTHETIC_RAW_COLUMNS));
  const scoring = scoreByTool(prepared.transformed, { minimumGroupSize: 90, seed: 765 });
  const summary = buildIntelligenceSummary(scoring.rows, { minimumRuns: 20 });

  assert.equal(summary.workspaces.length, 4);
  assert.equal(summary.devices.length, 4);
  assert.equal(summary.tools.length, 2);
  assert.ok(summary.global.healthScore >= 0 && summary.global.healthScore <= 100);
  assert.ok(summary.workspaces.every((workspace) => workspace.reasons.length > 0));
  assert.deepEqual(summary.workspaces.map((workspace) => workspace.priorityRank), [1, 2, 3, 4]);
  assert.ok(summary.workspaces.every((workspace) => !('rows' in workspace)));
});
