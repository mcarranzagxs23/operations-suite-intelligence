import {
  collectTruncation,
  MAX_AGGREGATES,
  MAX_AUDIT_ENTRIES,
  MAX_COLLECTION,
  MAX_EXECUTIONS,
} from '../read-limits.js';
import { readScopedData } from '../platform-read-policy.js';
import { getFirebaseServices, isFirebaseConfigured } from './firebase.js';

/**
 * Read the persisted platform state the signed-in session is allowed to see.
 *
 * Two rules shape this module.
 *
 * First, it only ever reads. Every mutation goes through a callable Cloud
 * Function, and Firestore Rules close client writes completely, so nothing
 * here can change platform state even if it were called incorrectly.
 *
 * Second, it does not decide what the session may see. Firestore Rules do. A
 * query that the rules refuse resolves to an empty collection rather than
 * throwing, because a Team Leader legitimately cannot list account-wide
 * devices and that must render as "nothing to show", not as a broken screen.
 * Other failures stay observable to the App, which presents a safe error
 * rather than claiming the platform has no records.
 */

function emptySnapshot() {
  return Object.freeze({
    accounts: [],
    users: [],
    tools: [],
    workspaces: [],
    members: [],
    teams: [],
    devices: [],
    customRoles: [],
    assignments: [],
    licenses: [],
    executions: [],
    dailyAggregates: [],
    auditLogs: [],
    platformAuditLogs: [],
    loadedAt: null,
    partial: true,
    truncated: [],
  });
}

/**
 * Firestore timestamps arrive as SDK objects. The interface only ever formats
 * them, so they are normalized to ISO strings at the boundary and no view has
 * to know which SDK produced them.
 */
function asIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry) : [];
}

/**
 * Run a scoped read, returning an empty result when the rules refuse it.
 *
 * A denied read is an expected outcome of a correctly scoped role, not an
 * error condition, so it must not surface as a failed screen.
 */
async function readSafely(loader, fallback = []) {
  return readScopedData(loader, fallback);
}

function accountDocument(snapshot) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    name: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    status: typeof data.status === 'string' ? data.status : 'unknown',
    defaultLocale: data.defaultLocale === 'en' ? 'en' : 'es',
    createdAt: asIsoString(data.createdAt),
  });
}

function userDocument(snapshot) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    email: typeof data.email === 'string' ? data.email : '',
    status: typeof data.status === 'string' ? data.status : 'active',
    locale: data.locale === 'en' ? 'en' : 'es',
    createdAt: asIsoString(data.createdAt),
  });
}

function toolDocument(snapshot) {
  const data = snapshot.data() || {};
  const versions = Array.isArray(data.versions) ? data.versions : [];
  return Object.freeze({
    toolId: typeof data.toolId === 'string' ? data.toolId : snapshot.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    description: typeof data.description === 'string' ? data.description : '',
    type: typeof data.type === 'string' ? data.type : 'internal_tool',
    status: typeof data.status === 'string' ? data.status : 'disabled',
    publisher: typeof data.publisher === 'string' ? data.publisher : '',
    versions: Object.freeze(versions.map((version) => Object.freeze({
      version: version.version,
      status: version.status,
      runtime: version.runtime,
      checksumSha256: typeof version.checksumSha256 === 'string' ? version.checksumSha256 : '',
      publishedAt: asIsoString(version.publishedAt),
    }))),
    publishedVersion: versions.find((version) => version.status === 'published')?.version || null,
    updatedAt: asIsoString(data.updatedAt),
  });
}

function workspaceDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    name: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    code: typeof data.code === 'string' ? data.code : '',
    status: typeof data.status === 'string' ? data.status : 'unknown',
    createdAt: asIsoString(data.createdAt),
  });
}

function memberDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    displayName: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    role: typeof data.role === 'string' ? data.role : 'unassigned',
    customRoleId: typeof data.customRoleId === 'string' ? data.customRoleId : null,
    status: typeof data.status === 'string' ? data.status : 'unknown',
    allWorkspaces: data.allWorkspaces === true,
    workspaceIds: Object.freeze(asStringArray(data.workspaceIds)),
    teamIds: Object.freeze(asStringArray(data.teamIds)),
    updatedAt: asIsoString(data.updatedAt),
  });
}

function teamDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    name: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    leaderUids: Object.freeze(asStringArray(data.leaderUids)),
    memberUids: Object.freeze(asStringArray(data.memberUids)),
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : null,
    status: typeof data.status === 'string' ? data.status : 'unknown',
  });
}

function deviceDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    label: typeof data.label === 'string' ? data.label : snapshot.id,
    platform: typeof data.platform === 'string' ? data.platform : 'windows',
    status: typeof data.status === 'string' ? data.status : 'pending',
    assignedUid: typeof data.assignedUid === 'string' ? data.assignedUid : '',
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : '',
    enrolledAt: asIsoString(data.enrolledAt),
    lastSeenAt: asIsoString(data.lastSeenAt),
    reviewedAt: asIsoString(data.reviewedAt),
  });
}

function customRoleDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  const grants = Array.isArray(data.grants) ? data.grants : [];
  return Object.freeze({
    id: snapshot.id,
    accountId,
    roleId: typeof data.roleId === 'string' ? data.roleId : snapshot.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : snapshot.id,
    status: typeof data.status === 'string' ? data.status : 'disabled',
    grants: Object.freeze(grants.map((grant) => Object.freeze({
      permission: grant.permission,
      scope: grant.scope,
    }))),
  });
}

function assignmentDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    toolId: typeof data.toolId === 'string' ? data.toolId : '',
    target: typeof data.target === 'string' ? data.target : '',
    targetId: typeof data.targetId === 'string' ? data.targetId : null,
    effect: typeof data.effect === 'string' ? data.effect : 'deny',
    note: typeof data.note === 'string' ? data.note : '',
    updatedAt: asIsoString(data.updatedAt),
  });
}

function licenseDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    toolId: typeof data.toolId === 'string' ? data.toolId : '',
    scope: typeof data.scope === 'string' ? data.scope : 'account',
    scopeId: typeof data.scopeId === 'string' ? data.scopeId : null,
    seats: Number.isSafeInteger(data.seats) ? data.seats : null,
    status: typeof data.status === 'string' ? data.status : 'suspended',
    startsAt: typeof data.startsAt === 'string' ? data.startsAt : null,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
  });
}

function executionDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : '',
    toolId: typeof data.toolId === 'string' ? data.toolId : '',
    toolVersion: typeof data.toolVersion === 'string' ? data.toolVersion : '',
    action: typeof data.action === 'string' ? data.action : '',
    status: typeof data.status === 'string' ? data.status : 'failure',
    errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
    durationMs: Number.isSafeInteger(data.durationMs) ? data.durationMs : 0,
    completedAt: typeof data.completedAt === 'string' ? data.completedAt : null,
    receivedAt: asIsoString(data.receivedAt),
    source: typeof data.source === 'string' ? data.source : 'local_bridge',
  });
}

function aggregateDocument(snapshot, accountId) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : '',
    day: typeof data.day === 'string' ? data.day : '',
    totalRuns: Number.isSafeInteger(data.totalRuns) ? data.totalRuns : 0,
    successfulRuns: Number.isSafeInteger(data.successfulRuns) ? data.successfulRuns : 0,
    failedRuns: Number.isSafeInteger(data.failedRuns) ? data.failedRuns : 0,
    cancelledRuns: Number.isSafeInteger(data.cancelledRuns) ? data.cancelledRuns : 0,
    totalDurationMs: Number.isSafeInteger(data.totalDurationMs) ? data.totalDurationMs : 0,
    byTool: Object.freeze({ ...(data.byTool && typeof data.byTool === 'object' ? data.byTool : {}) }),
  });
}

function auditDocument(snapshot, accountId = null) {
  const data = snapshot.data() || {};
  return Object.freeze({
    id: snapshot.id,
    accountId,
    action: typeof data.action === 'string' ? data.action : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid : '',
    targetType: typeof data.targetType === 'string' ? data.targetType : '',
    targetId: typeof data.targetId === 'string' ? data.targetId : '',
    result: typeof data.result === 'string' ? data.result : 'success',
    createdAt: asIsoString(data.createdAt),
  });
}

/**
 * Firestore evaluates a rule against every document a query would return, so
 * an unfiltered query fails as a whole the moment one document is out of
 * scope. Every scoped read below therefore carries the filter that matches its
 * rule, rather than relying on the rule to trim the result — rules authorize,
 * they do not filter.
 *
 * Firestore caps an `in` comparison at thirty values. A membership with more
 * assigned workspaces than that is read for its first thirty; the interface
 * reports the snapshot as partial rather than quietly showing less.
 */
const MAX_IN_VALUES = 30;

/**
 * Load everything the current session may read for one active account.
 *
 * The read happens in two phases, and the reason is not performance.
 *
 * Phase one asks the two questions the rest of the reads depend on: which
 * workspaces are active, and which teams does the caller belong to. Neither
 * can be taken from the session — the membership index the browser holds
 * carries no team, and an archived workspace would silently break every
 * later query, because Firestore evaluates a rule against every document a
 * query would return and refuses the query as a whole when one document is
 * out of scope.
 *
 * Phase two reads the rest with filters derived from phase one, so each query
 * asks only for what its rule can authorize. Rules authorize; they do not
 * filter.
 *
 * A Super Administrator additionally receives the platform-wide collections —
 * accounts, sign-in identities, the tool registry, and the platform audit
 * trail — because their console has to administer all of them. Those queries
 * return nothing for every other role, enforced by the rules rather than by
 * this code.
 */
