import { ROLE_IDS } from '../access-control.js';
import { listPermissions, RESERVED_PERMISSIONS, SCOPES } from '../permission-catalog.js';
import {
  ASSIGNMENT_EFFECTS,
  ASSIGNMENT_TARGETS,
  DEVICE_STATUSES,
  LICENSE_STATUSES,
} from '../tool-authorization.js';
import { TOOL_RUNTIMES, TOOL_STATUSES, TOOL_TYPES } from '../tool-registry-contract.js';
import { ADMIN_OPERATIONS } from '../admin-operations.js';

/**
 * Declarative definition and validation of every administrative form.
 *
 * The module is pure: no transport, storage, DOM, cloud SDK, or logging. It
 * mirrors the field rules the callable backend enforces so an operator sees a
 * problem in the form instead of a generic server rejection — while the
 * backend keeps enforcing them independently, because a browser check is a
 * convenience and never a control.
 *
 * Describing the forms as data rather than as markup is what keeps twenty
 * operations consistent: one renderer, one validator, one payload builder, and
 * no screen that quietly forgets a rule the others apply.
 */

export const ACCOUNT_ROLES = Object.freeze([
  ROLE_IDS.MANAGER,
  ROLE_IDS.TEAM_LEADER,
  ROLE_IDS.ARTIST,
  ROLE_IDS.CLIENT,
]);

export const MEMBERSHIP_STATUSES = Object.freeze(['invited', 'active', 'suspended', 'revoked']);
export const ACCOUNT_STATUSES = Object.freeze(['active', 'suspended']);
export const WORKSPACE_STATUSES = Object.freeze(['active', 'archived']);
export const TEAM_STATUSES = Object.freeze(['active', 'archived']);
export const USER_STATUSES = Object.freeze(['active', 'suspended']);
export const CUSTOM_ROLE_STATUSES = Object.freeze(['active', 'disabled']);
export const LICENSE_SCOPES = Object.freeze(['account', 'workspace', 'user']);

/** Permissions a custom role may hold, with the reserved verbs removed. */
export const ASSIGNABLE_PERMISSIONS = Object.freeze(
  listPermissions().filter((permission) => !RESERVED_PERMISSIONS.includes(permission)),
);

/** Scopes a custom role may hold. `global` is reserved for built-in roles. */
export const ASSIGNABLE_SCOPES = Object.freeze([
  SCOPES.ACCOUNT,
  SCOPES.WORKSPACE,
  SCOPES.TEAM,
  SCOPES.SELF,
]);

const ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const WORKSPACE_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{2,48}$/;
const ROLE_ID_PATTERN = /^[a-z][a-z0-9_-]{2,48}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTRY_POINT_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const ACTION_NAME_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;

const CONTROL_CHARACTER_LIMIT = 32;
const DELETE_CHARACTER_CODE = 127;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < CONTROL_CHARACTER_LIMIT || code === DELETE_CHARACTER_CODE) return true;
  }
  return false;
}

function isText(value, { min = 1, max = 120 } = {}) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max && !hasControlCharacters(normalized);
}

function isIdentifier(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function isIdentifierList(value, max = 100) {
  return Array.isArray(value)
    && value.length <= max
    && value.every(isIdentifier)
    && new Set(value).size === value.length;
}

function isInstant(value) {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value));
}

/**
 * A strong initial password is required at provisioning time because it is the
 * only credential the operator will have until they change it.
 */
function isStrongPassword(value) {
  if (typeof value !== 'string') return false;
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) return false;
  if (hasControlCharacters(value)) return false;
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3;
}

function field(name, kind, options = {}) {
  return Object.freeze({ name, kind, optional: false, ...options });
}

const ROLE_TARGET_OPTIONS = Object.freeze(ACCOUNT_ROLES.map((role) => ({ value: role, labelKey: `role_${role}` })));

/**
 * The full administrative surface, in the order it is presented.
 *
 * `source` names the live collection a selector is filled from, so the console
 * never hard-codes a list of accounts, users, tools, or workspaces: every
 * choice an administrator makes comes from persisted state.
 */
