/**
 * Operations Suite execution telemetry contract — `ExecutionEvent V1`.
 *
 * This is the only shape that may be persisted as production telemetry. It is
 * a pure contract: no network, no Firestore, no storage, no clock reading. The
 * browser validates a candidate before it is sent, and the callable backend
 * validates it again before it is written, using this same module.
 *
 * The privacy position it encodes, and the reason each rule exists:
 *
 *   - every identifier is opaque and server-known (`accountId`, `workspaceId`,
 *     `deviceId`, `toolId`). No display name, email address, machine name, or
 *     user-typed text is accepted;
 *   - no field may carry a filesystem path, a document name, artwork, colour
 *     separation data, or workspace configuration. The allow-list of keys is
 *     closed, so a future caller cannot add one by mistake;
 *   - `errorCode` is a closed enum rather than a message, so a host error
 *     string can never smuggle a path or a document name into telemetry;
 *   - durations are bounded, so a malformed record cannot distort an
 *     aggregate.
 *
 * `executionId` doubles as the idempotency key. A workstation that retries a
 * delivery produces the same identifier, and the backend transaction keeps the
 * first write rather than counting the run twice.
 */

export const EXECUTION_EVENT_SCHEMA_VERSION = 1;

export const EXECUTION_STATUSES = Object.freeze(['success', 'failure', 'cancelled']);

/**
 * Closed error vocabulary shared with the local connector contract.
 *
 * Keeping the two lists identical means a result produced in Illustrator can
 * be persisted without translation, and no new code is needed at the boundary
 * to decide what an unknown code means.
 */
export const EXECUTION_ERROR_CODES = Object.freeze([
  'ACTION_CANCELLED',
  'DOCUMENT_UNAVAILABLE',
  'HOST_UNAVAILABLE',
  'PROCESSING_FAILED',
  'VALIDATION_FAILED',
]);

export const EXECUTION_SOURCES = Object.freeze(['local_bridge', 'web_manual']);

/** Twelve hours. A single Illustrator action cannot legitimately exceed this. */
export const MAX_EXECUTION_DURATION_MS = 12 * 60 * 60 * 1000;

const REQUIRED_KEYS = Object.freeze([
  'executionId',
  'accountId',
  'workspaceId',
  'deviceId',
  'toolId',
  'toolVersion',
  'action',
  'status',
  'startedAt',
  'completedAt',
  'durationMs',
  'source',
]);

const OPTIONAL_KEYS = Object.freeze(['errorCode', 'hostVersion', 'suiteVersion']);

