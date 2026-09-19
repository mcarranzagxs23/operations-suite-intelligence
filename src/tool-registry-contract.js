/**
 * Operations Suite tool registry contract.
 *
 * A registered tool is an administratively approved package, not a script the
 * platform downloads and runs on trust. This module defines and validates that
 * package descriptor. It is pure: no network, no filesystem, no Firestore, and
 * it never executes or loads a tool.
 *
 * The security position this contract encodes:
 *
 *   - a tool is identified by a stable opaque id, never by display name;
 *   - a version is immutable once published and carries a SHA-256 checksum;
 *   - the runtime is drawn from a closed allow-list, so a descriptor cannot
 *     introduce a new execution mechanism by inventing a runtime string;
 *   - the entry point is a relative path inside the tool package, and any
 *     absolute path or traversal segment is rejected.
 *
 * The checksum is recorded here so a future distribution channel can verify a
 * package before it is cached or executed. Recording a checksum is not the
 * same as verifying one; verification belongs to the component that actually
 * materializes a package on disk.
 */

export const TOOL_RUNTIMES = Object.freeze({
  EXTENDSCRIPT: 'extendscript',
  ILLUSTRATOR_ACTION: 'illustrator_action',
  CEP_MODULE: 'cep_module',
  UXP_MODULE: 'uxp_module',
});

export const TOOL_TYPES = Object.freeze({
  ILLUSTRATOR_ENGINE: 'illustrator_engine',
  ILLUSTRATOR_ACTION: 'illustrator_action',
  AUTOMATION: 'automation',
  INTERNAL_TOOL: 'internal_tool',
});

/**
 * Version lifecycle.
 *
 * `published` is the only state an end user may receive. `draft` and
 * `deprecated` remain visible to administrators so a rollback target and an
 * audit trail survive, which is why versions are never hard-deleted.
 */
export const TOOL_VERSION_STATUSES = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  DEPRECATED: 'deprecated',
});

export const TOOL_STATUSES = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
});

const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{2,48}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTRY_POINT_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const ACTION_NAME_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

const MAX_DISPLAY_NAME = 64;
const MAX_DESCRIPTION = 240;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject anything that could escape the tool package directory.
 *
 * A relative path is required. Absolute paths, drive letters, UNC prefixes,
 * backslashes, and `..` segments are all refused rather than normalized, so a
 * malformed descriptor fails loudly instead of resolving somewhere unexpected.
 */
function isSafeEntryPoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return false;
  if (value.startsWith('/') || value.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) return false;
  return ENTRY_POINT_PATTERN.test(value);
}

function validateVersion(version, issues, index) {
  const at = `version[${index}]`;

  if (!isPlainObject(version)) {
    issues.push(`${at}.invalid`);
    return;
  }

  const allowed = new Set([
    'version', 'status', 'checksumSha256', 'entryPoint', 'runtime',
    'publishedAt', 'minHostVersion', 'actionSet', 'actionName',
  ]);
  if (Object.keys(version).some((key) => !allowed.has(key))) {
    issues.push(`${at}.unexpectedField`);
  }

  if (typeof version.version !== 'string' || !SEMVER_PATTERN.test(version.version)) {
    issues.push(`${at}.invalidVersion`);
  }
  if (!Object.values(TOOL_VERSION_STATUSES).includes(version.status)) {
    issues.push(`${at}.invalidStatus`);
  }
  if (typeof version.checksumSha256 !== 'string' || !SHA256_PATTERN.test(version.checksumSha256)) {
    issues.push(`${at}.invalidChecksum`);
  }
  if (!Object.values(TOOL_RUNTIMES).includes(version.runtime)) {
    issues.push(`${at}.invalidRuntime`);
  }

  // An Illustrator Action is addressed by set and name inside the host rather
  // than by a script file, so the two descriptor shapes are enforced apart.
  if (version.runtime === TOOL_RUNTIMES.ILLUSTRATOR_ACTION) {
    if (typeof version.actionSet !== 'string' || !ACTION_NAME_PATTERN.test(version.actionSet)) {
      issues.push(`${at}.invalidActionSet`);
    }
    if (typeof version.actionName !== 'string' || !ACTION_NAME_PATTERN.test(version.actionName)) {
      issues.push(`${at}.invalidActionName`);
    }
    if (version.entryPoint !== undefined) {
      issues.push(`${at}.entryPointNotAllowed`);
    }
  } else {
    if (!isSafeEntryPoint(version.entryPoint)) {
      issues.push(`${at}.invalidEntryPoint`);
    }
    if (version.actionSet !== undefined || version.actionName !== undefined) {
      issues.push(`${at}.actionFieldsNotAllowed`);
    }
  }

  if (version.publishedAt !== undefined && Number.isNaN(Date.parse(version.publishedAt))) {
    issues.push(`${at}.invalidPublishedAt`);
  }
  if (version.status === TOOL_VERSION_STATUSES.PUBLISHED && version.publishedAt === undefined) {
    issues.push(`${at}.publishedAtRequired`);
  }
}

