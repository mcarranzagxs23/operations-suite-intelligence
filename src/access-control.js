/**
 * Operations Suite RBAC policy.
 *
 * This module protects the interface from accidental navigation to a view that
 * is not allowed for the active role. Firestore Rules and server endpoints
 * remain the authoritative production controls; UI checks are intentionally
 * only a second layer.
 */

export const ROLE_IDS = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  MANAGER: 'manager',
  TEAM_LEADER: 'team_leader',
  ARTIST: 'artist',
  CLIENT: 'client',
});

export const UNASSIGNED_ROLE = 'unassigned';

export const ROLE_META = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: { es: 'Super Administrador', en: 'Super Administrator', accent: 'cyan' },
  [ROLE_IDS.MANAGER]: { es: 'Gerente', en: 'Manager', accent: 'orange' },
  [ROLE_IDS.TEAM_LEADER]: { es: 'Líder de Equipo', en: 'Team Leader', accent: 'purple' },
  [ROLE_IDS.ARTIST]: { es: 'Artista', en: 'Artist', accent: 'green' },
  [ROLE_IDS.CLIENT]: { es: 'Cliente', en: 'Client', accent: 'blue' },
  [UNASSIGNED_ROLE]: { es: 'Sin acceso asignado', en: 'No access assigned', accent: 'neutral' },
});

export const NAVIGATION_CAPABILITIES = Object.freeze([
  'dashboard',
  'tools',
  'workspaces',
  'telemetry',
  'team',
  'devices',
  'administration',
  'intelligence',
  'settings',
]);

const permissions = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: NAVIGATION_CAPABILITIES,
  [ROLE_IDS.MANAGER]: ['dashboard', 'tools', 'workspaces', 'telemetry', 'team', 'settings'],
  [ROLE_IDS.TEAM_LEADER]: ['dashboard', 'tools', 'workspaces', 'telemetry', 'team', 'settings'],
  [ROLE_IDS.ARTIST]: ['dashboard', 'tools', 'workspaces', 'telemetry', 'settings'],
  [ROLE_IDS.CLIENT]: ['dashboard', 'telemetry', 'team', 'settings'],
});

export function canAccess(role, capability) {
  return Boolean(permissions[role] && permissions[role].includes(capability));
}

export function visibleCapabilities(role) {
  return NAVIGATION_CAPABILITIES.filter((capability) => canAccess(role, capability));
}

export function roleLabel(role, language = 'es') {
  return ROLE_META[role]?.[language] || ROLE_META[UNASSIGNED_ROLE][language];
}

export function isPrivilegedRole(role) {
  return role === ROLE_IDS.SUPER_ADMIN || role === ROLE_IDS.MANAGER;
}
