import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEtlFromCsv } from '../lib/dataset-etl.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceFile = resolve(root, 'data-science', 'data', 'synthetic', 'operation-suite-intelligence-v0.1.csv');
const outputDirectory = resolve(root, 'data-science', 'data', 'processed');
const outputFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1-clean.csv');
const reportFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1.quality.json');

const source = await readFile(sourceFile, 'utf8');
const result = runEtlFromCsv(source);

if (result.rejected.length > 0) {
  throw new Error(`ETL rejected ${result.rejected.length} input rows; inspect the source dataset before loading.`);
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, result.csv, 'utf8');
await writeFile(reportFile, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8');

console.log(`ETL accepted ${result.report.acceptedRows} events with ${result.report.rejectedRows} rejections.`);
console.log(`Dataset: ${outputFile}`);
console.log(`Quality report: ${reportFile}`);
