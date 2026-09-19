/**
 * Operations Suite tool authorization resolver.
 *
 * This module answers one question: which tools may a specific person, on a
 * specific workstation, actually see and run right now.
 *
 * It is the single place where four independent decisions are combined:
 *
 *   1. the registry     — does the tool exist, is it active, is a version published;
 *   2. the assignment   — has an administrator granted it to this actor;
 *   3. the license      — is that grant currently in force;
 *   4. the device       — is this workstation approved.
 *
 * All four must pass. Each failure produces a stable reason code so the
 * interface can explain an absence honestly instead of silently hiding a tool.
 *
 * The module is pure. It performs no network, storage, or Firestore access,
 * and it receives the current time explicitly rather than reading the clock,
 * so a caller can evaluate any moment deterministically and tests do not
 * depend on wall-clock timing.
 */

import { resolvePublishedVersion } from './tool-registry-contract.js';

export const DEVICE_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
});

export const LICENSE_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

/**
 * Assignment target kinds, ordered by specificity.
 *
 * A more specific assignment overrides a broader one. The ordering runs from
 * the broadest audience to the most precise individual: a platform-wide grant
 * is the weakest statement an administrator can make, and naming one user is
 * the strongest. `role` sits above `global` but below `account` because it
 * describes a category of people rather than a particular organization.
 */
export const ASSIGNMENT_TARGETS = Object.freeze({
  GLOBAL: 'global',
  ROLE: 'role',
  ACCOUNT: 'account',
  WORKSPACE: 'workspace',
  TEAM: 'team',
  USER: 'user',
});

const TARGET_SPECIFICITY = Object.freeze({
  [ASSIGNMENT_TARGETS.GLOBAL]: 1,
  [ASSIGNMENT_TARGETS.ROLE]: 2,
  [ASSIGNMENT_TARGETS.ACCOUNT]: 3,
  [ASSIGNMENT_TARGETS.WORKSPACE]: 4,
  [ASSIGNMENT_TARGETS.TEAM]: 5,
  [ASSIGNMENT_TARGETS.USER]: 6,
});

export const ASSIGNMENT_EFFECTS = Object.freeze({
  GRANT: 'grant',
  DENY: 'deny',
});

export const DENIAL_REASONS = Object.freeze({
  TOOL_UNKNOWN: 'tool.unknown',
  TOOL_DISABLED: 'tool.disabled',
  TOOL_NO_PUBLISHED_VERSION: 'tool.noPublishedVersion',
  NOT_ASSIGNED: 'assignment.none',
  ASSIGNMENT_DENIED: 'assignment.denied',
  LICENSE_MISSING: 'license.missing',
  LICENSE_NOT_STARTED: 'license.notStarted',
  LICENSE_EXPIRED: 'license.expired',
  LICENSE_SUSPENDED: 'license.suspended',
  LICENSE_REVOKED: 'license.revoked',
  DEVICE_PENDING: 'device.pending',
  DEVICE_SUSPENDED: 'device.suspended',
  DEVICE_REVOKED: 'device.revoked',
  DEVICE_UNKNOWN: 'device.unknown',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseInstant(value) {
  if (value === undefined || value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Evaluate the workstation itself.
 *
 * The device gate is deliberately evaluated once for the whole catalog rather
 * than per tool: an unapproved workstation is not a per-tool condition, it is
 * a reason the workstation receives nothing at all.
 */
export function evaluateDevice(device) {
  if (!isPlainObject(device) || typeof device.status !== 'string') {
    return { authorized: false, reason: DENIAL_REASONS.DEVICE_UNKNOWN };
  }

  switch (device.status) {
    case DEVICE_STATUSES.APPROVED:
      return { authorized: true, reason: null };
    case DEVICE_STATUSES.PENDING:
      return { authorized: false, reason: DENIAL_REASONS.DEVICE_PENDING };
    case DEVICE_STATUSES.SUSPENDED:
      return { authorized: false, reason: DENIAL_REASONS.DEVICE_SUSPENDED };
    case DEVICE_STATUSES.REVOKED:
      return { authorized: false, reason: DENIAL_REASONS.DEVICE_REVOKED };
    default:
      return { authorized: false, reason: DENIAL_REASONS.DEVICE_UNKNOWN };
  }
}

/**
 * Evaluate a license at an explicit instant.
 *
 * Status and validity window are checked independently: a license row marked
 * `active` whose window has passed is still expired. Trusting the stored
 * status alone would keep a lapsed license working until some batch job got
 * around to rewriting it.
 */
export function evaluateLicense(license, nowMs) {
  if (!isPlainObject(license)) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_MISSING };
  }

  if (license.status === LICENSE_STATUSES.REVOKED) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_REVOKED };
  }
  if (license.status === LICENSE_STATUSES.SUSPENDED) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_SUSPENDED };
  }
  if (license.status === LICENSE_STATUSES.EXPIRED) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_EXPIRED };
  }
  if (license.status !== LICENSE_STATUSES.ACTIVE) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_MISSING };
  }

  const startsAt = parseInstant(license.startsAt);
  const expiresAt = parseInstant(license.expiresAt);

  if (startsAt !== null && nowMs < startsAt) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_NOT_STARTED };
  }
  if (expiresAt !== null && nowMs >= expiresAt) {
    return { authorized: false, reason: DENIAL_REASONS.LICENSE_EXPIRED };
  }

  return { authorized: true, reason: null };
}