/**
 * Validate a tool registry entry.
 *
 * Returns `{ valid, issues }` so the administration UI and the backend can
 * present the same failure list instead of diverging on their own messages.
 */
export function validateToolDescriptor(descriptor) {
  const issues = [];

  if (!isPlainObject(descriptor)) {
    return { valid: false, issues: ['tool.invalid'] };
  }

  const allowed = new Set([
    'toolId', 'displayName', 'description', 'type', 'status', 'publisher', 'versions',
  ]);
  if (Object.keys(descriptor).some((key) => !allowed.has(key))) {
    issues.push('tool.unexpectedField');
  }

  if (typeof descriptor.toolId !== 'string' || !TOOL_ID_PATTERN.test(descriptor.toolId)) {
    issues.push('tool.invalidId');
  }
  if (typeof descriptor.displayName !== 'string'
    || descriptor.displayName.trim().length < 2
    || descriptor.displayName.trim().length > MAX_DISPLAY_NAME) {
    issues.push('tool.invalidDisplayName');
  }
  if (descriptor.description !== undefined
    && (typeof descriptor.description !== 'string' || descriptor.description.length > MAX_DESCRIPTION)) {
    issues.push('tool.invalidDescription');
  }
  if (!Object.values(TOOL_TYPES).includes(descriptor.type)) {
    issues.push('tool.invalidType');
  }
  if (!Object.values(TOOL_STATUSES).includes(descriptor.status)) {
    issues.push('tool.invalidStatus');
  }
  if (typeof descriptor.publisher !== 'string' || descriptor.publisher.trim() === '') {
    issues.push('tool.invalidPublisher');
  }

  if (!Array.isArray(descriptor.versions) || descriptor.versions.length === 0) {
    issues.push('tool.versionsRequired');
  } else {
    descriptor.versions.forEach((version, index) => validateVersion(version, issues, index));

    const identifiers = descriptor.versions
      .filter(isPlainObject)
      .map((version) => version.version);
    if (new Set(identifiers).size !== identifiers.length) {
      issues.push('tool.duplicateVersion');
    }

    // More than one published version would make "which one does a workstation
    // receive" ambiguous, so the registry allows at most one.
    const published = descriptor.versions
      .filter(isPlainObject)
      .filter((version) => version.status === TOOL_VERSION_STATUSES.PUBLISHED);
    if (published.length > 1) {
      issues.push('tool.multiplePublishedVersions');
    }
  }

  return { valid: issues.length === 0, issues: Array.from(new Set(issues)) };
}

/**
 * The version a workstation should receive, or null when none is publishable.
 *
 * A disabled tool resolves to null even when it still holds a published
 * version, so disabling a tool in the registry is sufficient to withdraw it
 * from every workstation without editing assignments.
 */
export function resolvePublishedVersion(descriptor) {
  if (!isPlainObject(descriptor)) return null;
  if (descriptor.status !== TOOL_STATUSES.ACTIVE) return null;
  if (!Array.isArray(descriptor.versions)) return null;

  return descriptor.versions.find((version) => (
    isPlainObject(version) && version.status === TOOL_VERSION_STATUSES.PUBLISHED
  )) || null;
}
