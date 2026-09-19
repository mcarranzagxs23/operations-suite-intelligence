/**
 * Operations Suite permission catalog.
 *
 * This module is the single source of truth for what an actor may do and at
 * which scope. It is a pure policy layer: it performs no network access, no
 * Firestore access, no storage access, and has no side effects. Firestore
 * Rules and the administrative backend remain the authoritative enforcement
 * points; this catalog defines the vocabulary both layers must agree on.
 *
 * Two separate concepts are modelled here and must not be conflated:
 *
 *   - a PERMISSION is a verb ('users.create').
 *   - a SCOPE is the boundary the verb applies within ('account').
 *
 * A grant is the pair. `users.read` at `account` scope means "may read users
 * belonging to the accounts this actor is a member of", never "may read every
 * user in the platform".
 */

import { ROLE_IDS } from './access-control.js';

/** Scope boundaries, ordered from broadest to narrowest. */
export const SCOPES = Object.freeze({
  GLOBAL: 'global',
  ACCOUNT: 'account',
  WORKSPACE: 'workspace',
  TEAM: 'team',
  SELF: 'self',
});

const SCOPE_BREADTH = Object.freeze({
  [SCOPES.GLOBAL]: 5,
  [SCOPES.ACCOUNT]: 4,
  [SCOPES.WORKSPACE]: 3,
  [SCOPES.TEAM]: 2,
  [SCOPES.SELF]: 1,
});

export const PERMISSIONS = Object.freeze({
  USERS_READ: 'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_SUSPEND: 'users.suspend',

  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',

  ACCOUNTS_READ: 'accounts.read',
  ACCOUNTS_MANAGE: 'accounts.manage',

  WORKSPACES_READ: 'workspaces.read',
  WORKSPACES_MANAGE: 'workspaces.manage',

  TEAMS_READ: 'teams.read',
  TEAMS_MANAGE: 'teams.manage',

  DEVICES_READ: 'devices.read',
  DEVICES_APPROVE: 'devices.approve',
  DEVICES_REVOKE: 'devices.revoke',

  TOOLS_READ: 'tools.read',
  TOOLS_ASSIGN: 'tools.assign',
  TOOLS_MANAGE: 'tools.manage',
  TOOLS_PUBLISH_VERSION: 'tools.publishVersion',

  LICENSES_READ: 'licenses.read',
  LICENSES_MANAGE: 'licenses.manage',

  TELEMETRY_READ: 'telemetry.read',

  AUDIT_READ: 'audit.read',

  SETTINGS_MANAGE: 'settings.manage',
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

/**
 * Permissions that may never appear on a custom role.
 *
 * These either grant platform-wide authority or allow an actor to widen its
 * own authority. Restricting them to the built-in Super Administrator role is
 * what prevents a custom role from being used as a privilege-escalation path
 * (a custom role that could grant `roles.manage` could grant itself anything).
 */
export const RESERVED_PERMISSIONS = Object.freeze([
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.TOOLS_MANAGE,
  PERMISSIONS.TOOLS_PUBLISH_VERSION,
  PERMISSIONS.SETTINGS_MANAGE,
]);

function grant(permission, scope) {
  return Object.freeze({ permission, scope });
}

/**
 * Built-in role definitions.
 *
 * These are immutable and cannot be edited through the administration UI. A
 * deployment that needs a different shape creates a custom role instead, which
 * keeps the audited baseline intact.
 */
export const BUILT_IN_ROLE_GRANTS = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: Object.freeze(
    ALL_PERMISSIONS.map((permission) => grant(permission, SCOPES.GLOBAL)),
  ),

  [ROLE_IDS.MANAGER]: Object.freeze([
    grant(PERMISSIONS.USERS_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.ACCOUNTS_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.WORKSPACES_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.TEAMS_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.TEAMS_MANAGE, SCOPES.ACCOUNT),
    grant(PERMISSIONS.DEVICES_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.TOOLS_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.LICENSES_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.TELEMETRY_READ, SCOPES.ACCOUNT),
  ]),

  [ROLE_IDS.TEAM_LEADER]: Object.freeze([
    grant(PERMISSIONS.USERS_READ, SCOPES.TEAM),
    grant(PERMISSIONS.WORKSPACES_READ, SCOPES.WORKSPACE),
    grant(PERMISSIONS.TEAMS_READ, SCOPES.TEAM),
    grant(PERMISSIONS.TOOLS_READ, SCOPES.WORKSPACE),
    grant(PERMISSIONS.TELEMETRY_READ, SCOPES.TEAM),
  ]),

  [ROLE_IDS.ARTIST]: Object.freeze([
    grant(PERMISSIONS.WORKSPACES_READ, SCOPES.WORKSPACE),
    grant(PERMISSIONS.TOOLS_READ, SCOPES.SELF),
    grant(PERMISSIONS.TELEMETRY_READ, SCOPES.SELF),
  ]),

  // A Client is deliberately account-scoped for aggregate service reporting
  // only. It receives no user, device, team, or tool visibility, so no
  // individual artist activity can be derived from its grants.
  [ROLE_IDS.CLIENT]: Object.freeze([
    grant(PERMISSIONS.ACCOUNTS_READ, SCOPES.ACCOUNT),
    grant(PERMISSIONS.TELEMETRY_READ, SCOPES.ACCOUNT),
  ]),
});

