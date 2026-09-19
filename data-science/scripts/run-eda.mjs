import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCsv } from '../lib/csv.mjs';
import { countBy, describe, round } from '../lib/statistics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceFile = resolve(root, 'data-science', 'data', 'processed', 'operation-suite-intelligence-v0.1-clean.csv');
const reportDirectory = resolve(root, 'data-science', 'reports');
const reportFile = resolve(reportDirectory, 'eda-summary.json');
const markdownFile = resolve(reportDirectory, 'EDA_REPORT.md');
const rows = fromCsv(await readFile(sourceFile, 'utf8'));

function durationSummary(subset) {
  const values = subset.map((row) => Number(row.duration_seconds));
  return Object.fromEntries(Object.entries(describe(values)).map(([key, value]) => [key, round(value, 3)]));
}

const byTool = Object.fromEntries([...new Set(rows.map((row) => row.tool_id))].sort().map((toolId) => {
  const subset = rows.filter((row) => row.tool_id === toolId);
  return [toolId, Object.freeze({
    count: subset.length,
    durations: durationSummary(subset),
    statuses: countBy(subset, (row) => row.status),
    expectedAnomalies: subset.filter((row) => row.expected_anomaly === 'true').length,
  })];
}));

const report = Object.freeze({
  dataset: 'operation-suite-intelligence-v0.1-clean.csv',
  rows: rows.length,
  dataOrigins: countBy(rows, (row) => row.data_origin),
  tools: byTool,
  workspaces: countBy(rows, (row) => row.workspace_id),
  platforms: countBy(rows, (row) => row.device_platform),
  statuses: countBy(rows, (row) => row.status),
  expectedAnomalies: rows.filter((row) => row.expected_anomaly === 'true').length,
  durationSeconds: durationSummary(rows),
});

const tableRows = Object.entries(byTool).map(([tool, summary]) => `| ${tool} | ${summary.count} | ${summary.durations.median} | ${summary.durations.p95} | ${summary.expectedAnomalies} |`).join('\n');
const markdown = `# EDA Report — Operation Suite Intelligence v0.1\n\n`
  + `**Dataset:** synthetic, reproducible, ${report.rows} executions. No controlled real or production records are included.\n\n`
  + `## Summary\n\n`
  + `- Data origin: ${JSON.stringify(report.dataOrigins)}\n`
  + `- Statuses: ${JSON.stringify(report.statuses)}\n`
  + `- Platforms: ${JSON.stringify(report.platforms)}\n`
  + `- Expected synthetic anomalies: ${report.expectedAnomalies}\n\n`
  + `## Duration by tool\n\n| Tool | Runs | Median seconds | P95 seconds | Expected anomalies |\n| --- | ---: | ---: | ---: | ---: |\n${tableRows}\n\n`
  + `This report is an initial reproducible EDA summary. Visual plots and a Python notebook remain pending an authorized Python environment.\n`;

await mkdir(reportDirectory, { recursive: true });
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(markdownFile, markdown, 'utf8');
console.log(`EDA analyzed ${rows.length} events.`);
console.log(`Summary: ${reportFile}`);
console.log(`Report: ${markdownFile}`);
