import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv, fromCsv } from '../lib/csv.mjs';
import { INITIAL_FEATURE_COLUMNS, scoreByTool } from '../lib/model-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceFile = resolve(root, 'data-science', 'data', 'processed', 'operation-suite-intelligence-v0.1-clean.csv');
const outputDirectory = resolve(root, 'data-science', 'data', 'scored');
const outputFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1-scored.csv');
const metricsFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1-model-metrics.json');
const rows = fromCsv(await readFile(sourceFile, 'utf8'));
const result = scoreByTool(rows);
const columns = [...Object.keys(result.rows[0]), 'model_id', 'anomaly_score', 'anomaly_threshold', 'is_anomaly', 'severity', 'baseline_mad_flag']
  .filter((column, index, values) => values.indexOf(column) === index);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, toCsv(result.rows, columns), 'utf8');
await writeFile(metricsFile, `${JSON.stringify({
  dataset: 'operation-suite-intelligence-v0.1-clean.csv',
  evaluationProtocol: 'chronological 70/30 split by tool/action',
  featureColumns: INITIAL_FEATURE_COLUMNS,
  candidateContextFeatures: ['hour_sin', 'hour_cos', 'day_sin', 'day_cos', 'device_platform', 'tool_version'],
  excludedFeatures: ['status', 'error_code', 'account_id', 'workspace_id', 'device_id', 'actor_uid'],
  models: result.models,
}, null, 2)}\n`, 'utf8');

console.log(`Scored ${result.rows.length} held-out events across ${result.models.length} models.`);
console.log(`Scores: ${outputFile}`);
console.log(`Metrics: ${metricsFile}`);