export async function loadPlatformSnapshot({
  accountId,
  uid = '',
  installationId = '',
  role = 'unassigned',
  isSuperAdmin = false,
  allWorkspaces = false,
  workspaceIds = [],
} = {}) {
  if (!isFirebaseConfigured) return emptySnapshot();

  const services = await getFirebaseServices();
  if (!services) return emptySnapshot();

  const { db, firestoreApi } = services;
  const {
    collection, doc, getDoc, getDocs, limit, orderBy, query, where,
  } = firestoreApi;

  const accountReference = accountId ? doc(db, 'accounts', accountId) : null;
  const scoped = (name, extraConstraints = []) => (
    accountReference
      ? readSafely(async () => {
        const snapshot = await getDocs(query(collection(accountReference, name), ...extraConstraints));
        return snapshot.docs;
      })
      : Promise.resolve([])
  );
  const scopedDocuments = (name, ids) => (
    accountReference && ids.length
      ? readSafely(async () => {
        const snapshots = await Promise.all(ids.slice(0, MAX_COLLECTION).map((id) => (
          getDoc(doc(collection(accountReference, name), id)).catch(() => null)
        )));
        return snapshots.filter((snapshot) => snapshot?.exists());
      })
      : Promise.resolve([])
  );

  const readsEverything = isSuperAdmin || allWorkspaces;

  /* -- phase one: the caller's own scope ---------------------------- */

  const [ownMemberDocs, workspaceDocs] = await Promise.all([
    isSuperAdmin || !uid ? Promise.resolve([]) : scopedDocuments('members', [uid]),
    readsEverything
      ? scoped('workspaces', [limit(MAX_COLLECTION)])
      : scopedDocuments('workspaces', workspaceIds),
  ]);

  const workspaces = workspaceDocs.map((snapshot) => workspaceDocument(snapshot, accountId));
  const ownMembership = ownMemberDocs.length
    ? memberDocument(ownMemberDocs[0], accountId)
    : null;
  const teamIds = ownMembership ? [...ownMembership.teamIds] : [];

  // Telemetry and aggregates are keyed on workspace, and their rules require
  // the workspace to be active. Filtering on the active set is what keeps one
  // archived workspace from taking every metric away from an operator.
  const activeWorkspaceIds = workspaces
    .filter((workspace) => workspace.status === 'active')
    .map((workspace) => workspace.id);
  const scopeIds = activeWorkspaceIds.slice(0, MAX_IN_VALUES);
  const partial = activeWorkspaceIds.length > MAX_IN_VALUES;

  const workspaceFilter = isSuperAdmin
    ? []
    : scopeIds.length
      ? [where('workspaceId', 'in', scopeIds)]
      : null;

  const telemetryConstraints = role === 'artist'
    ? null
    : workspaceFilter
      ? [...workspaceFilter, orderBy('receivedAt', 'desc'), limit(MAX_EXECUTIONS)]
      : null;
  const aggregateConstraints = workspaceFilter
    ? [...workspaceFilter, orderBy('day', 'desc'), limit(MAX_AGGREGATES)]
    : null;

  // An Artist may list raw telemetry only when Firestore can prove both that
  // it belongs to that person and that it belongs to an assigned workspace.
  // Querying each known workspace keeps that proof explicit without asking
  // Firestore to enumerate data outside the artist's scope.
  const artistTelemetryDocs = role === 'artist' && uid && accountReference
    ? readSafely(async () => {
      const snapshots = await Promise.all(activeWorkspaceIds.slice(0, MAX_COLLECTION).map((workspaceId) => (
        getDocs(query(
          collection(accountReference, 'telemetry'),
          where('actorUid', '==', uid),
          where('workspaceId', '==', workspaceId),
          limit(MAX_EXECUTIONS),
        ))
      )));
      return snapshots
        .flatMap((snapshot) => snapshot.docs)
        .sort((left, right) => {
          const leftMs = left.get('receivedAt')?.toMillis?.() || 0;
          const rightMs = right.get('receivedAt')?.toMillis?.() || 0;
          return rightMs - leftMs;
        })
        .slice(0, MAX_EXECUTIONS);
    })
    : Promise.resolve([]);

  /* -- phase two: everything the scope allows ------------------------ */

  const [
    accountDocs,
    userDocs,
    toolDocs,
    platformAuditDocs,
    memberDocs,
    teamDocs,
    deviceDocs,
    customRoleDocs,
    assignmentDocs,
    licenseDocs,
    executionDocs,
    aggregateDocs,
    auditDocs,
  ] = await Promise.all([
    readSafely(async () => (await getDocs(query(collection(db, 'accounts'), limit(MAX_COLLECTION)))).docs),
    isSuperAdmin
      ? readSafely(async () => (await getDocs(query(collection(db, 'users'), limit(MAX_COLLECTION)))).docs)
      : Promise.resolve([]),
    isSuperAdmin
      ? readSafely(async () => (await getDocs(query(collection(db, 'tools'), limit(MAX_COLLECTION)))).docs)
      : Promise.resolve([]),
    isSuperAdmin
      ? readSafely(async () => (await getDocs(query(
        collection(db, 'platformAuditLogs'),
        orderBy('createdAt', 'desc'),
        limit(MAX_AUDIT_ENTRIES),
      ))).docs)
      : Promise.resolve([]),
    readsEverything
      ? scoped('members', [limit(MAX_COLLECTION)])
      // A Team Leader reads exactly the people who share one of its teams.
      : role === 'team_leader' && teamIds.length
        ? scoped('members', [
          where('teamIds', 'array-contains-any', teamIds.slice(0, MAX_IN_VALUES)),
          limit(MAX_COLLECTION),
        ])
        : Promise.resolve(ownMemberDocs),
    readsEverything
      ? scoped('teams', [limit(MAX_COLLECTION)])
      : scopedDocuments('teams', teamIds),
    readsEverything
      ? scoped('devices', [limit(MAX_COLLECTION)])
      // Firestore rules intentionally prohibit scoped users from listing an
      // account fleet. The workstation identity is local and already known,
      // so read precisely that one document; the rules still verify that it
      // belongs to the signed-in operator and an in-scope workspace.
      : installationId && accountReference
        ? scopedDocuments('devices', [installationId])
        : Promise.resolve([]),
    scoped('customRoles', [limit(MAX_COLLECTION)]),
    scoped('toolAssignments', [limit(MAX_COLLECTION)]),
    scoped('licenses', [limit(MAX_COLLECTION)]),
    role === 'artist'
      ? artistTelemetryDocs
      : telemetryConstraints ? scoped('telemetry', telemetryConstraints) : Promise.resolve([]),
    aggregateConstraints ? scoped('telemetryDaily', aggregateConstraints) : Promise.resolve([]),
    scoped('auditLogs', [orderBy('createdAt', 'desc'), limit(MAX_AUDIT_ENTRIES)]),
  ]);

  return Object.freeze({
    accounts: Object.freeze(accountDocs.map(accountDocument)),
    users: Object.freeze(userDocs.map(userDocument)),
    tools: Object.freeze(toolDocs.map(toolDocument)),
    workspaces: Object.freeze(workspaces),
    members: Object.freeze(memberDocs.map((snapshot) => memberDocument(snapshot, accountId))),
    teams: Object.freeze(teamDocs.map((snapshot) => teamDocument(snapshot, accountId))),
    devices: Object.freeze(deviceDocs.map((snapshot) => deviceDocument(snapshot, accountId))),
    customRoles: Object.freeze(customRoleDocs.map((snapshot) => customRoleDocument(snapshot, accountId))),
    assignments: Object.freeze(assignmentDocs.map((snapshot) => assignmentDocument(snapshot, accountId))),
    licenses: Object.freeze(licenseDocs.map((snapshot) => licenseDocument(snapshot, accountId))),
    executions: Object.freeze(executionDocs.map((snapshot) => executionDocument(snapshot, accountId))),
    dailyAggregates: Object.freeze(aggregateDocs.map((snapshot) => aggregateDocument(snapshot, accountId))),
    auditLogs: Object.freeze(auditDocs.map((snapshot) => auditDocument(snapshot, accountId))),
    platformAuditLogs: Object.freeze(platformAuditDocs.map((snapshot) => auditDocument(snapshot))),
    loadedAt: new Date().toISOString(),
    partial,
    truncated: collectTruncation({
      accounts: accountDocs.length,
      users: userDocs.length,
      tools: toolDocs.length,
      workspaces: workspaces.length,
      members: memberDocs.length,
      teams: teamDocs.length,
      devices: deviceDocs.length,
      customRoles: customRoleDocs.length,
      assignments: assignmentDocs.length,
      licenses: licenseDocs.length,
      executions: executionDocs.length,
      dailyAggregates: aggregateDocs.length,
      auditLogs: auditDocs.length,
      platformAuditLogs: platformAuditDocs.length,
    }),
  });
}

export { emptySnapshot as emptyPlatformSnapshot };
