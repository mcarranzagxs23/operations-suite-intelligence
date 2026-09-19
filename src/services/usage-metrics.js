import { getFirebaseServices, isFirebaseConfigured } from './firebase.js';
import { buildUsageReport } from '../usage-quotas.js';

/**
 * Count what this deployment has actually stored.
 *
 * Counting uses Firestore aggregation queries (`getCountFromServer`) rather
 * than fetching documents. The difference matters here more than usual: a
 * feature whose purpose is to keep costs at zero must not itself be expensive.
 * An aggregation query is billed as a small number of reads regardless of how
 * many documents it counts, while listing the same collections would cost one
 * read per document — the panel would become the thing that pushed the project
 * past its free tier.
 *
 * It is still not free, which is why the console asks for it on demand instead
 * of running it on every page load.
 */

const ACCOUNT_COLLECTIONS = Object.freeze([
  'members',
  'teams',
  'workspaces',
  'customRoles',
  'devices',
  'licenses',
  'toolAssignments',
  'telemetry',
  'telemetryDaily',
  'auditLogs',
]);

const ROOT_COLLECTIONS = Object.freeze(['accounts', 'users', 'tools', 'platformAuditLogs']);

/**
 * A denied or unavailable count reports as unknown rather than as zero.
 *
 * Zero would be a lie with a specific and costly failure mode: it would say
 * "you are using nothing" at the exact moment the panel could not see.
 */
async function countSafely(getCountFromServer, reference) {
  try {
    const snapshot = await getCountFromServer(reference);
    return snapshot.data().count;
  } catch {
    return null;
  }
}

function daysElapsedInMonth(now) {
  return now.getUTCDate();
}

function currentMonthPrefix(now) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Measure storage and activity for the whole project.
 *
 * Only a Super Administrator can read the root collections, so for any other
 * role the root counts come back unknown and the report says so. That is the
 * correct outcome: a Manager has no business seeing the platform's total size.
 */
export async function measureUsage({ accountIds = [], now = new Date() } = {}) {
  if (!isFirebaseConfigured) return null;

  const services = await getFirebaseServices();
  if (!services) return null;

  const { db, firestoreApi } = services;
  const { collection, doc, getCountFromServer, getDocs, limit, orderBy, query, where } = firestoreApi;

  const counts = {};

  await Promise.all(ROOT_COLLECTIONS.map(async (name) => {
    counts[name] = await countSafely(getCountFromServer, collection(db, name));
  }));

  // Sub-collections are counted per account and summed, because Firestore
  // cannot aggregate across a collection group without an index the project
  // does not need for anything else.
  for (const accountId of accountIds) {
    const accountReference = doc(db, 'accounts', accountId);
    const results = await Promise.all(ACCOUNT_COLLECTIONS.map(async (name) => [
      name,
      await countSafely(getCountFromServer, collection(accountReference, name)),
    ]));

    for (const [name, value] of results) {
      if (value === null) continue;
      counts[name] = (counts[name] ?? 0) + value;
    }
  }

  const monthPrefix = currentMonthPrefix(now);
  let executionsThisMonth = 0;
  for (const accountId of accountIds) {
    const aggregates = await (async () => {
      try {
        const snapshot = await getDocs(query(
          collection(doc(db, 'accounts', accountId), 'telemetryDaily'),
          where('day', '>=', `${monthPrefix}-01`),
          orderBy('day', 'desc'),
          limit(62),
        ));
        return snapshot.docs;
      } catch {
        return [];
      }
    })();

    for (const snapshot of aggregates) {
      const total = snapshot.data()?.totalRuns;
      if (Number.isSafeInteger(total)) executionsThisMonth += total;
    }
  }

  const knownCounts = Object.fromEntries(
    Object.entries(counts).filter(([, value]) => Number.isFinite(value)),
  );
  const unavailable = Object.entries(counts)
    .filter(([, value]) => value === null)
    .map(([name]) => name);

  // Every stored execution corresponds to roughly three writes: the event, its
  // daily aggregate, and the station's last-seen stamp. Administrative changes
  // add a handful more. This is the same kind of estimate as the storage
  // figure and is labelled as one.
  const writesThisMonth = executionsThisMonth * 3;

  return Object.freeze({
    ...buildUsageReport({
      counts: knownCounts,
      writesThisMonth,
      executionsThisMonth,
      daysElapsedInMonth: daysElapsedInMonth(now),
    }),
    unavailable: Object.freeze(unavailable),
    measuredAt: now.toISOString(),
  });
}
