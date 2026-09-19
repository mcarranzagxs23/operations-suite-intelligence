import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCsv } from '../lib/csv.mjs';
import { buildIntelligenceSummary } from '../lib/health-priority.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceFile = resolve(root, 'data-science', 'data', 'scored', 'operation-suite-intelligence-v0.1-scored.csv');
const outputDirectory = resolve(root, 'data-science', 'reports');
const outputFile = resolve(outputDirectory, 'intelligence-summary.json');
const summary = buildIntelligenceSummary(fromCsv(await readFile(sourceFile, 'utf8')));

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Built Intelligence summary for ${summary.workspaces.length} workspaces, ${summary.devices.length} devices and ${summary.tools.length} tools.`);
console.log(`Summary: ${outputFile}`);
