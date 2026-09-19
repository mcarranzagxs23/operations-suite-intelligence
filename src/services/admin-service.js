import { CALLABLE_NAMES } from '../admin-operations.js';
import { getFirebaseServices, isFirebaseConfigured, isFirebaseEmulatorMode } from './firebase.js';

const ENABLED = import.meta.env.VITE_ADMIN_FUNCTIONS_ENABLED === 'true';

export {
  ADMIN_OPERATIONS,
  WORKSTATION_OPERATIONS,
} from '../admin-operations.js';

/**
 * Where administrative mutations are being sent.
 *
 * `emulator-ready` and `ready` are the same code path against different
 * infrastructure: the callable names, payloads, validation, and audit writes
 * are identical, and only the transport target differs. Reporting them
 * separately keeps the interface honest about which one an operator is looking
 * at, without maintaining two implementations that could diverge.
 */
export function getAdminBackendState() {
  if (!isFirebaseConfigured) return 'firebase-not-configured';
  if (!ENABLED) return 'functions-not-enabled';
  return isFirebaseEmulatorMode ? 'emulator-ready' : 'ready';
}

export function isAdminBackendReady() {
  const state = getAdminBackendState();
  return state === 'ready' || state === 'emulator-ready';
}

/**
 * A stable identifier for one administrative intent.
 *
 * The backend stores it and refuses a second, different payload under the same
 * identifier, so a double-submitted form or a retried network call produces
 * one account and not two.
 */
export function createOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Administrative and workstation mutations are callable Cloud Functions only.
 * This module never imports the Firebase Admin SDK and never writes directly
 * to Firestore.
 */
export async function callAdminOperation(operation, data) {
  if (!CALLABLE_NAMES.includes(operation)) {
    throw new Error('admin-operation-not-supported');
  }
  if (!isAdminBackendReady()) {
    throw new Error('admin-backend-not-configured');
  }

  const { functions, functionsApi } = await getFirebaseServices();
  const callable = functionsApi.httpsCallable(functions, operation);
  const response = await callable(data);
  return response.data;
}

/** Convenience wrapper that supplies a fresh idempotency key. */
export async function submitAdminOperation(operation, values) {
  return callAdminOperation(operation, { ...values, operationId: createOperationId() });
}
