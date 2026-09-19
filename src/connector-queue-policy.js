import {
  validateDeliveryAckMessage,
  validateExecutionResultMessage,
} from './connector-contract.js';

/**
 * Pure, in-memory policy for a future connector delivery queue.
 *
 * This module owns no storage, transport, host API, Firebase, filesystem, or
 * timer. The caller supplies time explicitly, making every transition
 * deterministic and safe to test before a real connector exists.
 */
export const MAX_QUEUE_EVENTS = 100;
export const MAX_QUEUE_BYTES = 1024 * 1024;
export const QUEUE_RETENTION_MS = 72 * 60 * 60 * 1000;

function assertTimestamp(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError('nowMs must be a non-negative safe integer.');
  }
}

function serializedSize(message) {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

function canonicalMessage(message) {
  return JSON.stringify(Object.fromEntries(
    Object.keys(message)
      .sort()
      .map((key) => [key, message[key]]),
  ));
}

function cloneMessage(message) {
  return Object.freeze({ ...message });
}

function queueEntries(queue) {
  if (!queue || !Array.isArray(queue.entries)) {
    throw new TypeError('queue must be created by createConnectorQueueState().');
  }

  return queue.entries;
}

function isExpired(entry, nowMs) {
  return Date.parse(entry.message.occurredAt) + QUEUE_RETENTION_MS <= nowMs;
}

function makeQueue(entries) {
  return Object.freeze({ entries: Object.freeze(entries) });
}

/** Create an empty queue state. It is not persisted anywhere. */
export function createConnectorQueueState() {
  return makeQueue([]);
}

/** Return the current count and serialized message footprint. */
export function getConnectorQueueMetrics(queue) {
  const entries = queueEntries(queue);
  return Object.freeze({
    eventCount: entries.length,
    byteSize: entries.reduce((total, entry) => total + entry.serializedBytes, 0),
  });
}

/**
 * Remove events older than the fixed retention period.
 * The original state remains unchanged.
 */
export function purgeExpiredConnectorEvents(queue, nowMs) {
  assertTimestamp(nowMs);
  const entries = queueEntries(queue);
  const retained = entries.filter((entry) => !isExpired(entry, nowMs));

  return retained.length === entries.length ? queue : makeQueue(retained);
}

/**
 * Validate and enqueue a single execution result. The result is one of:
 * accepted, duplicate, conflict, expired, full, or invalid.
 */
export function enqueueConnectorExecution(queue, message, nowMs) {
  assertTimestamp(nowMs);
  const activeQueue = purgeExpiredConnectorEvents(queue, nowMs);
  const validation = validateExecutionResultMessage(message);
  if (!validation.valid) {
    return Object.freeze({ queue: activeQueue, outcome: 'invalid', issues: validation.issues });
  }

  const entries = queueEntries(activeQueue);
  const existing = entries.find((entry) => entry.message.messageId === message.messageId);
  if (existing) {
    const outcome = canonicalMessage(existing.message) === canonicalMessage(message) ? 'duplicate' : 'conflict';
    return Object.freeze({ queue: activeQueue, outcome, issues: Object.freeze([]) });
  }

  if (Date.parse(message.occurredAt) + QUEUE_RETENTION_MS <= nowMs) {
    return Object.freeze({ queue: activeQueue, outcome: 'expired', issues: Object.freeze([]) });
  }

  const messageBytes = serializedSize(message);
  const { eventCount, byteSize } = getConnectorQueueMetrics(activeQueue);
  if (eventCount >= MAX_QUEUE_EVENTS || byteSize + messageBytes > MAX_QUEUE_BYTES) {
    return Object.freeze({ queue: activeQueue, outcome: 'full', issues: Object.freeze([]) });
  }

  const entry = Object.freeze({
    message: cloneMessage(message),
    queuedAt: nowMs,
    serializedBytes: messageBytes,
  });
  return Object.freeze({
    queue: makeQueue([...entries, entry]),
    outcome: 'accepted',
    issues: Object.freeze([]),
  });
}

/**
 * Apply a minimal backend acknowledgement after its own validation.
 * Both accepted and rejected delivery statuses remove the item: a rejection
 * must not make Illustrator or the artist retry indefinitely.
 */
export function applyConnectorDeliveryAck(queue, acknowledgement, nowMs) {
  assertTimestamp(nowMs);
  const activeQueue = purgeExpiredConnectorEvents(queue, nowMs);
  const validation = validateDeliveryAckMessage(acknowledgement);
  if (!validation.valid) {
    return Object.freeze({ queue: activeQueue, outcome: 'invalid_ack', issues: validation.issues });
  }

  const entries = queueEntries(activeQueue);
  const matchingEntry = entries.find((entry) => entry.message.messageId === acknowledgement.messageId);
  if (!matchingEntry) {
    return Object.freeze({ queue: activeQueue, outcome: 'unknown_message', issues: Object.freeze([]) });
  }

  const queueAfterAcknowledgement = makeQueue(
    entries.filter((entry) => entry.message.messageId !== acknowledgement.messageId),
  );
  const outcome = acknowledgement.deliveryStatus === 'accepted' ? 'delivered' : 'discarded_rejected';

  return Object.freeze({ queue: queueAfterAcknowledgement, outcome, issues: Object.freeze([]) });
}