export const ADMIN_FORMS = Object.freeze({
  [ADMIN_OPERATIONS.CREATE_ACCOUNT]: Object.freeze({
    section: 'accounts',
    icon: 'plus',
    fields: Object.freeze([
      field('displayName', 'text'),
      field('defaultLocale', 'select', { values: ['es', 'en'] }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPDATE_ACCOUNT]: Object.freeze({
    section: 'accounts',
    icon: 'settings',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('displayName', 'text'),
      field('status', 'select', { values: ACCOUNT_STATUSES }),
      field('defaultLocale', 'select', { values: ['es', 'en'] }),
    ]),
  }),
  [ADMIN_OPERATIONS.CREATE_WORKSPACE]: Object.freeze({
    section: 'workspaces',
    icon: 'workspace',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('displayName', 'text'),
      field('code', 'text', { optional: true }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPDATE_WORKSPACE]: Object.freeze({
    section: 'workspaces',
    icon: 'settings',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('workspaceId', 'select', { source: 'workspaces' }),
      field('displayName', 'text'),
      field('status', 'select', { values: WORKSPACE_STATUSES }),
    ]),
  }),
  [ADMIN_OPERATIONS.CREATE_USER]: Object.freeze({
    section: 'users',
    icon: 'plus',
    fields: Object.freeze([
      field('email', 'email'),
      field('displayName', 'text'),
      field('password', 'password'),
      field('locale', 'select', { values: ['es', 'en'] }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPDATE_USER_PROFILE]: Object.freeze({
    section: 'users',
    icon: 'settings',
    fields: Object.freeze([
      field('targetUid', 'select', { source: 'users' }),
      field('displayName', 'text'),
      field('locale', 'select', { values: ['es', 'en'] }),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_USER_STATUS]: Object.freeze({
    section: 'users',
    icon: 'lock',
    fields: Object.freeze([
      field('targetUid', 'select', { source: 'users' }),
      field('status', 'select', { values: USER_STATUSES }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_MEMBERSHIP]: Object.freeze({
    section: 'users',
    icon: 'team',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('targetUid', 'select', { source: 'users' }),
      field('displayName', 'text'),
      field('role', 'select', { values: ACCOUNT_ROLES, labelPrefix: 'role_' }),
      field('customRoleId', 'select', { source: 'customRoles', optional: true }),
      field('allWorkspaces', 'boolean'),
      field('workspaceIds', 'multiselect', { source: 'workspaces', optional: true }),
      field('teamIds', 'multiselect', { source: 'teams', optional: true }),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_MEMBERSHIP_STATUS]: Object.freeze({
    section: 'users',
    icon: 'shield',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('targetUid', 'select', { source: 'members' }),
      field('status', 'select', { values: MEMBERSHIP_STATUSES, labelPrefix: 'membership_' }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_TEAM]: Object.freeze({
    section: 'teams',
    icon: 'team',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('teamId', 'select', { source: 'teams', optional: true }),
      field('displayName', 'text'),
      field('leaderUids', 'multiselect', { source: 'members' }),
      field('memberUids', 'multiselect', { source: 'members', optional: true }),
      field('workspaceId', 'select', { source: 'workspaces', optional: true }),
      field('status', 'select', { values: TEAM_STATUSES }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_CUSTOM_ROLE]: Object.freeze({
    section: 'roles',
    icon: 'shield',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('roleId', 'text'),
      field('displayName', 'text'),
      field('status', 'select', { values: CUSTOM_ROLE_STATUSES }),
      field('grants', 'grants'),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_CUSTOM_ROLE_STATUS]: Object.freeze({
    section: 'roles',
    icon: 'lock',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('roleId', 'select', { source: 'customRoles' }),
      field('status', 'select', { values: CUSTOM_ROLE_STATUSES }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_TOOL]: Object.freeze({
    section: 'tools',
    icon: 'tools',
    fields: Object.freeze([
      field('toolId', 'text'),
      field('displayName', 'text'),
      field('description', 'text', { optional: true }),
      field('type', 'select', { values: Object.values(TOOL_TYPES) }),
      field('status', 'select', { values: Object.values(TOOL_STATUSES) }),
      field('publisher', 'text'),
    ]),
  }),
  [ADMIN_OPERATIONS.PUBLISH_TOOL_VERSION]: Object.freeze({
    section: 'tools',
    icon: 'upload',
    fields: Object.freeze([
      field('toolId', 'select', { source: 'tools' }),
      field('version', 'text'),
      field('runtime', 'select', { values: Object.values(TOOL_RUNTIMES) }),
      field('checksumSha256', 'text'),
      field('entryPoint', 'text', { optional: true }),
      field('actionSet', 'text', { optional: true }),
      field('actionName', 'text', { optional: true }),
      field('minHostVersion', 'text', { optional: true }),
      field('publish', 'boolean'),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_TOOL_STATUS]: Object.freeze({
    section: 'tools',
    icon: 'lock',
    fields: Object.freeze([
      field('toolId', 'select', { source: 'tools' }),
      field('status', 'select', { values: Object.values(TOOL_STATUSES) }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_ASSIGNMENT]: Object.freeze({
    section: 'assignments',
    icon: 'grid',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('assignmentId', 'select', { source: 'assignments', optional: true }),
      field('toolId', 'select', { source: 'tools' }),
      field('target', 'select', { values: ['role', 'account', 'workspace', 'team', 'user'] }),
      field('targetId', 'target'),
      field('effect', 'select', { values: Object.values(ASSIGNMENT_EFFECTS) }),
      field('note', 'text', { optional: true }),
    ]),
  }),
  [ADMIN_OPERATIONS.DELETE_ASSIGNMENT]: Object.freeze({
    section: 'assignments',
    icon: 'close',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('assignmentId', 'select', { source: 'assignments' }),
    ]),
  }),
  [ADMIN_OPERATIONS.UPSERT_LICENSE]: Object.freeze({
    section: 'licenses',
    icon: 'shield',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('licenseId', 'select', { source: 'licenses', optional: true }),
      field('toolId', 'select', { source: 'tools' }),
      field('scope', 'select', { values: LICENSE_SCOPES }),
      field('scopeId', 'licenseScope', { optional: true }),
      field('seats', 'number', { optional: true }),
      field('status', 'select', { values: Object.values(LICENSE_STATUSES) }),
      field('startsAt', 'datetime', { optional: true }),
      field('expiresAt', 'datetime', { optional: true }),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_LICENSE_STATUS]: Object.freeze({
    section: 'licenses',
    icon: 'lock',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('licenseId', 'select', { source: 'licenses' }),
      field('status', 'select', { values: Object.values(LICENSE_STATUSES) }),
    ]),
  }),
  [ADMIN_OPERATIONS.SET_DEVICE_STATUS]: Object.freeze({
    section: 'devices',
    icon: 'device',
    fields: Object.freeze([
      field('accountId', 'select', { source: 'accounts' }),
      field('deviceId', 'select', { source: 'devices' }),
      field('status', 'select', { values: Object.values(DEVICE_STATUSES) }),
    ]),
  }),
});

export const ADMIN_SECTIONS = Object.freeze([
  'accounts', 'workspaces', 'users', 'teams', 'roles', 'tools', 'assignments', 'licenses', 'devices',
]);

export function listOperationsForSection(section) {
  return Object.entries(ADMIN_FORMS)
    .filter(([, definition]) => definition.section === section)
    .map(([operation]) => operation);
}

export function createAdminFormValues(operation, defaults = {}) {
  const definition = ADMIN_FORMS[operation];
  if (!definition) return null;

  const values = {};
  for (const item of definition.fields) {
    switch (item.kind) {
      case 'boolean':
        values[item.name] = item.name === 'publish';
        break;
      case 'multiselect':
      case 'grants':
        values[item.name] = [];
        break;
      case 'select':
        values[item.name] = item.values ? item.values[0] : '';
        break;
      case 'number':
        values[item.name] = '';
        break;
      default:
        values[item.name] = '';
    }
  }

  return { ...values, ...defaults };
}

function issue(issues, name, code) {
  if (!issues.some((item) => item.field === name)) issues.push({ field: name, code });
}

function validateField(item, values, issues, operation) {
  const value = values[item.name];
  const empty = value === '' || value === null || value === undefined
    || (Array.isArray(value) && value.length === 0);

  if (empty) {
    if (!item.optional && item.kind !== 'boolean') issue(issues, item.name, 'required');
    return;
  }

  switch (item.kind) {
    case 'email':
      if (typeof value !== 'string' || value.trim().length > 254 || !EMAIL_PATTERN.test(value.trim().toLowerCase())) {
        issue(issues, item.name, 'invalidEmail');
      }
      break;
    case 'password':
      if (!isStrongPassword(value)) issue(issues, item.name, 'weakPassword');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') issue(issues, item.name, 'invalidValue');
      break;
    case 'number': {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100000) issue(issues, item.name, 'invalidNumber');
      break;
    }
    case 'datetime':
      if (!isInstant(value)) issue(issues, item.name, 'invalidDate');
      break;
    case 'multiselect':
      if (!isIdentifierList(value)) issue(issues, item.name, 'invalidSelection');
      break;
    case 'grants':
      if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
        issue(issues, item.name, 'invalidGrants');
      } else if (value.some((grant) => (
        !ASSIGNABLE_PERMISSIONS.includes(grant?.permission) || !ASSIGNABLE_SCOPES.includes(grant?.scope)
      ))) {
        issue(issues, item.name, 'invalidGrants');
      } else if (new Set(value.map((grant) => `${grant.permission}@${grant.scope}`)).size !== value.length) {
        issue(issues, item.name, 'duplicateGrant');
      }
      break;
    case 'select':
      if (item.values && !item.values.includes(value)) issue(issues, item.name, 'invalidValue');
      else if (!item.values && !isIdentifier(value) && !isToolLikeId(item.name, value)) {
        issue(issues, item.name, 'invalidSelection');
      }
      break;
    case 'target':
      validateAssignmentTarget(values, issues);
      break;
    case 'licenseScope':
      validateLicenseScope(values, issues);
      break;
    default:
      validateTextField(item, value, issues, operation);
  }
}

/**
 * Identifiers that are chosen by an administrator rather than generated by
 * Firestore — a tool id and a custom role id — follow their own pattern and
 * would fail the opaque-document-id check.
 */
function isToolLikeId(name, value) {
  if (name === 'toolId') return TOOL_ID_PATTERN.test(String(value));
  if (name === 'roleId') return ROLE_ID_PATTERN.test(String(value));
  return false;
}

function validateTextField(item, value, issues, operation) {
  switch (item.name) {
    case 'code':
      if (!WORKSPACE_CODE_PATTERN.test(String(value).trim().toLowerCase()) || String(value).trim().length > 64) {
        issue(issues, item.name, 'invalidWorkspaceCode');
      }
      break;
    case 'toolId':
      if (!TOOL_ID_PATTERN.test(String(value).trim().toLowerCase())) issue(issues, item.name, 'invalidToolId');
      break;
    case 'roleId':
      if (!ROLE_ID_PATTERN.test(String(value).trim().toLowerCase())) issue(issues, item.name, 'invalidRoleId');
      else if (Object.values(ROLE_IDS).includes(String(value).trim().toLowerCase())) {
        issue(issues, item.name, 'reservedRoleId');
      }
      break;
    case 'version':
      if (!SEMVER_PATTERN.test(String(value).trim())) issue(issues, item.name, 'invalidVersion');
      break;
    case 'checksumSha256':
      if (!SHA256_PATTERN.test(String(value).trim().toLowerCase())) issue(issues, item.name, 'invalidChecksum');
      break;
    case 'entryPoint':
      if (!isSafeEntryPoint(String(value).trim())) issue(issues, item.name, 'invalidEntryPoint');
      break;
    case 'actionSet':
    case 'actionName':
      if (!ACTION_NAME_PATTERN.test(String(value).trim())) issue(issues, item.name, 'invalidActionName');
      break;
    case 'description':
      if (!isText(value, { min: 1, max: 240 })) issue(issues, item.name, 'invalidText');
      break;
    case 'note':
      if (!isText(value, { min: 1, max: 160 })) issue(issues, item.name, 'invalidText');
      break;
    default:
      if (!isText(value, { min: operation === ADMIN_OPERATIONS.CREATE_USER ? 2 : 1, max: 120 })) {
        issue(issues, item.name, 'invalidText');
      }
  }
}

/**
 * Reject an entry point that could escape the tool package.
 *
 * Absolute paths, drive letters, UNC prefixes, backslashes, and traversal
 * segments are refused rather than normalized, matching the registry contract
 * exactly: a malformed descriptor must fail loudly, not resolve somewhere
 * unexpected.
 */
function isSafeEntryPoint(value) {
  if (!value || value.length > 200) return false;
  if (value.startsWith('/') || value.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) return false;
  return ENTRY_POINT_PATTERN.test(value);
}

function validateAssignmentTarget(values, issues) {
  if (values.target === ASSIGNMENT_TARGETS.GLOBAL) {
    issue(issues, 'target', 'globalTargetNotAllowed');
    return;
  }
  if (values.target === ASSIGNMENT_TARGETS.ROLE) {
    if (!ACCOUNT_ROLES.includes(values.targetId)) issue(issues, 'targetId', 'invalidValue');
    return;
  }
  if (!isIdentifier(values.targetId)) issue(issues, 'targetId', 'required');
}

function validateLicenseScope(values, issues) {
  if (values.scope === 'account') {
    if (values.scopeId) issue(issues, 'scopeId', 'scopeIdNotAllowed');
    return;
  }
  if (!isIdentifier(values.scopeId)) issue(issues, 'scopeId', 'required');
}

export function validateAdminForm(operation, values) {
  const definition = ADMIN_FORMS[operation];
  if (!definition) return Object.freeze({ valid: false, issues: Object.freeze([{ field: 'form', code: 'unsupportedOperation' }]) });
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return Object.freeze({ valid: false, issues: Object.freeze([{ field: 'form', code: 'invalidShape' }]) });
  }

  const allowed = new Set(definition.fields.map((item) => item.name));
  const issues = [];
  if (Object.keys(values).some((key) => !allowed.has(key))) {
    return Object.freeze({ valid: false, issues: Object.freeze([{ field: 'form', code: 'invalidShape' }]) });
  }

  for (const item of definition.fields) {
    validateField(item, values, issues, operation);
  }

  // Cross-field rules the backend also enforces. Scope must be stated exactly
  // once: "all workspaces" together with a list is ambiguous, and neither is
  // an assignment with no reach at all.
  if (operation === ADMIN_OPERATIONS.UPSERT_MEMBERSHIP) {
    if (values.allWorkspaces === true && values.workspaceIds.length > 0) {
      issue(issues, 'workspaceIds', 'ambiguousScope');
    }
    if (values.allWorkspaces === false && values.workspaceIds.length === 0) {
      issue(issues, 'workspaceIds', 'required');
    }
  }

  if (operation === ADMIN_OPERATIONS.PUBLISH_TOOL_VERSION) {
    const isAction = values.runtime === TOOL_RUNTIMES.ILLUSTRATOR_ACTION;
    if (isAction) {
      if (values.entryPoint) issue(issues, 'entryPoint', 'entryPointNotAllowed');
      if (!values.actionSet) issue(issues, 'actionSet', 'required');
      if (!values.actionName) issue(issues, 'actionName', 'required');
    } else {
      if (!values.entryPoint) issue(issues, 'entryPoint', 'required');
      if (values.actionSet || values.actionName) issue(issues, 'actionSet', 'actionFieldsNotAllowed');
    }
  }

  if (operation === ADMIN_OPERATIONS.UPSERT_LICENSE
    && isInstant(values.startsAt) && isInstant(values.expiresAt)
    && Date.parse(values.expiresAt) <= Date.parse(values.startsAt)) {
    issue(issues, 'expiresAt', 'invalidDateRange');
  }

  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

function omitEmpty(payload) {
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0 && key !== 'workspaceIds' && key !== 'grants') continue;
    result[key] = value;
  }
  return result;
}

/**
 * Build the exact payload the callable expects.
 *
 * The backend refuses unknown keys, so an optional field left blank must be
 * absent rather than sent as an empty string. Mutually exclusive fields — an
 * entry point versus an Illustrator action pair — are dropped here for the
 * same reason: sending both would be rejected as a malformed descriptor even
 * though the operator filled the form correctly.
 */
export function buildAdminPayload(operation, values) {
  const definition = ADMIN_FORMS[operation];
  if (!definition) return null;

  const payload = { ...values };

  if (operation === ADMIN_OPERATIONS.UPSERT_MEMBERSHIP) {
    payload.workspaceIds = values.allWorkspaces ? [] : [...values.workspaceIds];
    payload.teamIds = [...(values.teamIds || [])];
  }

  if (operation === ADMIN_OPERATIONS.PUBLISH_TOOL_VERSION) {
    if (values.runtime === TOOL_RUNTIMES.ILLUSTRATOR_ACTION) {
      delete payload.entryPoint;
    } else {
      delete payload.actionSet;
      delete payload.actionName;
    }
    payload.checksumSha256 = String(values.checksumSha256).trim().toLowerCase();
  }

  if (operation === ADMIN_OPERATIONS.UPSERT_LICENSE) {
    payload.seats = values.seats === '' || values.seats === null ? null : Number(values.seats);
    if (values.scope === 'account') delete payload.scopeId;
  }

  if (typeof payload.toolId === 'string') payload.toolId = payload.toolId.trim().toLowerCase();
  if (typeof payload.roleId === 'string') payload.roleId = payload.roleId.trim().toLowerCase();
  if (typeof payload.email === 'string') payload.email = payload.email.trim().toLowerCase();
  if (typeof payload.code === 'string' && payload.code.trim()) payload.code = payload.code.trim().toLowerCase();

  const cleaned = omitEmpty(payload);
  if (operation === ADMIN_OPERATIONS.UPSERT_MEMBERSHIP) cleaned.workspaceIds = payload.workspaceIds;
  if (operation === ADMIN_OPERATIONS.UPSERT_LICENSE && payload.seats === null) delete cleaned.seats;
  if (operation === ADMIN_OPERATIONS.PUBLISH_TOOL_VERSION) cleaned.publish = values.publish === true;
  if (operation === ADMIN_OPERATIONS.UPSERT_MEMBERSHIP) cleaned.allWorkspaces = values.allWorkspaces === true;

  return cleaned;
}

export function deriveWorkspaceCodePreview(displayName) {
  if (!isText(displayName)) return '';
  return Array.from(displayName.trim().normalize('NFD'))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export { ROLE_TARGET_OPTIONS };
