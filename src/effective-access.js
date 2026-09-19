/**
 * Read-only effective-access reporting for the administration console.
 *
 * This module never grants a tool. It projects the persisted Account snapshot
 * through the same pure authorization resolver the backend uses, so a Super
 * Administrator can explain the current result for every station assigned to
 * one person without inventing a visual mock or widening any permission.
 */
import { resolveAuthorizedCatalog } from './tool-authorization.js';

const ACCESS_REASONS = Object.freeze({
  USER_INACTIVE: 'access.userInactive',
  MEMBERSHIP_INACTIVE: 'access.membershipInactive',
  WORKSPACE_OUT_OF_SCOPE: 'access.workspaceOutOfScope',
});

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedLicense(license, accountId) {
  if (!license || typeof license !== 'object') return null;
  const normalized = {
    toolId: license.toolId,
    status: license.status,
    startsAt: license.startsAt || null,
    expiresAt: license.expiresAt || null,
  };

  if (license.scope === 'account') normalized.accountId = accountId;
  if (license.scope === 'workspace' && license.scopeId) normalized.workspaceId = license.scopeId;
  if (license.scope === 'user' && license.scopeId) normalized.userId = license.scopeId;
  return normalized;
}

function deniedTools(registry, reason) {
  return safeArray(registry).map((tool) => Object.freeze({
    toolId: tool.toolId,
    displayName: tool.displayName || tool.toolId,
    version: null,
    authorized: false,
    reason,
    assignedVia: null,
  }));
}

function publicCatalog(catalog) {
  return Object.freeze({
    deviceAuthorized: catalog.deviceAuthorized === true,
    deviceReason: catalog.deviceReason || null,
    tools: Object.freeze(safeArray(catalog.tools).map((tool) => Object.freeze({
      toolId: tool.toolId,
      displayName: tool.displayName || tool.toolId,
      version: tool.version || null,
      authorized: tool.authorized === true,
      reason: tool.reason || null,
      assignedVia: tool.assignedVia
        ? Object.freeze({ target: tool.assignedVia.target, targetId: tool.assignedVia.targetId || null })
        : null,
    }))),
  });
}

function accessBlockReason({ user, membership, device }) {
  if (user.status !== 'active') return ACCESS_REASONS.USER_INACTIVE;
  if (!membership || membership.status !== 'active') return ACCESS_REASONS.MEMBERSHIP_INACTIVE;
  if (!membership.allWorkspaces && !safeArray(membership.workspaceIds).includes(device.workspaceId)) {
    return ACCESS_REASONS.WORKSPACE_OUT_OF_SCOPE;
  }
  return null;
}

/**
 * Evaluate a persisted user, membership, and every assigned workstation.
 * The output deliberately excludes package paths, checksums, credentials, and
 * raw Firestore objects; it is presentation data only.
 */
export function buildEffectiveAccessReport({
  accountId = '',
  user = null,
  membership = null,
  devices = [],
  registry = [],
  assignments = [],
  licenses = [],
  nowMs = Date.now(),
} = {}) {
  if (!user || typeof user !== 'object' || !user.id || !accountId) return null;

  const assignedDevices = safeArray(devices)
    .filter((device) => device?.assignedUid === user.id)
    .map((device) => {
      const blockedReason = accessBlockReason({ user, membership, device });
      const actor = membership ? {
        userId: user.id,
        accountId,
        workspaceId: device.workspaceId,
        role: membership.role,
        teamIds: safeArray(membership.teamIds),
      } : null;
      const catalog = blockedReason
        ? {
          deviceAuthorized: false,
          deviceReason: blockedReason,
          tools: deniedTools(registry, blockedReason),
        }
        : resolveAuthorizedCatalog({
          actor,
          device,
          registry,
          assignments,
          licenses: safeArray(licenses)
            .map((license) => normalizedLicense(license, accountId))
            .filter(Boolean),
          nowMs,
        });

      return Object.freeze({
        id: device.id,
        label: device.label || device.id,
        platform: device.platform || 'unknown',
        workspaceId: device.workspaceId || '',
        status: device.status || 'unknown',
        catalog: publicCatalog(catalog),
      });
    });

  return Object.freeze({
    accountId,
    user: Object.freeze({
      id: user.id,
      displayName: user.displayName || user.id,
      email: user.email || '',
      locale: user.locale || 'es',
      status: user.status || 'unknown',
    }),
    membership: membership
      ? Object.freeze({
        role: membership.role || 'unassigned',
        status: membership.status || 'unknown',
        allWorkspaces: membership.allWorkspaces === true,
        workspaceIds: Object.freeze(safeArray(membership.workspaceIds)),
      })
      : null,
    devices: Object.freeze(assignedDevices),
  });
}

export { ACCESS_REASONS };
