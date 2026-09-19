import { ROLE_IDS } from '../access-control.js';

export const ACTIVE_ACCOUNT_STORAGE_KEY = 'operations-suite.active-account';

const ACCOUNT_ROLES = new Set([
  ROLE_IDS.MANAGER,
  ROLE_IDS.TEAM_LEADER,
  ROLE_IDS.ARTIST,
  ROLE_IDS.CLIENT,
]);
const MEMBERSHIP_STATUSES = new Set(['invited', 'active', 'suspended', 'revoked']);

function browserStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

/**
 * The membership index is written only by the trusted backend. This client
 * helper validates it defensively, but it never uses browser storage or a
 * profile role as an authorization source.
 */
export function normalizeMembership(id, data = {}) {
  if (
    typeof id !== 'string' ||
    !id ||
    data.accountId !== id ||
    !ACCOUNT_ROLES.has(data.role) ||
    !MEMBERSHIP_STATUSES.has(data.status) ||
    typeof data.allWorkspaces !== 'boolean'
  ) return null;

  const workspaceIds = stringArray(data.workspaceIds);
  if ((data.allWorkspaces && workspaceIds.length > 0) || (!data.allWorkspaces && workspaceIds.length === 0)) {
    return null;
  }

  return Object.freeze({
    accountId: id,
    accountName: typeof data.accountName === 'string' ? data.accountName : '',
    role: data.role,
    status: data.status,
    allWorkspaces: data.allWorkspaces,
    workspaceIds,
  });
}

export function readActiveAccountPreference() {
  const storage = browserStorage();
  if (!storage) return '';

  try {
    return storage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function persistActiveAccountPreference(accountId) {
  const storage = browserStorage();
  if (!storage || typeof accountId !== 'string') return;

  try {
    storage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
  } catch {
    // This is a convenience preference only. It never grants a role or scope.
  }
}

export function selectActiveMembership(memberships, preferredAccountId = '') {
  const activeMemberships = memberships
    .filter((membership) => membership?.status === 'active')
    .sort((left, right) => (
      `${left.accountName}\u0000${left.accountId}`.localeCompare(`${right.accountName}\u0000${right.accountId}`)
    ));

  return activeMemberships.find((membership) => membership.accountId === preferredAccountId)
    || activeMemberships[0]
    || null;
}

export function resolveSessionAccess({ isSuperAdmin = false, memberships = [], preferredAccountId = '' } = {}) {
  const selectedMembership = selectActiveMembership(memberships, preferredAccountId);

  if (isSuperAdmin) {
    return Object.freeze({
      globalRole: ROLE_IDS.SUPER_ADMIN,
      role: ROLE_IDS.SUPER_ADMIN,
      activeMembership: selectedMembership,
    });
  }

  if (!selectedMembership) {
    return Object.freeze({
      globalRole: null,
      role: 'unassigned',
      activeMembership: null,
    });
  }

  return Object.freeze({
    globalRole: null,
    role: selectedMembership.role,
    activeMembership: selectedMembership,
  });
}

export function switchActiveAccount(session, accountId) {
  const access = resolveSessionAccess({
    isSuperAdmin: session?.globalRole === ROLE_IDS.SUPER_ADMIN,
    memberships: session?.memberships || [],
    preferredAccountId: accountId,
  });

  if (access.activeMembership?.accountId) persistActiveAccountPreference(access.activeMembership.accountId);

  return {
    ...session,
    role: access.role,
    activeAccountId: access.activeMembership?.accountId || '',
    accountId: access.activeMembership?.accountId || '',
    accountName: access.activeMembership?.accountName || '',
    activeRole: access.activeMembership?.role || null,
  };
}
