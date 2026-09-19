/**
 * Operations Suite usage and quota policy.
 *
 * This module answers one question for the Super Administrator: how close is
 * this deployment to the point where Firebase would start charging.
 *
 * It is a pure policy layer — no network, no Firestore, no clock reading
 * beyond what the caller passes in. `src/services/usage-metrics.js` gathers
 * the counts; this module decides what they mean.
 *
 * WHAT THIS IS NOT, AND THE DISTINCTION MATTERS
 * ---------------------------------------------
 * This is not a billing meter. It measures what the platform itself wrote,
 * and it estimates storage from those counts. The authoritative figures live
 * in Google Cloud Billing and in the Firebase usage dashboard, and only those
 * can produce an invoice.
 *
 * The estimate is therefore deliberately biased to over-report. A warning that
 * arrives early costs nothing; one that arrives late costs money.
 */

/**
 * Firebase no-cost quotas, as documented at the time of writing.
 *
 * These are configuration, not truth: Google changes pricing, and a number
 * hard-coded in an application is exactly the kind of thing that goes stale
 * without anyone noticing. `verifiedOn` is part of the value so the interface
 * can show how old the figures are, and the operator can confirm them against
 * the current Firebase pricing page.
 */
export const FREE_TIER = Object.freeze({
  verifiedOn: '2026-08-31',
  /** Total Firestore storage across the project. */
  storedBytes: 1024 * 1024 * 1024,
  /** Firestore document reads per day. */
  dailyReads: 50000,
  /** Firestore document writes per day. */
  dailyWrites: 20000,
  /** Firestore document deletes per day. */
  dailyDeletes: 20000,
  /** Cloud Functions invocations per month. */
  monthlyInvocations: 2000000,
  /** Firestore network egress per month. */
  monthlyEgressBytes: 10 * 1024 * 1024 * 1024,
});

/**
 * Average stored size per document, in bytes, per collection.
 *
 * Measured against the shapes this platform actually writes, then rounded up.
 * A telemetry event is small and fixed; an audit record carries a nested
 * before/after summary; a tool descriptor carries a version array.
 */
export const DOCUMENT_SIZE_ESTIMATES = Object.freeze({
  accounts: 320,
  users: 320,
  tools: 1200,
  workspaces: 320,
  members: 480,
  teams: 480,
  devices: 420,
  customRoles: 640,
  toolAssignments: 380,
  licenses: 400,
  telemetry: 560,
  telemetryDaily: 480,
  auditLogs: 720,
  platformAuditLogs: 620,
  accountMemberships: 320,
  operations: 400,
});

const DEFAULT_DOCUMENT_SIZE = 500;

/**
 * Firestore bills the document plus every index entry that points at it, and
 * for a document with several indexed fields the index side commonly exceeds
 * the document side. Multiplying by 2.5 keeps this estimate on the safe side
 * of that reality rather than reporting a comfortable number that turns out
 * to be half the truth.
 */
export const INDEX_OVERHEAD_FACTOR = 2.5;

export const USAGE_LEVELS = Object.freeze({
  OK: 'ok',
  WATCH: 'watch',
  WARNING: 'warning',
  OVER: 'over',
});

const WATCH_RATIO = 0.6;
const WARNING_RATIO = 0.85;

function isCount(value) {
  return Number.isFinite(value) && value >= 0;
}

export function estimateCollectionBytes(collectionName, count) {
  if (!isCount(count)) return 0;
  const perDocument = DOCUMENT_SIZE_ESTIMATES[collectionName] ?? DEFAULT_DOCUMENT_SIZE;
  return Math.round(count * perDocument * INDEX_OVERHEAD_FACTOR);
}

/**
 * Total estimated Firestore storage for a set of collection counts.
 *
 * An unknown collection is counted with the default size rather than skipped:
 * a collection this module has not heard of still occupies storage, and
 * ignoring it would under-report exactly when the model is most out of date.
 */
export function estimateStoredBytes(counts = {}) {
  return Object.entries(counts)
    .reduce((total, [name, count]) => total + estimateCollectionBytes(name, count), 0);
}

/**
 * Compare one measurement against its quota.
 *
 * `remaining` is clamped at zero: "you have -400 reads left" is a number, not
 * an explanation.
 */
export function evaluateQuota(used, limit) {
  if (!isCount(used) || !isCount(limit) || limit === 0) {
    return Object.freeze({ used: 0, limit: 0, remaining: 0, ratio: 0, level: USAGE_LEVELS.OK, known: false });
  }

  const ratio = used / limit;
  const level = ratio >= 1
    ? USAGE_LEVELS.OVER
    : ratio >= WARNING_RATIO
      ? USAGE_LEVELS.WARNING
      : ratio >= WATCH_RATIO
        ? USAGE_LEVELS.WATCH
        : USAGE_LEVELS.OK;

  return Object.freeze({
    used,
    limit,
    remaining: Math.max(0, limit - used),
    ratio,
    level,
    known: true,
  });
}

function metric(id, used, limit, unit) {
  return Object.freeze({ id, unit, ...evaluateQuota(used, limit) });
}

/**
 * Build the report the console renders.
 *
 * Storage is the only quota this platform can meaningfully approach on its
 * own: reads and writes reset every day, while stored documents accumulate
 * forever. The report therefore leads with storage and treats the daily
 * counters as context.
 */
export function buildUsageReport({
  counts = {},
  writesThisMonth = 0,
  executionsThisMonth = 0,
  daysElapsedInMonth = 1,
  quotas = FREE_TIER,
} = {}) {
  const storedBytes = estimateStoredBytes(counts);
  const totalDocuments = Object.values(counts)
    .filter(isCount)
    .reduce((total, count) => total + count, 0);

  const safeDays = Math.max(1, Math.round(daysElapsedInMonth));
  const writesPerDay = Math.round(writesThisMonth / safeDays);

  const collections = Object.freeze(
    Object.entries(counts)
      .filter(([, count]) => isCount(count))
      .map(([name, count]) => Object.freeze({
        name,
        count,
        estimatedBytes: estimateCollectionBytes(name, count),
      }))
      .sort((left, right) => right.estimatedBytes - left.estimatedBytes),
  );

  const metrics = Object.freeze([
    metric('storage', storedBytes, quotas.storedBytes, 'bytes'),
    metric('dailyWrites', writesPerDay, quotas.dailyWrites, 'documents'),
    metric('monthlyInvocations', writesThisMonth, quotas.monthlyInvocations, 'calls'),
  ]);

  const worstLevel = metrics.reduce((worst, entry) => {
    const order = [USAGE_LEVELS.OK, USAGE_LEVELS.WATCH, USAGE_LEVELS.WARNING, USAGE_LEVELS.OVER];
    return order.indexOf(entry.level) > order.indexOf(worst) ? entry.level : worst;
  }, USAGE_LEVELS.OK);

  return Object.freeze({
    metrics,
    collections,
    totalDocuments,
    storedBytes,
    executionsThisMonth,
    writesThisMonth,
    level: worstLevel,
    quotasVerifiedOn: quotas.verifiedOn || null,
    // Stated in the value itself, not only in the interface, so the caveat
    // cannot be lost by a screen that forgets to render it.
    estimate: true,
  });
}

export function formatBytes(bytes) {
  if (!isCount(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPercentage(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  if (ratio > 0 && ratio < 0.001) return '<0.1%';
  return `${(ratio * 100).toFixed(1)}%`;
}