export function isKnownPermission(permission) {
  return ALL_PERMISSIONS.includes(permission);
}

export function isKnownScope(scope) {
  return Object.values(SCOPES).includes(scope);
}

export function isReservedPermission(permission) {
  return RESERVED_PERMISSIONS.includes(permission);
}

export function listPermissions() {
  return ALL_PERMISSIONS;
}

/**
 * True when `heldScope` covers everything `requiredScope` covers.
 *
 * Breadth is compared numerically rather than by identity so that an actor
 * holding an account-scoped grant satisfies a workspace-scoped requirement
 * within that account, while the reverse is correctly denied.
 */
export function scopeCovers(heldScope, requiredScope) {
  if (!isKnownScope(heldScope) || !isKnownScope(requiredScope)) return false;
  return SCOPE_BREADTH[heldScope] >= SCOPE_BREADTH[requiredScope];
}

/**
 * Filter custom-role grants down to what a custom role is ever allowed to hold.
 *
 * This repeats the reserved-permission and global-scope invariants enforced by
 * `validateCustomRole` on purpose. Validation guards the write path, but a role
 * document could still reach this resolver already tampered with, stale from
 * before a policy change, or restored from a backup. Re-applying the
 * invariants at read time means a malformed document degrades to fewer
 * permissions, never to more.
 */
function normalizeGrants(grants) {
  if (!Array.isArray(grants)) return [];
  return grants.filter((entry) => (
    entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && isKnownPermission(entry.permission)
    && isKnownScope(entry.scope)
    && !isReservedPermission(entry.permission)
    && entry.scope !== SCOPES.GLOBAL
  ));
}

/**
 * Resolve the effective grants for an actor.
 *
 * A built-in role contributes its fixed grants. A custom role contributes its
 * validated grants. When both are present the broadest scope per permission
 * wins, which keeps the result deterministic regardless of input order.
 */
export function resolveGrants({ role, customRole = null } = {}) {
  const builtIn = BUILT_IN_ROLE_GRANTS[role] || [];
  const custom = customRole && customRole.status === 'active'
    ? normalizeGrants(customRole.grants)
    : [];

  const broadest = new Map();
  for (const entry of [...builtIn, ...custom]) {
    const current = broadest.get(entry.permission);
    if (!current || SCOPE_BREADTH[entry.scope] > SCOPE_BREADTH[current]) {
      broadest.set(entry.permission, entry.scope);
    }
  }

  return Object.freeze(
    Array.from(broadest, ([permission, scope]) => grant(permission, scope)),
  );
}

