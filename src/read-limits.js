/**
 * How much the console is allowed to read, and how it admits when it stopped.
 *
 * Every Firestore query behind the platform carries a limit. That is what
 * keeps opening one screen from becoming thousands of billable document
 * reads on a busy account — the same concern the usage panel exists for.
 *
 * The cost of a bounded read is that a complete result and a truncated one
 * look identical from the outside. An administrator reading an audit table
 * that silently stops at the hundred and fiftieth entry believes they have
 * seen the whole history, and that is a worse failure than an awkward notice.
 *
 * This module is pure on purpose. It carries no Firebase import, so the limits
 * and the truncation rule can be tested without a browser, an emulator or a
 * project configuration.
 */

const MAX_EXECUTIONS = 200;
const MAX_AGGREGATES = 120;
const MAX_AUDIT_ENTRIES = 150;
const MAX_COLLECTION = 400;

export const READ_LIMITS = Object.freeze({
  accounts: MAX_COLLECTION,
  users: MAX_COLLECTION,
  tools: MAX_COLLECTION,
  workspaces: MAX_COLLECTION,
  members: MAX_COLLECTION,
  teams: MAX_COLLECTION,
  devices: MAX_COLLECTION,
  customRoles: MAX_COLLECTION,
  assignments: MAX_COLLECTION,
  licenses: MAX_COLLECTION,
  executions: MAX_EXECUTIONS,
  dailyAggregates: MAX_AGGREGATES,
  auditLogs: MAX_AUDIT_ENTRIES,
  platformAuditLogs: MAX_AUDIT_ENTRIES,
});

export { MAX_AGGREGATES, MAX_AUDIT_ENTRIES, MAX_COLLECTION, MAX_EXECUTIONS };

/**
 * Name the reads that came back exactly full.
 *
 * A bounded query cannot distinguish "these are all the records" from "these
 * are the first N of more", so this reports the only fact that is actually
 * known: the read reached its limit. The interface says so in those words
 * rather than claiming records were hidden — a collection holding exactly N
 * documents is complete, and calling that truncated would be its own lie.
 *
 * A count that is missing, negative or not a whole number is not treated as a
 * limit hit. An unknown count is unknown, and a warning invented from one
 * would teach an operator to ignore the notice.
 */
export function collectTruncation(counts, limits = READ_LIMITS) {
  const source = counts && typeof counts === 'object' ? counts : {};

  return Object.freeze(Object.keys(limits)
    .filter((name) => Number.isSafeInteger(source[name]) && source[name] >= limits[name])
    .sort());
}
