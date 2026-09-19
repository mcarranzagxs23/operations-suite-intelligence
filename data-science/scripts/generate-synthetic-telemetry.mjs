import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv } from '../lib/csv.mjs';
import {
  DEFAULT_SYNTHETIC_EVENT_COUNT,
  DEFAULT_SYNTHETIC_SEED,
  SYNTHETIC_RAW_COLUMNS,
  buildSyntheticMetadata,
  generateSyntheticTelemetry,
} from '../lib/synthetic-telemetry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputDirectory = resolve(root, 'data-science', 'data', 'synthetic');
const outputFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1.csv');
const metadataFile = resolve(outputDirectory, 'operation-suite-intelligence-v0.1.metadata.json');

const rows = generateSyntheticTelemetry({
  seed: DEFAULT_SYNTHETIC_SEED,
  eventCount: DEFAULT_SYNTHETIC_EVENT_COUNT,
});
const metadata = buildSyntheticMetadata(rows, { seed: DEFAULT_SYNTHETIC_SEED });

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, toCsv(rows, SYNTHETIC_RAW_COLUMNS), 'utf8');
await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

console.log(`Generated ${rows.length} synthetic execution events.`);
console.log(`Dataset: ${outputFile}`);
console.log(`Metadata: ${metadataFile}`);