function assignmentApplies(assignment, actor) {
  switch (assignment.target) {
    case ASSIGNMENT_TARGETS.GLOBAL:
      return true;
    case ASSIGNMENT_TARGETS.ROLE:
      return assignment.targetId === actor.role;
    case ASSIGNMENT_TARGETS.ACCOUNT:
      return assignment.targetId === actor.accountId;
    case ASSIGNMENT_TARGETS.WORKSPACE:
      return assignment.targetId === actor.workspaceId;
    case ASSIGNMENT_TARGETS.TEAM:
      return Array.isArray(actor.teamIds) && actor.teamIds.includes(assignment.targetId);
    case ASSIGNMENT_TARGETS.USER:
      return assignment.targetId === actor.userId;
    default:
      return false;
  }
}

/**
 * Resolve the winning assignment for one tool.
 *
 * The most specific applicable assignment wins. When two assignments tie at
 * the same specificity, a deny beats a grant: contradictory administrative
 * input resolves to the safer outcome rather than to whichever row was written
 * last.
 */
export function resolveAssignment(assignments, actor, toolId) {
  const applicable = (Array.isArray(assignments) ? assignments : [])
    .filter((assignment) => (
      isPlainObject(assignment)
      && assignment.toolId === toolId
      && Object.hasOwn(TARGET_SPECIFICITY, assignment.target)
      && (assignment.effect === ASSIGNMENT_EFFECTS.GRANT || assignment.effect === ASSIGNMENT_EFFECTS.DENY)
      && assignmentApplies(assignment, actor)
    ));

  if (applicable.length === 0) {
    return { effect: null, reason: DENIAL_REASONS.NOT_ASSIGNED, source: null };
  }

  let winner = applicable[0];
  for (const candidate of applicable.slice(1)) {
    const candidateRank = TARGET_SPECIFICITY[candidate.target];
    const winnerRank = TARGET_SPECIFICITY[winner.target];

    if (candidateRank > winnerRank) {
      winner = candidate;
    } else if (candidateRank === winnerRank
      && candidate.effect === ASSIGNMENT_EFFECTS.DENY
      && winner.effect === ASSIGNMENT_EFFECTS.GRANT) {
      winner = candidate;
    }
  }

  return {
    effect: winner.effect,
    reason: winner.effect === ASSIGNMENT_EFFECTS.DENY ? DENIAL_REASONS.ASSIGNMENT_DENIED : null,
    source: Object.freeze({ target: winner.target, targetId: winner.targetId ?? null }),
  };
}

function findLicense(licenses, actor, toolId) {
  return (Array.isArray(licenses) ? licenses : []).find((license) => (
    isPlainObject(license)
    && license.toolId === toolId
    && (
      (license.userId !== undefined && license.userId === actor.userId)
      || (license.workspaceId !== undefined && license.workspaceId === actor.workspaceId)
      || (license.accountId !== undefined && license.accountId === actor.accountId)
    )
  )) || null;
}

/**
 * Resolve the authorized tool catalog for an actor on a device.
 *
 * Every registered tool appears in the result, either as authorized with its
 * published version, or as unauthorized with a single reason. Returning the
 * full evaluation rather than only the allowed subset lets an administrator
 * answer "why can this artist not see Sep Maker PRO" without guessing, while
 * the workstation renders only `authorized` entries.
 */
export function resolveAuthorizedCatalog({
  actor,
  device,
  registry = [],
  assignments = [],
  licenses = [],
  nowMs,
} = {}) {
  if (!isPlainObject(actor) || !Number.isFinite(nowMs)) {
    return Object.freeze({ deviceAuthorized: false, deviceReason: DENIAL_REASONS.DEVICE_UNKNOWN, tools: Object.freeze([]) });
  }

  const deviceState = evaluateDevice(device);
  const evaluations = (Array.isArray(registry) ? registry : [])
    .filter(isPlainObject)
    .map((descriptor) => {
      const toolId = descriptor.toolId;
      const base = { toolId, displayName: descriptor.displayName ?? null, version: null };

      if (descriptor.status !== 'active') {
        return { ...base, authorized: false, reason: DENIAL_REASONS.TOOL_DISABLED };
      }

      const version = resolvePublishedVersion(descriptor);
      if (!version) {
        return { ...base, authorized: false, reason: DENIAL_REASONS.TOOL_NO_PUBLISHED_VERSION };
      }

      const assignment = resolveAssignment(assignments, actor, toolId);
      if (assignment.effect !== ASSIGNMENT_EFFECTS.GRANT) {
        return { ...base, authorized: false, reason: assignment.reason };
      }

      const license = evaluateLicense(findLicense(licenses, actor, toolId), nowMs);
      if (!license.authorized) {
        return { ...base, authorized: false, reason: license.reason };
      }

      // The device gate is applied last so an administrator inspecting a
      // pending workstation still sees which tools would become available
      // once it is approved.
      if (!deviceState.authorized) {
        return { ...base, authorized: false, reason: deviceState.reason };
      }

      return {
        ...base,
        authorized: true,
        reason: null,
        version: version.version,
        runtime: version.runtime,
        entryPoint: version.entryPoint ?? null,
        assignedVia: assignment.source,
      };
    });

  return Object.freeze({
    deviceAuthorized: deviceState.authorized,
    deviceReason: deviceState.reason,
    tools: Object.freeze(evaluations.map((entry) => Object.freeze(entry))),
  });
}

/** The subset a workstation may render. */
export function authorizedToolsOnly(catalog) {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.tools)) return [];
  return catalog.tools.filter((tool) => tool.authorized === true);
}
