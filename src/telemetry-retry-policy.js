/**
 * How many times a finished Illustrator run may be offered to the backend.
 *
 * The browser learns about a run by polling the local bridge every two and a
 * half seconds, and the bridge keeps serving the same result until a new one
 * replaces it. So a write that fails is not asked for once — it is asked for
 * again on the next tick, and the tick after that, for as long as the tab is
 * open. Against a transient failure that is exactly right. Against a failure
 * that does not clear on its own — a rejected attestation, a revoked tool
 * assignment, a sign-in that aged past the backend's freshness window — it is
 * roughly fourteen hundred calls an hour to a billed endpoint, produced by an
 * operator who has walked away from the screen.
 *
 * The rule is therefore a fixed, small number of attempts per result, counted
 * before the call rather than after it, so a request that never settles still
 * consumes its attempt. Giving up is visible: the console keeps the failure
 * notice rather than pretending the run was recorded.
 *
 * Nothing is lost by stopping. The backend stores the event under the
 * execution id the bridge already assigned, so the write is idempotent and a
 * later successful attempt from a reloaded page records it exactly once.
 *
 * This module is pure on purpose. It carries no React, Firebase or browser
 * import, so the ceiling that protects the bill can be tested directly.
 */

export const MAX_EXECUTION_RECORD_ATTEMPTS = 3;

/**
 * Decide whether one more attempt is allowed for a given result.
 *
 * An unusable attempt count is treated as exhausted rather than as zero. The
 * safe reading of "I cannot tell how many times this was already sent" is not
 * "so send it again" — that is the reading that produces the loop this module
 * exists to prevent.
 */
export function mayAttemptRecord(attempts, limit = MAX_EXECUTION_RECORD_ATTEMPTS) {
  if (!Number.isSafeInteger(attempts) || attempts < 0) return false;
  return attempts < limit;
}

/**
 * The attempt count to store before making the call.
 *
 * A success jumps straight to the ceiling instead of adding one, so the poll
 * stops offering a result that is already persisted, whatever the count was.
 */
export function nextAttemptCount(attempts, { succeeded = false, limit = MAX_EXECUTION_RECORD_ATTEMPTS } = {}) {
  if (succeeded) return limit;
  if (!Number.isSafeInteger(attempts) || attempts < 0) return limit;
  return Math.min(attempts + 1, limit);
}
