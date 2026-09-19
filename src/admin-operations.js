/**
 * The complete inventory of ways platform state can change.
 *
 * This module is intentionally free of any Firebase, transport, or build-time
 * environment dependency so the form layer, the test suite, and the service
 * layer can all name the same operations without one of them dragging in the
 * SDK. `src/services/admin-service.js` re-exports these and adds the transport.
 *
 * Firestore Rules close every client write, so this list is also the exhaustive
 * set of mutations reachable from the interface — which is what makes the audit
 * trail complete rather than best-effort.
 */
export const ADMIN_OPERATIONS = Object.freeze({
  CREATE_ACCOUNT: 'adminCreateAccount',
  UPDATE_ACCOUNT: 'adminUpdateAccount',
  CREATE_WORKSPACE: 'adminCreateWorkspace',
  UPDATE_WORKSPACE: 'adminUpdateWorkspace',
  CREATE_USER: 'adminCreateUser',
  UPDATE_USER_PROFILE: 'adminUpdateUserProfile',
  SET_USER_STATUS: 'adminSetUserStatus',
  UPSERT_MEMBERSHIP: 'adminUpsertMembership',
  SET_MEMBERSHIP_STATUS: 'adminSetMembershipStatus',
  UPSERT_TEAM: 'adminUpsertTeam',
  UPSERT_CUSTOM_ROLE: 'adminUpsertCustomRole',
  SET_CUSTOM_ROLE_STATUS: 'adminSetCustomRoleStatus',
  UPSERT_TOOL: 'adminUpsertTool',
  PUBLISH_TOOL_VERSION: 'adminPublishToolVersion',
  SET_TOOL_STATUS: 'adminSetToolStatus',
  UPSERT_ASSIGNMENT: 'adminUpsertAssignment',
  DELETE_ASSIGNMENT: 'adminDeleteAssignment',
  UPSERT_LICENSE: 'adminUpsertLicense',
  SET_LICENSE_STATUS: 'adminSetLicenseStatus',
  SET_DEVICE_STATUS: 'adminSetDeviceStatus',
});

/** Operations any active account member may perform from their workstation. */
export const WORKSTATION_OPERATIONS = Object.freeze({
  ENROLL: 'enrollWorkstation',
  RESOLVE_CATALOG: 'resolveWorkstationCatalog',
  RECORD_EXECUTION: 'recordWorkstationExecution',
});

export const CALLABLE_NAMES = Object.freeze([
  ...Object.values(ADMIN_OPERATIONS),
  ...Object.values(WORKSTATION_OPERATIONS),
]);
