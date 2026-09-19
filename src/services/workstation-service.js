import {
  ACTION_BY_REGISTRY_ID,
  REGISTRY_ID_BY_ENGINE_ID,
} from '../product-contract.js';
import { validateExecutionEvent } from '../execution-contract.js';
import {
  callAdminOperation,
  isAdminBackendReady,
  createOperationId,
  WORKSTATION_OPERATIONS,
} from './admin-service.js';

export const INSTALLATION_STORAGE_KEY = 'operations-suite.installation-id';

/**
 * The identity of a workstation.
 *
 * A station is identified by a random value generated once in this browser
 * profile and kept in local storage. That choice is deliberate and is the
 * whole device model in one line: a MAC address, hostname, or serial number
 * cannot be rotated, leaks information about the machine, and is trivially
 * forged, so none of them may ever be the root of workstation trust. An
 * installation identifier can be revoked by an administrator and regenerated
 * by the operator, and it says nothing about the hardware.
 *
 * It is not a secret and grants nothing on its own: enrolment still requires a
 * signed-in member, and the station stays `pending` until an administrator
 * approves it.
 */
function browserStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomInstallationId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ws-${hex}`;
}

export function getInstallationId() {
  const storage = browserStorage();
  if (!storage) return randomInstallationId();

  try {
    const existing = storage.getItem(INSTALLATION_STORAGE_KEY);
    if (typeof existing === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(existing)) return existing;

    const created = randomInstallationId();
    storage.setItem(INSTALLATION_STORAGE_KEY, created);
    return created;
  } catch {
    // A browser that refuses storage still gets a working session; the station
    // simply enrols again next time instead of reusing an approval.
    return randomInstallationId();
  }
}

/**
 * Rotate the workstation identity.
 *
 * Rotation is the counterpart to revocation: an administrator can revoke a
 * station, and the operator can present a new one for approval without any
 * hardware change or reinstall.
 */
export function rotateInstallationId() {
  const storage = browserStorage();
  const created = randomInstallationId();
  try {
    storage?.setItem(INSTALLATION_STORAGE_KEY, created);
  } catch {
    // Ignored for the same reason as above.
  }
  return created;
}

/**
 * Report the host platform as a coarse, closed value.
 *
 * `windows` or `macos` is enough to tell an administrator which Illustrator
 * build a station runs. A full user-agent string would add a fingerprint with
 * no operational value, so it is never sent.
 */
export function detectPlatform() {
  if (typeof navigator === 'undefined') return 'windows';
  const hint = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac/i.test(hint) ? 'macos' : 'windows';
}

export function defaultWorkstationLabel(platform = detectPlatform()) {
  return platform === 'macos' ? 'macOS workstation' : 'Windows workstation';
}

export async function enrollWorkstation({ accountId, workspaceId, label, platform }) {
  return callAdminOperation(WORKSTATION_OPERATIONS.ENROLL, {
    operationId: createOperationId(),
    accountId,
    workspaceId,
    installationId: getInstallationId(),
    label: label || defaultWorkstationLabel(platform),
    platform: platform || detectPlatform(),
  });
}

/**
 * Ask the backend which tools this operator may run on this station.
 *
 * The answer is authoritative: it is produced by the shared resolver running
 * with Admin credentials over the registry, the assignments, the licenses, and
 * the device record. The browser never computes its own catalog, so a tampered
 * client can hide a tool from itself but can never grant one.
 */
export async function fetchAuthorizedCatalog({ accountId, workspaceId, deviceId }) {
  if (!isAdminBackendReady() || !accountId) {
    return { accountId: accountId || '', workspaceId: workspaceId || null, deviceId: deviceId || null, deviceAuthorized: false, deviceReason: 'device.unknown', tools: [] };
  }

  return callAdminOperation(WORKSTATION_OPERATIONS.RESOLVE_CATALOG, {
    accountId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(deviceId ? { deviceId } : {}),
  });
}

/**
 * Convert one sanitized local-bridge result into a persistable execution.
 *
 * The bridge speaks the connector contract (`execution.result.v1`) and the
 * platform stores `ExecutionEvent V1`. The two are deliberately different: the
 * connector message knows nothing about accounts, workspaces, or devices, and
 * the stored event must not carry anything the connector saw. This function is
 * the only place they meet, and it adds exactly the four scope identifiers the
 * signed-in session already holds — never a path, a document name, or a host
 * error message.
 */
export function toExecutionEvent(result, scope, catalogTools = []) {
  if (!result || typeof result !== 'object') return null;

  const toolId = REGISTRY_ID_BY_ENGINE_ID[result.tool];
  if (!toolId || !scope?.accountId || !scope?.workspaceId || !scope?.deviceId) return null;

  const authorized = catalogTools.find((tool) => tool.toolId === toolId && tool.authorized);
  if (!authorized?.version) return null;

  const completedAtMs = Date.parse(result.occurredAt);
  if (!Number.isFinite(completedAtMs)) return null;
  const durationMs = Number.isSafeInteger(result.durationMs) ? result.durationMs : 0;

  const status = result.result === 'success'
    ? 'success'
    : result.result === 'cancelled' ? 'cancelled' : 'failure';

  const event = {
    executionId: result.messageId,
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    deviceId: scope.deviceId,
    toolId,
    toolVersion: authorized.version,
    action: ACTION_BY_REGISTRY_ID[toolId] || result.action,
    status,
    startedAt: new Date(completedAtMs - durationMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs,
    source: 'local_bridge',
  };

  if (status !== 'success') {
    event.errorCode = result.errorCode || (status === 'cancelled' ? 'ACTION_CANCELLED' : 'PROCESSING_FAILED');
  }

  return validateExecutionEvent(event).valid ? event : null;
}

/**
 * Persist a finished run.
 *
 * `executionId` carries over from the bridge message, so the same run
 * delivered twice is stored once. That is what allows the web app to poll the
 * bridge on a timer without inflating any counter.
 */
export async function recordExecution(event) {
  if (!isAdminBackendReady() || !event) return null;
  return callAdminOperation(WORKSTATION_OPERATIONS.RECORD_EXECUTION, event);
}
