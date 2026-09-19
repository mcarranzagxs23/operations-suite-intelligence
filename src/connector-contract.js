import { TOOL_CONTRACT } from './product-contract.js';

/**
 * Pure protocol contract for a future local connector.
 *
 * This module intentionally has no transport, storage, Adobe host bridge API, Firebase,
 * filesystem, or credential behavior. It only validates an allow-listed,
 * privacy-minimized messages before any future connector could queue them.
 */
export const CONNECTOR_SCHEMA_VERSION = 'v1';
export const CONNECTOR_STATUS_MESSAGE_TYPE = 'connector.status.v1';
export const EXECUTION_RESULT_MESSAGE_TYPE = 'execution.result.v1';
export const DELIVERY_ACK_MESSAGE_TYPE = 'delivery.ack.v1';
export const MAX_EXECUTION_EVENT_BYTES = 2048;

export const CONNECTOR_TOOLS = Object.freeze({
  cleanVector: 'clean_vector_pro',
  sepMaker: 'sep_maker_pro',
});

export const EXECUTION_RESULTS = Object.freeze(['success', 'failure', 'cancelled']);
export const CONNECTOR_STATES = Object.freeze(['not_installed', 'offline', 'ready', 'degraded']);
export const PAIRING_STATES = Object.freeze(['not_enrolled', 'pending', 'approved', 'revoked']);
export const CONNECTOR_CAPABILITIES = Object.freeze(['host_panel', 'execution_result', 'offline_queue']);
export const DELIVERY_STATUSES = Object.freeze(['accepted', 'rejected']);
export const EXECUTION_ERROR_CODES = Object.freeze([
  'ACTION_CANCELLED',
  'DOCUMENT_UNAVAILABLE',
  'HOST_UNAVAILABLE',
  'PROCESSING_FAILED',
  'VALIDATION_FAILED',
]);

const executionToolActions = Object.freeze({
  [CONNECTOR_TOOLS.cleanVector]: TOOL_CONTRACT.cleanVector.action,
  [CONNECTOR_TOOLS.sepMaker]: TOOL_CONTRACT.sepMaker.action,
});

const executionResultAllowedKeys = new Set([
  'schemaVersion',
  'type',
  'messageId',
  'occurredAt',
  'tool',
  'action',
  'result',
  'durationMs',
  'errorCode',
]);

const connectorStatusAllowedKeys = new Set([
  'schemaVersion',
  'type',
  'messageId',
  'occurredAt',
  'connectorVersion',
  'state',
  'pairingState',
  'capabilities',
]);

const deliveryAckAllowedKeys = new Set([
  'schemaVersion',
  'type',
  'messageId',
  'occurredAt',
  'deliveryStatus',
]);

const opaqueIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

function hasOnlyAllowedKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function serializedSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateEnvelope(value, { type, allowedKeys }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { issues: ['message.invalid'] };
  }

  const issues = [];
  if (!hasOnlyAllowedKeys(value, allowedKeys)) issues.push('fields.unexpected');
  if (value.schemaVersion !== CONNECTOR_SCHEMA_VERSION) issues.push('schema.invalid');
  if (value.type !== type) issues.push('type.invalid');
  if (!opaqueIdPattern.test(value.messageId ?? '')) issues.push('messageId.invalid');
  if (!isIsoTimestamp(value.occurredAt)) issues.push('occurredAt.invalid');
  if (serializedSize(value) > MAX_EXECUTION_EVENT_BYTES) issues.push('message.tooLarge');

  return { issues };
}

/**
 * Validate an execution result message without persisting or transmitting it.
 * The result exposes stable issue codes so a future UI can translate them
 * without leaking document or runtime diagnostics.
 */
export function validateExecutionResultMessage(value) {
  const { issues } = validateEnvelope(value, {
    type: EXECUTION_RESULT_MESSAGE_TYPE,
    allowedKeys: executionResultAllowedKeys,
  });

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, issues };
  }

  if (!(value.tool in executionToolActions)) issues.push('tool.invalid');
  if (executionToolActions[value.tool] !== value.action) issues.push('action.invalid');
  if (!EXECUTION_RESULTS.includes(value.result)) issues.push('result.invalid');
  if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0) issues.push('duration.invalid');

  const hasErrorCode = Object.hasOwn(value, 'errorCode');
  if (value.result === 'success' && hasErrorCode) issues.push('errorCode.unexpected');
  if (value.result !== 'success' && !EXECUTION_ERROR_CODES.includes(value.errorCode)) {
    issues.push('errorCode.invalid');
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Validate non-sensitive technical state reported by a future local connector.
 * It never accepts machine identity, path, user, or document information.
 */
export function validateConnectorStatusMessage(value) {
  const { issues } = validateEnvelope(value, {
    type: CONNECTOR_STATUS_MESSAGE_TYPE,
    allowedKeys: connectorStatusAllowedKeys,
  });

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, issues };
  }

  if (typeof value.connectorVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.connectorVersion)) {
    issues.push('connectorVersion.invalid');
  }
  if (!CONNECTOR_STATES.includes(value.state)) issues.push('state.invalid');
  if (!PAIRING_STATES.includes(value.pairingState)) issues.push('pairingState.invalid');
  if (!Array.isArray(value.capabilities)
    || value.capabilities.length > CONNECTOR_CAPABILITIES.length
    || new Set(value.capabilities).size !== value.capabilities.length
    || !value.capabilities.every((capability) => CONNECTOR_CAPABILITIES.includes(capability))) {
    issues.push('capabilities.invalid');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Validate a future backend delivery acknowledgement without accepting details
 * that could disclose internal policy, diagnostics, or account data.
 */
export function validateDeliveryAckMessage(value) {
  const { issues } = validateEnvelope(value, {
    type: DELIVERY_ACK_MESSAGE_TYPE,
    allowedKeys: deliveryAckAllowedKeys,
  });

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, issues };
  }

  if (!DELIVERY_STATUSES.includes(value.deliveryStatus)) issues.push('deliveryStatus.invalid');

  return { valid: issues.length === 0, issues };
}