const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{2,48}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ACTION_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
const HOST_VERSION_PATTERN = /^[A-Za-z0-9 .()-]{1,32}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInstant(value) {
  return typeof value === 'string'
    && ISO_INSTANT_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

/**
 * Validate a candidate execution event.
 *
 * Returns `{ valid, issues }` instead of throwing so the workstation, the web
 * client, and the callable backend can all report the same issue list rather
 * than inventing three different messages for the same rejection.
 */
export function validateExecutionEvent(candidate) {
  const issues = [];

  if (!isPlainObject(candidate)) {
    return { valid: false, issues: ['execution.invalid'] };
  }

  if (Object.keys(candidate).some((key) => !ALLOWED_KEYS.has(key))) {
    issues.push('execution.unexpectedField');
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in candidate)) issues.push('execution.missingField');
  }

  if (typeof candidate.executionId !== 'string' || !OPAQUE_ID_PATTERN.test(candidate.executionId)) {
    issues.push('execution.invalidExecutionId');
  }
  for (const key of ['accountId', 'workspaceId', 'deviceId']) {
    if (typeof candidate[key] !== 'string' || !OPAQUE_ID_PATTERN.test(candidate[key])) {
      issues.push('execution.invalidScope');
    }
  }
  if (typeof candidate.toolId !== 'string' || !TOOL_ID_PATTERN.test(candidate.toolId)) {
    issues.push('execution.invalidToolId');
  }
  if (typeof candidate.toolVersion !== 'string' || !SEMVER_PATTERN.test(candidate.toolVersion)) {
    issues.push('execution.invalidToolVersion');
  }
  if (typeof candidate.action !== 'string' || !ACTION_PATTERN.test(candidate.action)) {
    issues.push('execution.invalidAction');
  }
  if (!EXECUTION_STATUSES.includes(candidate.status)) {
    issues.push('execution.invalidStatus');
  }
  if (!EXECUTION_SOURCES.includes(candidate.source)) {
    issues.push('execution.invalidSource');
  }
  if (!isInstant(candidate.startedAt)) issues.push('execution.invalidStartedAt');
  if (!isInstant(candidate.completedAt)) issues.push('execution.invalidCompletedAt');

  if (!Number.isSafeInteger(candidate.durationMs)
    || candidate.durationMs < 0
    || candidate.durationMs > MAX_EXECUTION_DURATION_MS) {
    issues.push('execution.invalidDuration');
  }

  if (isInstant(candidate.startedAt) && isInstant(candidate.completedAt)
    && Date.parse(candidate.completedAt) < Date.parse(candidate.startedAt)) {
    issues.push('execution.completedBeforeStarted');
  }

  // A failure without a code would leave an operator with a red row and no
  // explanation, and a code on a success would misreport a healthy run.
  if (candidate.status === 'failure' || candidate.status === 'cancelled') {
    if (!EXECUTION_ERROR_CODES.includes(candidate.errorCode)) {
      issues.push('execution.invalidErrorCode');
    }
  } else if (candidate.errorCode !== undefined) {
    issues.push('execution.errorCodeNotAllowed');
  }

  if (candidate.hostVersion !== undefined
    && (typeof candidate.hostVersion !== 'string' || !HOST_VERSION_PATTERN.test(candidate.hostVersion))) {
    issues.push('execution.invalidHostVersion');
  }
  if (candidate.suiteVersion !== undefined
    && (typeof candidate.suiteVersion !== 'string' || !HOST_VERSION_PATTERN.test(candidate.suiteVersion))) {
    issues.push('execution.invalidSuiteVersion');
  }

  return { valid: issues.length === 0, issues: Array.from(new Set(issues)) };
}

/**
 * The UTC day an event belongs to, used as the aggregate document id.
 *
 * Aggregation is keyed on UTC rather than a station's local zone so two
 * workstations in different time zones cannot write the same run into two
 * different daily buckets.
 */
export function executionDayId(completedAt) {
  if (!isInstant(completedAt)) return null;
  return completedAt.slice(0, 10);
}

/**
 * Fold one validated event into a daily aggregate.
 *
 * Aggregates are maintained incrementally on the server precisely because the
 * alternative — counting events in the browser — stops working at the scale
 * this platform is meant to reach, and would require every reader to hold read
 * access to every individual run.
 */
export function applyExecutionToAggregate(aggregate, event) {
  const base = isPlainObject(aggregate) ? aggregate : {};
  const totalRuns = Number.isSafeInteger(base.totalRuns) ? base.totalRuns : 0;
  const successfulRuns = Number.isSafeInteger(base.successfulRuns) ? base.successfulRuns : 0;
  const failedRuns = Number.isSafeInteger(base.failedRuns) ? base.failedRuns : 0;
  const cancelledRuns = Number.isSafeInteger(base.cancelledRuns) ? base.cancelledRuns : 0;
  const totalDurationMs = Number.isSafeInteger(base.totalDurationMs) ? base.totalDurationMs : 0;
  const byTool = isPlainObject(base.byTool) ? { ...base.byTool } : {};

  byTool[event.toolId] = (Number.isSafeInteger(byTool[event.toolId]) ? byTool[event.toolId] : 0) + 1;

  return Object.freeze({
    schemaVersion: EXECUTION_EVENT_SCHEMA_VERSION,
    day: executionDayId(event.completedAt),
    workspaceId: event.workspaceId,
    totalRuns: totalRuns + 1,
    successfulRuns: successfulRuns + (event.status === 'success' ? 1 : 0),
    failedRuns: failedRuns + (event.status === 'failure' ? 1 : 0),
    cancelledRuns: cancelledRuns + (event.status === 'cancelled' ? 1 : 0),
    totalDurationMs: totalDurationMs + event.durationMs,
    byTool: Object.freeze(byTool),
  });
}
