export const SYNTHETIC_DATASET_VERSION = '0.1.0';
export const DEFAULT_SYNTHETIC_SEED = 20260901;
export const DEFAULT_SYNTHETIC_EVENT_COUNT = 1440;
export const SYNTHETIC_RAW_COLUMNS = Object.freeze([
  'execution_id',
  'account_id',
  'workspace_id',
  'device_id',
  'actor_uid',
  'tool_id',
  'tool_version',
  'action',
  'status',
  'error_code',
  'duration_ms',
  'started_at',
  'completed_at',
  'received_at',
  'source',
  'host_version',
  'suite_version',
  'device_platform',
  'data_origin',
  'expected_anomaly',
  'synthetic_pattern',
]);

const MAX_DURATION_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const START_AT_MS = Date.UTC(2026, 5, 1, 0, 0, 0);

const CONTEXTS = Object.freeze([
  Object.freeze({ accountId: 'acct_demo_01', workspaceId: 'ws_prepress_a', deviceId: 'dev_win_01', actorUid: 'actor_demo_01', platform: 'windows', workloadFactor: 1.00 }),
  Object.freeze({ accountId: 'acct_demo_01', workspaceId: 'ws_prepress_b', deviceId: 'dev_win_02', actorUid: 'actor_demo_02', platform: 'windows', workloadFactor: 1.08 }),
  Object.freeze({ accountId: 'acct_demo_02', workspaceId: 'ws_finishing_a', deviceId: 'dev_mac_01', actorUid: 'actor_demo_03', platform: 'macos', workloadFactor: 0.96 }),
  Object.freeze({ accountId: 'acct_demo_03', workspaceId: 'ws_production_a', deviceId: 'dev_win_03', actorUid: 'actor_demo_04', platform: 'windows', workloadFactor: 1.14 }),
]);

