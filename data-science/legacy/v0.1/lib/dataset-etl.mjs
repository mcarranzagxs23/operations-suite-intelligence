import { fromCsv, toCsv } from './csv.mjs';
import { SYNTHETIC_RAW_COLUMNS } from './synthetic-telemetry.mjs';

export const MAX_EXECUTION_DURATION_MS = 12 * 60 * 60 * 1000;
export const ANALYTIC_COLUMNS = Object.freeze([
  ...SYNTHETIC_RAW_COLUMNS,
  'duration_seconds',
  'log_duration',
  'hour_of_day',
  'day_of_week',
  'hour_sin',
  'hour_cos',
  'day_sin',
  'day_cos',
]);

const STATUS_VALUES = new Set(['success', 'failure', 'cancelled']);
const ERROR_VALUES = new Set([
  '',
  'ACTION_CANCELLED',
  'DOCUMENT_UNAVAILABLE',
  'HOST_UNAVAILABLE',
  'PROCESSING_FAILED',
  'VALIDATION_FAILED',
]);
const TOOL_ACTIONS = new Map([
  ['clean-vector-pro', 'CLEAN ART'],
  ['sepmaker-pro', 'Apply'],
]);
const PLATFORM_VALUES = new Set(['windows', 'macos']);
const ORIGIN_VALUES = new Set(['REAL_CONTROLLED', 'SYNTHETIC']);
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function issue(field, code) {
  return `${field}.${code}`;
}

function asInteger(value) {
  if (!/^-?\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validTimestamp(value) {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function fixed(value, decimals = 6) {
  return Number(value).toFixed(decimals);
}

export function validateRawRecord(row) {
  const issues = [];
  if (!row || typeof row !== 'object') return Object.freeze({ valid: false, issues: Object.freeze(['record.invalid']) });

  for (const column of SYNTHETIC_RAW_COLUMNS) {
    if (!(column in row)) issues.push(issue(column, 'missing'));
  }
  if (Object.keys(row).some((key) => !SYNTHETIC_RAW_COLUMNS.includes(key))) issues.push('record.unexpected_field');
  for (const field of ['execution_id', 'account_id', 'workspace_id', 'device_id', 'actor_uid', 'tool_version', 'source']) {
    if (typeof row[field] !== 'string' || row[field].trim() === '') issues.push(issue(field, 'invalid'));
  }
  if (!TOOL_ACTIONS.has(row.tool_id)) issues.push(issue('tool_id', 'unknown'));
  else if (TOOL_ACTIONS.get(row.tool_id) !== row.action) issues.push(issue('action', 'invalid_for_tool'));
  if (!STATUS_VALUES.has(row.status)) issues.push(issue('status', 'invalid'));
  if (!ERROR_VALUES.has(row.error_code)) issues.push(issue('error_code', 'invalid'));
  if (row.status === 'success' && row.error_code !== '') issues.push(issue('error_code', 'not_allowed_for_success'));
  if ((row.status === 'failure' || row.status === 'cancelled') && row.error_code === '') issues.push(issue('error_code', 'required_for_non_success'));
  if (!PLATFORM_VALUES.has(row.device_platform)) issues.push(issue('device_platform', 'invalid'));
  if (!ORIGIN_VALUES.has(row.data_origin)) issues.push(issue('data_origin', 'invalid'));
  if (!['true', 'false'].includes(row.expected_anomaly)) issues.push(issue('expected_anomaly', 'invalid'));
  if (row.data_origin === 'REAL_CONTROLLED' && row.expected_anomaly !== 'false') issues.push(issue('expected_anomaly', 'not_allowed_for_real_controlled'));

  const durationMs = asInteger(row.duration_ms);
  if (durationMs === null || durationMs <= 0 || durationMs > MAX_EXECUTION_DURATION_MS) issues.push(issue('duration_ms', 'invalid'));
  for (const field of ['started_at', 'completed_at', 'received_at']) {
    if (!validTimestamp(row[field])) issues.push(issue(field, 'invalid'));
  }
  if (validTimestamp(row.started_at) && validTimestamp(row.completed_at)
    && Date.parse(row.completed_at) < Date.parse(row.started_at)) {
    issues.push(issue('completed_at', 'before_started_at'));
  }

  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function transformRawRecord(row) {
  const validation = validateRawRecord(row);
  if (!validation.valid) throw new Error(`Invalid telemetry record: ${validation.issues.join(', ')}`);

  const durationMs = Number(row.duration_ms);
  const completedAt = new Date(row.completed_at);
  const hour = completedAt.getUTCHours();
  const day = completedAt.getUTCDay();
  const normalized = {
    ...row,
    duration_ms: String(durationMs),
    duration_seconds: fixed(durationMs / 1000, 3),
    log_duration: fixed(Math.log1p(durationMs)),
    hour_of_day: String(hour),
    day_of_week: String(day),
    hour_sin: fixed(Math.sin((2 * Math.PI * hour) / 24)),
    hour_cos: fixed(Math.cos((2 * Math.PI * hour) / 24)),
    day_sin: fixed(Math.sin((2 * Math.PI * day) / 7)),
    day_cos: fixed(Math.cos((2 * Math.PI * day) / 7)),
  };
  return Object.freeze(normalized);
}

export function transformRecords(rows) {
  const uniqueIds = new Set();
  const transformed = [];
  const rejected = [];

  for (const [index, row] of rows.entries()) {
    const validation = validateRawRecord(row);
    if (!validation.valid) {
      rejected.push(Object.freeze({ row: index + 2, execution_id: row?.execution_id || '', issues: validation.issues }));
      continue;
    }
    if (uniqueIds.has(row.execution_id)) {
      rejected.push(Object.freeze({ row: index + 2, execution_id: row.execution_id, issues: Object.freeze(['execution_id.duplicate']) }));
      continue;
    }
    uniqueIds.add(row.execution_id);
    transformed.push(transformRawRecord(row));
  }

  return Object.freeze({ transformed: Object.freeze(transformed), rejected: Object.freeze(rejected) });
}

export function buildDataQualityReport({ transformed, rejected }) {
  const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))]
    .sort()
    .map((value) => [value, rows.filter((row) => row[field] === value).length]));
  const issueCounts = {};
  for (const row of rejected) {
    for (const issueName of row.issues) issueCounts[issueName] = (issueCounts[issueName] || 0) + 1;
  }
  return Object.freeze({
    inputRows: transformed.length + rejected.length,
    acceptedRows: transformed.length,
    rejectedRows: rejected.length,
    dataOrigins: countBy(transformed, 'data_origin'),
    tools: countBy(transformed, 'tool_id'),
    statuses: countBy(transformed, 'status'),
    expectedAnomalies: transformed.filter((row) => row.expected_anomaly === 'true').length,
    rejectionReasons: Object.freeze(issueCounts),
  });
}

export function runEtlFromCsv(csvText) {
  const rows = fromCsv(csvText);
  const result = transformRecords(rows);
  return Object.freeze({
    ...result,
    csv: toCsv(result.transformed, ANALYTIC_COLUMNS),
    report: buildDataQualityReport(result),
  });
}
