import { ASSIGNMENT_TARGETS } from '../tool-authorization.js';
import { ACCOUNT_ROLES } from '../forms/admin-forms.js';

/**
 * Shared presentation helpers for the administration console.
 *
 * Every selectable value an administrator sees is built here from persisted
 * records. Nothing in the console hard-codes an account, a person, a tool, or
 * a workstation, so what the interface offers is always what the platform
 * actually contains — an identifier that is not in the database cannot be
 * chosen by accident, and a record that exists is never invisible.
 */

function option(value, label, detail = '') {
  return Object.freeze({ value, label, detail });
}

function byLabel(left, right) {
  return left.label.localeCompare(right.label);
}

export function labelForValue(t, value) {
  const key = `value_${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

export function labelForRole(t, role) {
  const key = `role_${role}`;
  const translated = t(key);
  return translated === key ? role : translated;
}

/**
 * Denial reasons cross the wire as dotted contract values (`license.expired`).
 * They are contract data, not copy, so they are mapped to a key here rather
 * than translated at the source.
 */
export function labelForReason(t, reason) {
  if (!reason) return '';
  const key = `reason_${String(reason).replace(/\./g, '_')}`;
  const translated = t(key);
  return translated === key ? reason : translated;
}

export function labelForAuditAction(t, action) {
  const key = `audit_${action}`;
  const translated = t(key);
  return translated === key ? action : translated;
}

export function labelForIssue(t, code) {
  const key = `issue_${code}`;
  const translated = t(key);
  return translated === key ? code : translated;
}

export function labelForField(t, name) {
  const key = `field_${name}`;
  const translated = t(key);
  return translated === key ? name : translated;
}

export function hintForField(t, name) {
  const key = `hint_${name}`;
  const translated = t(key);
  return translated === key ? '' : translated;
}

export function formatInstant(value, language) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

export function formatDay(value, language) {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * Build every selector list the forms can draw from.
 *
 * Records come from the account currently being administered, so a workspace
 * or a person from another account can never appear in a list and be submitted
 * by mistake. The backend re-checks the same relationships regardless.
 */
export function buildOptionSources({ snapshot, values = {}, t }) {
  const membersById = new Map(snapshot.members.map((member) => [member.id, member]));
  const usersById = new Map(snapshot.users.map((user) => [user.id, user]));
  const toolsById = new Map(snapshot.tools.map((tool) => [tool.toolId, tool]));
  const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace]));

  const personLabel = (uid) => (
    membersById.get(uid)?.displayName || usersById.get(uid)?.displayName || uid
  );

  const sources = {
    accounts: snapshot.accounts.map((account) => (
      option(account.id, account.name, labelForValue(t, account.status))
    )).sort(byLabel),
    workspaces: snapshot.workspaces.map((workspace) => (
      option(workspace.id, workspace.name, labelForValue(t, workspace.status))
    )).sort(byLabel),
    users: snapshot.users.map((user) => (
      option(user.id, user.displayName, user.email)
    )).sort(byLabel),
    members: snapshot.members.map((member) => (
      option(member.id, member.displayName, labelForRole(t, member.role))
    )).sort(byLabel),
    teams: snapshot.teams.map((team) => option(team.id, team.name)).sort(byLabel),
    customRoles: snapshot.customRoles.map((role) => (
      option(role.roleId, role.displayName, labelForValue(t, role.status))
    )).sort(byLabel),
    tools: snapshot.tools.map((tool) => (
      option(tool.toolId, tool.displayName, tool.publishedVersion || labelForValue(t, 'draft'))
    )).sort(byLabel),
    assignments: snapshot.assignments.map((assignment) => option(
      assignment.id,
      `${toolsById.get(assignment.toolId)?.displayName || assignment.toolId} · ${labelForValue(t, assignment.target)}`,
      labelForValue(t, assignment.effect),
    )).sort(byLabel),
    licenses: snapshot.licenses.map((license) => option(
      license.id,
      `${toolsById.get(license.toolId)?.displayName || license.toolId} · ${labelForValue(t, license.scope)}`,
      labelForValue(t, license.status),
    )).sort(byLabel),
    devices: snapshot.devices.map((device) => option(
      device.id,
      device.label,
      `${personLabel(device.assignedUid)} · ${labelForValue(t, device.status)}`,
    )).sort(byLabel),
  };

  // The target of an assignment and the scope of a license are both dependent
  // selectors: what may be chosen follows from the kind already chosen.
  sources.assignmentTargets = (() => {
    switch (values.target) {
      case ASSIGNMENT_TARGETS.ROLE:
        return ACCOUNT_ROLES.map((role) => option(role, labelForRole(t, role)));
      case ASSIGNMENT_TARGETS.ACCOUNT:
        return sources.accounts.filter((entry) => entry.value === values.accountId);
      case ASSIGNMENT_TARGETS.WORKSPACE:
        return sources.workspaces;
      case ASSIGNMENT_TARGETS.TEAM:
        return sources.teams;
      case ASSIGNMENT_TARGETS.USER:
        return sources.members;
      default:
        return [];
    }
  })();

  sources.licenseScopes = values.scope === 'workspace'
    ? sources.workspaces
    : values.scope === 'user'
      ? sources.members
      : [];

  sources.personLabel = personLabel;
  sources.workspaceLabel = (id) => workspacesById.get(id)?.name || id;
  sources.toolLabel = (id) => toolsById.get(id)?.displayName || id;

  return sources;
}

export function optionsForField(item, sources, t) {
  if (item.values) {
    return item.values.map((value) => option(
      value,
      item.labelPrefix === 'role_' ? labelForRole(t, value) : labelForValue(t, value),
    ));
  }
  if (item.name === 'targetId') return sources.assignmentTargets;
  if (item.name === 'scopeId') return sources.licenseScopes;
  return sources[item.source] || [];
}