const TOOLS = Object.freeze([
  Object.freeze({ id: 'clean-vector-pro', version: '3.6.0', action: 'CLEAN ART', meanDurationMs: 4200, spread: 0.22, weight: 0.46 }),
  Object.freeze({ id: 'sepmaker-pro', version: '1.6.0', action: 'Apply', meanDurationMs: 11200, spread: 0.20, weight: 0.54 }),
]);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNormal(random) {
  const first = Math.max(random(), Number.MIN_VALUE);
  const second = random();
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function chooseWeighted(random, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let remaining = random() * total;
  for (const entry of entries) {
    remaining -= entry.weight;
    if (remaining <= 0) return entry;
  }
  return entries.at(-1);
}

function choose(random, values) {
  return values[Math.floor(random() * values.length)];
}

function probability(random, threshold) {
  return random() < threshold;
}

function isoAt(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function outcomeFor(random, expectedAnomaly) {
  const value = random();
  if (expectedAnomaly) {
    if (value < 0.82) return 'success';
    if (value < 0.95) return 'failure';
    return 'cancelled';
  }
  if (value < 0.92) return 'success';
  if (value < 0.97) return 'failure';
  return 'cancelled';
}

function errorFor(status, random) {
  if (status === 'success') return '';
  if (status === 'cancelled') return 'ACTION_CANCELLED';
  return choose(random, [
    'DOCUMENT_UNAVAILABLE',
    'HOST_UNAVAILABLE',
    'PROCESSING_FAILED',
    'VALIDATION_FAILED',
  ]);
}

function workingTime(random, dayIndex) {
  const date = new Date(START_AT_MS + dayIndex * DAY_MS);
  const weekday = date.getUTCDay();
  const workday = weekday >= 1 && weekday <= 5;
  const hour = workday ? 8 + Math.floor(random() * 10) : 10 + Math.floor(random() * 6);
  const minute = Math.floor(random() * 60);
  const second = Math.floor(random() * 60);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, second);
}

/**
 * Generate operationally plausible, entirely synthetic telemetry.
 *
 * Most anomalies remain successful on purpose: this dataset verifies that the
 * future detector can surface an unusual duration without treating failures as
 * the sole definition of abnormality.
 */
export function generateSyntheticTelemetry({
  seed = DEFAULT_SYNTHETIC_SEED,
  eventCount = DEFAULT_SYNTHETIC_EVENT_COUNT,
} = {}) {
  if (!Number.isInteger(seed) || seed < 0) throw new Error('Synthetic seed must be a non-negative integer.');
  if (!Number.isInteger(eventCount) || eventCount < 90) throw new Error('Synthetic eventCount must be at least 90.');

  const random = seededRandom(seed);
  const rows = [];
  const eventsPerDay = Math.ceil(eventCount / 90);

  for (let index = 0; index < eventCount; index += 1) {
    const tool = chooseWeighted(random, TOOLS);
    const context = choose(random, CONTEXTS);
    const dayIndex = Math.floor(index / eventsPerDay);
    const expectedAnomaly = probability(random, 0.08);
    const baseline = tool.meanDurationMs * context.workloadFactor;
    let durationMs = baseline * Math.exp(randomNormal(random) * tool.spread);
    let syntheticPattern = 'normal';

    if (expectedAnomaly) {
      if (probability(random, 0.86)) {
        durationMs *= 2.8 + random() * 2.6;
        syntheticPattern = 'duration_spike';
      } else {
        durationMs *= 0.18 + random() * 0.18;
        syntheticPattern = 'duration_drop';
      }
    }

    durationMs = Math.min(MAX_DURATION_MS - 1, Math.max(1, Math.round(durationMs)));
    const completedAtMs = workingTime(random, dayIndex);
    const status = outcomeFor(random, expectedAnomaly);
    const receivedLagMs = 250 + Math.floor(random() * 1250);
    const rowNumber = index + 1;

    rows.push(Object.freeze({
      execution_id: `exec_syn_${pad(rowNumber, 6)}`,
      account_id: context.accountId,
      workspace_id: context.workspaceId,
      device_id: context.deviceId,
      actor_uid: context.actorUid,
      tool_id: tool.id,
      tool_version: tool.version,
      action: tool.action,
      status,
      error_code: errorFor(status, random),
      duration_ms: String(durationMs),
      started_at: isoAt(completedAtMs - durationMs),
      completed_at: isoAt(completedAtMs),
      received_at: isoAt(completedAtMs + receivedLagMs),
      source: 'local_bridge',
      host_version: context.platform === 'macos' ? 'Illustrator 29.0' : 'Illustrator 28.5',
      suite_version: 'Operation Suite 3.1',
      device_platform: context.platform,
      data_origin: 'SYNTHETIC',
      expected_anomaly: String(expectedAnomaly),
      synthetic_pattern: syntheticPattern,
    }));
  }

  return Object.freeze(rows);
}

export function buildSyntheticMetadata(rows, { seed = DEFAULT_SYNTHETIC_SEED } = {}) {
  const countBy = (field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))]
    .sort()
    .map((value) => [value, rows.filter((row) => row[field] === value).length]));
  const anomalies = rows.filter((row) => row.expected_anomaly === 'true');
  const completedAtValues = rows.map((row) => row.completed_at).sort();

  return Object.freeze({
    datasetVersion: SYNTHETIC_DATASET_VERSION,
    dataOrigin: 'SYNTHETIC',
    seed,
    generatedEventCount: rows.length,
    timeRange: Object.freeze({
      minCompletedAt: completedAtValues[0] || null,
      maxCompletedAt: completedAtValues.at(-1) || null,
    }),
    tools: countBy('tool_id'),
    workspaces: countBy('workspace_id'),
    statuses: countBy('status'),
    anomalies: Object.freeze({
      total: anomalies.length,
      successful: anomalies.filter((row) => row.status === 'success').length,
      patterns: Object.fromEntries([...new Set(anomalies.map((row) => row.synthetic_pattern))]
        .sort()
        .map((value) => [value, anomalies.filter((row) => row.synthetic_pattern === value).length])),
    }),
  });
}