/**
 * Authorization check for a single permission at a required scope.
 *
 * This is intentionally a pure predicate over already-resolved identity. It
 * does not read a session, a token, or Firestore; the caller supplies the
 * verified role. The administrative backend performs the same check against a
 * verified Firebase token before any mutation.
 */
export function hasPermission({ role, customRole = null }, permission, requiredScope = SCOPES.GLOBAL) {
  if (!isKnownPermission(permission) || !isKnownScope(requiredScope)) return false;

  return resolveGrants({ role, customRole })
    .some((entry) => entry.permission === permission && scopeCovers(entry.scope, requiredScope));
}

const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]{2,48}$/;
const CUSTOM_ROLE_STATUSES = Object.freeze(['active', 'disabled']);
const MAX_CUSTOM_ROLE_GRANTS = 64;

/**
 * Validate a custom role definition.
 *
 * Returns `{ valid, issues }` rather than throwing so the administration UI
 * and the backend can render the same issue list. The rules below exist to
 * prevent privilege escalation, not merely to reject malformed input:
 *
 *   - a custom role may never take a built-in role id, which would otherwise
 *     let it shadow the audited Super Administrator baseline;
 *   - a custom role may never hold a reserved permission;
 *   - a custom role may never hold a global-scoped grant, so it cannot reach
 *     outside the account that defined it.
 */
export function validateCustomRole(definition) {
  const issues = [];

  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return { valid: false, issues: ['role.invalid'] };
  }

  const allowedKeys = new Set(['roleId', 'displayName', 'accountId', 'status', 'grants']);
  if (Object.keys(definition).some((key) => !allowedKeys.has(key))) {
    issues.push('role.unexpectedField');
  }

  if (typeof definition.roleId !== 'string' || !ROLE_ID_PATTERN.test(definition.roleId)) {
    issues.push('role.invalidId');
  } else if (Object.values(ROLE_IDS).includes(definition.roleId) || definition.roleId === 'unassigned') {
    issues.push('role.reservedId');
  }

  if (typeof definition.displayName !== 'string'
    || definition.displayName.trim().length < 2
    || definition.displayName.trim().length > 64) {
    issues.push('role.invalidDisplayName');
  }

  if (typeof definition.accountId !== 'string' || definition.accountId.trim() === '') {
    issues.push('role.invalidAccount');
  }

  if (!CUSTOM_ROLE_STATUSES.includes(definition.status)) {
    issues.push('role.invalidStatus');
  }

  if (!Array.isArray(definition.grants) || definition.grants.length === 0) {
    issues.push('role.grantsRequired');
  } else if (definition.grants.length > MAX_CUSTOM_ROLE_GRANTS) {
    issues.push('role.tooManyGrants');
  } else {
    const seen = new Set();
    for (const entry of definition.grants) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        issues.push('role.invalidGrant');
        continue;
      }
      if (Object.keys(entry).some((key) => key !== 'permission' && key !== 'scope')) {
        issues.push('role.invalidGrant');
        continue;
      }
      if (!isKnownPermission(entry.permission)) {
        issues.push('role.unknownPermission');
        continue;
      }
      if (!isKnownScope(entry.scope)) {
        issues.push('role.unknownScope');
        continue;
      }
      if (isReservedPermission(entry.permission)) {
        issues.push('role.reservedPermission');
        continue;
      }
      if (entry.scope === SCOPES.GLOBAL) {
        issues.push('role.globalScopeNotAllowed');
        continue;
      }

      const key = `${entry.permission}@${entry.scope}`;
      if (seen.has(key)) issues.push('role.duplicateGrant');
      seen.add(key);
    }
  }

  return { valid: issues.length === 0, issues: Array.from(new Set(issues)) };
}
