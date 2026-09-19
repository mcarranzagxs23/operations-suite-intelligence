/**
 * Immutable product and execution identifiers.
 *
 * These are product names and execution-contract values, not translated UI
 * copy. They must remain identical in Spanish and English so the web UI,
 * local connector, and future telemetry contract refer to the same actions.
 */
export const TOOL_CONTRACT = Object.freeze({
  cleanVector: Object.freeze({
    productName: 'Clean Vector PRO',
    action: 'CLEAN ART',
    eventType: 'CLEAN_VECTOR_EXECUTION',
  }),
  sepMaker: Object.freeze({
    productName: 'Sep Maker PRO',
    action: 'Apply',
    eventType: 'SEP_MAKER_EXECUTION',
  }),
});

/**
 * The same two products carry three identifiers, and conflating them would be
 * a security defect rather than an inconvenience:
 *
 *   - a REGISTRY ID names an administratively registered tool
 *     (`clean-vector-pro`). It is what an assignment, a license, and a
 *     telemetry row refer to.
 *   - an ENGINE ID names something the Illustrator host adapter is willing to
 *     open (`clean_vector_pro`). The adapter holds a closed allow-list of
 *     these, so the registry can withdraw a tool but can never introduce a new
 *     execution path by inventing an identifier.
 *
 * Mapping them in one place is what lets the registry stay administratively
 * editable while the adapter's allow-list stays fixed.
 */
export const TOOL_REGISTRY_IDS = Object.freeze({
  cleanVector: 'clean-vector-pro',
  sepMaker: 'sepmaker-pro',
});

export const ENGINE_IDS = Object.freeze({
  cleanVector: 'clean_vector_pro',
  sepMaker: 'sep_maker_pro',
});

export const ENGINE_ID_BY_REGISTRY_ID = Object.freeze({
  [TOOL_REGISTRY_IDS.cleanVector]: ENGINE_IDS.cleanVector,
  [TOOL_REGISTRY_IDS.sepMaker]: ENGINE_IDS.sepMaker,
});

export const REGISTRY_ID_BY_ENGINE_ID = Object.freeze({
  [ENGINE_IDS.cleanVector]: TOOL_REGISTRY_IDS.cleanVector,
  [ENGINE_IDS.sepMaker]: TOOL_REGISTRY_IDS.sepMaker,
});

export const ACTION_BY_REGISTRY_ID = Object.freeze({
  [TOOL_REGISTRY_IDS.cleanVector]: TOOL_CONTRACT.cleanVector.action,
  [TOOL_REGISTRY_IDS.sepMaker]: TOOL_CONTRACT.sepMaker.action,
});

export const PRODUCT_NAME_BY_REGISTRY_ID = Object.freeze({
  [TOOL_REGISTRY_IDS.cleanVector]: TOOL_CONTRACT.cleanVector.productName,
  [TOOL_REGISTRY_IDS.sepMaker]: TOOL_CONTRACT.sepMaker.productName,
});

export const EVENT_TYPE_BY_REGISTRY_ID = Object.freeze({
  [TOOL_REGISTRY_IDS.cleanVector]: TOOL_CONTRACT.cleanVector.eventType,
  [TOOL_REGISTRY_IDS.sepMaker]: TOOL_CONTRACT.sepMaker.eventType,
});
