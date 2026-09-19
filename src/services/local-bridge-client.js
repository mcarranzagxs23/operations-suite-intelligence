import { validateConnectorStatusMessage, validateExecutionResultMessage } from '../connector-contract.js';

export const DEFAULT_LOCAL_BRIDGE_URL = import.meta.env.VITE_LOCAL_BRIDGE_URL || 'http://127.0.0.1:4317';
const REQUEST_TIMEOUT_MS = 3000;

function bridgeUrl(path) {
  return new URL(path, `${DEFAULT_LOCAL_BRIDGE_URL}/`).toString();
}

async function request(path, { method = 'GET', token = '', body } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(bridgeUrl(path), {
      method,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new LocalBridgeError(payload?.error?.code || 'BRIDGE_UNAVAILABLE');
    }
    return payload;
  } catch (error) {
    if (error instanceof LocalBridgeError) throw error;
    if (error?.name === 'AbortError') throw new LocalBridgeError('BRIDGE_TIMEOUT');
    throw new LocalBridgeError('BRIDGE_UNAVAILABLE');
  } finally {
    window.clearTimeout(timeout);
  }
}

export class LocalBridgeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LocalBridgeError';
    this.code = code;
  }
}

export async function checkLocalBridgeHealth() {
  const payload = await request('/v1/health');
  if (!payload || payload.apiVersion !== 'v1' || payload.transport !== 'loopback') {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  return payload;
}

export async function pairLocalBridge(pairingCode) {
  const payload = await request('/v1/pair', {
    method: 'POST',
    body: { pairingCode: String(pairingCode || '').trim() },
  });
  if (!payload?.session?.accessToken || !payload?.session?.expiresAt || !validateConnectorStatusMessage(payload.status).valid) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  return payload;
}

export async function getLocalBridgeStatus(token) {
  const payload = await request('/v1/status', { token });
  if (!validateConnectorStatusMessage(payload?.status).valid) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  const host = payload?.host;
  if (!host || !['connected', 'disconnected'].includes(host.illustrator)
    || !['loaded', 'not_loaded'].includes(host.panel)
    || !['available', 'unavailable'].includes(host.document)) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  return payload;
}

/**
 * Hand the backend-resolved catalog to the loopback bridge.
 *
 * The bridge keeps no registry and makes no authorization decision of its own;
 * it serves the Illustrator panel exactly what this call publishes. That is
 * what makes an administrator's grant visible inside Illustrator, and why
 * stopping the bridge withdraws the catalog rather than falling back to a
 * local list of tools.
 */
export async function publishLocalBridgeCatalog(token, catalog) {
  const payload = await request('/v1/catalog', { method: 'PUT', token, body: catalog });
  if (!payload?.catalog || !Array.isArray(payload.catalog.tools)) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  return payload.catalog;
}

/**
 * Read the one ephemeral execution result retained by the loopback bridge.
 * The response is already privacy-minimized by the bridge and is validated
 * again at the Web App boundary before it reaches the UI.
 */
export async function getLatestLocalBridgeExecution(token) {
  const payload = await request('/v1/executions/latest', { token });
  if (!payload || !Object.hasOwn(payload, 'execution')) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  if (payload.execution !== null && !validateExecutionResultMessage(payload.execution).valid) {
    throw new LocalBridgeError('BRIDGE_RESPONSE_INVALID');
  }
  return payload;
}
