import { ROLE_IDS, UNASSIGNED_ROLE } from '../access-control.js';
import { PRODUCT_NAME_BY_REGISTRY_ID, EVENT_TYPE_BY_REGISTRY_ID, TOOL_REGISTRY_IDS } from '../product-contract.js';

/**
 * Build the presentation model from persisted platform state.
 *
 * This selector is pure: no React, no browser storage, no cloud SDK, no
 * network, no clock reading beyond the instant it is given. It filters before
 * it maps, so a record outside the session's scope is dropped before any view
 * or search index can see it, and it emits the same shape for every role —
 * which is what stops a view from having to ask "am I allowed to render this".
 *
 * The scoping here is a second layer, not the control. Firestore Rules already
 * refused anything out of scope before the data arrived. Re-applying the
 * boundary means a rule that is later loosened by mistake still cannot leak an
 * artist's individual activity into a Client's screen.
 */

const EMPTY_ARRAY = Object.freeze([]);

/*
 * Live copy, not the demonstration copy.
 *
 * These keys used to be shared with `demo-projection.js`, and the shared
 * text was written for the demonstration. Once the platform started reading
 * real data the interface kept calling it a demo: a screen would show four
 * executions genuinely persisted in Firestore under a caption reading
 * "sample events prepared", beside a badge reading "real data".
 *
 * Naming the live keys here, rather than branching inside each view, keeps
 * the decision where the mode is already known. A view renders whatever key
 * its projection hands it and never has to ask which mode it is in.
 */
const DASHBOARD_COPY = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: Object.freeze({ kickerKey: 'roleKickerSuperAdminLive', subtitleKey: 'roleDashboardSuperAdminLive', scopeKey: 'scopeGlobalLive' }),
  [ROLE_IDS.MANAGER]: Object.freeze({ kickerKey: 'roleKickerManager', subtitleKey: 'roleDashboardManagerLive', scopeKey: 'scopeAccountLive' }),
  [ROLE_IDS.TEAM_LEADER]: Object.freeze({ kickerKey: 'roleKickerTeamLeader', subtitleKey: 'roleDashboardTeamLeaderLive', scopeKey: 'scopeTeam' }),
  [ROLE_IDS.ARTIST]: Object.freeze({ kickerKey: 'roleKickerArtist', subtitleKey: 'roleDashboardArtistLive', scopeKey: 'scopePersonal' }),
  [ROLE_IDS.CLIENT]: Object.freeze({ kickerKey: 'roleKickerClient', subtitleKey: 'roleDashboardClient', scopeKey: 'scopeClient' }),
});

const TOOL_ACCENTS = Object.freeze({
  [TOOL_REGISTRY_IDS.cleanVector]: 'cyan',
  [TOOL_REGISTRY_IDS.sepMaker]: 'orange',
});

function metric(id, value, detailKey, kind = 'positive') {
  return Object.freeze({ id, value: String(value), detailKey, kind });
}

function percentage(successful, total) {
  if (!total) return '—';
  return `${((successful / total) * 100).toFixed(1)}%`;
}

function initialsFrom(name) {
  return (name || 'US')
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function clockLabel(isoString) {
  if (!isoString) return '—';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
}

function durationLabel(durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return '—';
  const seconds = durationMs / 1000;
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${Math.round(seconds * 10) / 10}s`;
}

/**
 * Relative recency, expressed the way an operator reads it.
 *
 * Anything older than an hour becomes an absolute date: "seen 4,203 minutes
 * ago" is technically accurate and operationally useless.
 */
function relativeSeen(isoString, nowMs) {
  if (!isoString) return Object.freeze({ kind: 'never' });
  const parsed = Date.parse(isoString);
  if (!Number.isFinite(parsed)) return Object.freeze({ kind: 'never' });

  const minutes = Math.floor((nowMs - parsed) / 60000);
  if (minutes < 1) return Object.freeze({ kind: 'now' });
  if (minutes < 60) return Object.freeze({ kind: 'minutes', minutes });
  return Object.freeze({ kind: 'date', value: isoString });
}

function inWorkspaceScope(workspaceId, scope) {
  if (scope.allWorkspaces) return true;
  return scope.workspaceIds.includes(workspaceId);
}

function buildScope(session) {
  const role = session?.role || UNASSIGNED_ROLE;
  const membership = (session?.memberships || []).find(
    (entry) => entry.accountId === session?.activeAccountId,
  ) || null;

  return Object.freeze({
    role,
    uid: session?.id || '',
    accountId: session?.activeAccountId || '',
    accountName: session?.accountName || '',
    isSuperAdmin: session?.globalRole === ROLE_IDS.SUPER_ADMIN,
    allWorkspaces: session?.globalRole === ROLE_IDS.SUPER_ADMIN || membership?.allWorkspaces === true,
    workspaceIds: Object.freeze(membership?.workspaceIds ? [...membership.workspaceIds] : []),
    teamIds: EMPTY_ARRAY,
  });
}

function emptyProjection() {
  return Object.freeze({
    context: Object.freeze({
      role: UNASSIGNED_ROLE,
      accountName: '',
      scopeKey: 'scopeNoneLive',
      kickerKey: 'roleKickerUnassigned',
      subtitleKey: 'roleDashboardUnassignedLive',
    }),
    dashboard: Object.freeze({ metrics: EMPTY_ARRAY, primaryWorkspaceName: '', primaryWorkspaceState: 'review', detailed: false }),
    workspaces: EMPTY_ARRAY,
    telemetry: Object.freeze({ kind: 'aggregate', events: EMPTY_ARRAY, aggregates: EMPTY_ARRAY, simulatedCount: 0, canSimulate: false }),
    team: Object.freeze({ kind: 'service', people: EMPTY_ARRAY, serviceStatus: 'review', serviceAggregate: null }),
    devices: EMPTY_ARRAY,
    searchCandidates: EMPTY_ARRAY,
    notifications: EMPTY_ARRAY,
    tools: Object.freeze({ canSimulate: false, entries: EMPTY_ARRAY, deviceAuthorized: false, deviceReason: 'device.unknown' }),
    execution: null,
    live: true,
  });
}

function workspaceView(workspace, members, teams, executions, nowMs) {
  const workspaceMembers = members.filter((member) => (
    member.allWorkspaces || member.workspaceIds.includes(workspace.id)
  ));
  const team = teams.find((entry) => entry.workspaceId === workspace.id) || null;
  const lastExecution = executions.find((execution) => execution.workspaceId === workspace.id) || null;

  return Object.freeze({
    id: workspace.id,
    name: workspace.name,
    code: workspace.code,
    accountName: workspace.accountName || '',
    teamName: team?.name || '',
    managerCount: workspaceMembers.filter((member) => member.role === ROLE_IDS.MANAGER).length,
    artistCount: workspaceMembers.filter((member) => member.role === ROLE_IDS.ARTIST).length,
    state: workspace.status === 'active' ? 'active' : 'review',
    lastActivity: relativeSeen(lastExecution?.completedAt || null, nowMs),
  });
}

function executionView(execution) {
  return Object.freeze({
    id: execution.id,
    tool: PRODUCT_NAME_BY_REGISTRY_ID[execution.toolId] || execution.toolId,
    action: execution.action,
    event: EVENT_TYPE_BY_REGISTRY_ID[execution.toolId] || execution.toolId,
    time: clockLabel(execution.completedAt),
    status: execution.status === 'success' ? 'success' : execution.status === 'cancelled' ? 'cancelled' : 'error',
    duration: durationLabel(execution.durationMs),
    kind: TOOL_ACCENTS[execution.toolId] || 'cyan',
  });
}

function aggregateView(aggregate, workspacesById) {
  return Object.freeze({
    id: aggregate.id,
    workspaceName: workspacesById.get(aggregate.workspaceId)?.name || '',
    day: aggregate.day,
    totalRuns: aggregate.totalRuns,
    successfulRuns: aggregate.successfulRuns,
    successRate: percentage(aggregate.successfulRuns, aggregate.totalRuns),
    cleanVectorRuns: aggregate.byTool?.[TOOL_REGISTRY_IDS.cleanVector] || 0,
    sepMakerRuns: aggregate.byTool?.[TOOL_REGISTRY_IDS.sepMaker] || 0,
  });
}

function personView(member) {
  return Object.freeze({
    id: member.id,
    name: member.displayName,
    role: member.role,
    initials: initialsFrom(member.displayName),
    status: member.status === 'active' ? 'active' : 'review',
  });
}

function deviceView(device, membersById, nowMs) {
  return Object.freeze({
    id: device.id,
    name: device.label,
    user: membersById.get(device.assignedUid)?.displayName || '',
    operatingSystem: device.platform === 'macos' ? 'macOS' : 'Windows',
    verification: device.status,
    workspaceId: device.workspaceId,
    lastSeen: relativeSeen(device.lastSeenAt, nowMs),
  });
}

function buildMetrics({ role, workspaces, people, devices, executions, aggregates }) {
  const totalRuns = aggregates.reduce((sum, aggregate) => sum + aggregate.totalRuns, 0);
  const successfulRuns = aggregates.reduce((sum, aggregate) => sum + aggregate.successfulRuns, 0);
  const personalSuccesses = executions.filter((execution) => execution.status === 'success').length;

  if (role === ROLE_IDS.SUPER_ADMIN) {
    return Object.freeze([
      metric('todayRuns', totalRuns, 'metricPortfolioRunsDetailLive'),
      metric('successfulRuns', percentage(successfulRuns, totalRuns), 'metricPortfolioSuccessDetailLive'),
      metric('assignedArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricPortfolioArtistsDetailLive', 'neutral'),
      metric('activeDevices', devices.filter((device) => device.verification === 'approved').length, 'metricPortfolioDevicesDetailLive', 'warning'),
    ]);
  }

  if (role === ROLE_IDS.MANAGER) {
    return Object.freeze([
      metric('accountRuns', totalRuns, 'metricAccountRunsDetail'),
      metric('accountSuccess', percentage(successfulRuns, totalRuns), 'metricAccountSuccessDetail'),
      metric('accountWorkspaces', workspaces.length, 'metricAccountWorkspacesDetail', 'neutral'),
      metric('accountArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricAccountArtistsDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.TEAM_LEADER) {
    return Object.freeze([
      metric('teamRuns', totalRuns, 'metricTeamRunsDetail'),
      metric('teamSuccess', percentage(successfulRuns, totalRuns), 'metricTeamSuccessDetail'),
      metric('teamArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricTeamArtistsDetail', 'neutral'),
      metric('teamWorkspaces', workspaces.length, 'metricTeamWorkspacesDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.ARTIST) {
    return Object.freeze([
      metric('myRuns', executions.length, 'metricMyRunsDetail'),
      metric('mySuccess', percentage(personalSuccesses, executions.length), 'metricMySuccessDetail'),
      metric('myWorkspaces', workspaces.length, 'metricMyWorkspacesDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.CLIENT) {
    return Object.freeze([
      metric('serviceRuns', totalRuns, 'metricServiceRunsDetail'),
      metric('serviceSuccess', percentage(successfulRuns, totalRuns), 'metricServiceSuccessDetail'),
      metric('serviceWorkspaces', aggregates.length, 'metricServiceWorkspacesDetail', 'neutral'),
    ]);
  }

  return EMPTY_ARRAY;
}

/**
 * Operational notifications derived from real state.
 *
 * Each one corresponds to something an operator can act on right now — a
 * station waiting for approval, a licence about to lapse, a suspended account.
 * Nothing here is decorative, so an empty notification list is a true
 * statement that nothing needs attention.
 */
function buildNotifications({ scope, devices, licenses, accounts, nowMs }) {
  const notifications = [];

  const pendingDevices = devices.filter((device) => device.verification === 'pending').length;
  if (pendingDevices > 0) {
    notifications.push(Object.freeze({
      id: 'devices-pending',
      titleKey: 'notificationDevicesPendingTitle',
      bodyKey: 'notificationDevicesPendingBody',
      values: { count: pendingDevices },
      tone: 'warning',
    }));
  }

  const expiringSoon = licenses.filter((license) => {
    if (license.status !== 'active' || !license.expiresAt) return false;
    const expiresAtMs = Date.parse(license.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return false;
    const daysLeft = (expiresAtMs - nowMs) / 86400000;
    return daysLeft > 0 && daysLeft <= 30;
  }).length;
  if (expiringSoon > 0) {
    notifications.push(Object.freeze({
      id: 'licenses-expiring',
      titleKey: 'notificationLicensesExpiringTitle',
      bodyKey: 'notificationLicensesExpiringBody',
      values: { count: expiringSoon },
      tone: 'warning',
    }));
  }

  if (scope.isSuperAdmin) {
    const suspended = accounts.filter((account) => account.status !== 'active').length;
    if (suspended > 0) {
      notifications.push(Object.freeze({
        id: 'accounts-suspended',
        titleKey: 'notificationAccountsSuspendedTitle',
        bodyKey: 'notificationAccountsSuspendedBody',
        values: { count: suspended },
        tone: 'neutral',
      }));
    }
  }

  if (notifications.length === 0) {
    notifications.push(Object.freeze({
      id: 'all-clear',
      titleKey: 'notificationAllClearTitle',
      bodyKey: 'notificationAllClearBody',
      values: {},
      tone: 'success',
    }));
  }

  return Object.freeze(notifications);
}

function buildSearchCandidates({ workspaces, people, executions, aggregates, role }) {
  if (role === ROLE_IDS.CLIENT) {
    return Object.freeze(aggregates.map((aggregate) => Object.freeze({
      id: `aggregate-${aggregate.id}`,
      title: aggregate.workspaceName,
      detail: aggregate.day,
      view: 'telemetry',
    })));
  }

  return Object.freeze([
    ...workspaces.map((workspace) => Object.freeze({
      id: `workspace-${workspace.id}`,
      title: workspace.name,
      detail: workspace.accountName,
      view: 'workspaces',
    })),
    ...people.map((person) => Object.freeze({
      id: `person-${person.id}`,
      title: person.name,
      detail: person.role,
      view: 'team',
      roleEntry: true,
    })),
    ...executions.map((execution) => Object.freeze({
      id: `event-${execution.id}`,
      title: execution.tool,
      detail: execution.event,
      view: 'telemetry',
    })),
  ]);
}

/**
 * Project the authorized catalog for display.
 *
 * Unauthorized tools are kept, with their reason, rather than hidden. An
 * operator who cannot see why a tool is missing files a support ticket; one
 * who reads "licence expired" fixes it or asks the right question.
 */
function buildToolEntries(catalog) {
  const tools = Array.isArray(catalog?.tools) ? catalog.tools : [];
  return Object.freeze(tools.map((tool) => Object.freeze({
    toolId: tool.toolId,
    name: PRODUCT_NAME_BY_REGISTRY_ID[tool.toolId] || tool.displayName || tool.toolId,
    authorized: tool.authorized === true,
    reason: tool.reason || null,
    version: tool.version || null,
    accent: TOOL_ACCENTS[tool.toolId] || 'cyan',
    assignedVia: tool.assignedVia || null,
  })));
}

export function getPlatformProjection({ session, snapshot, catalog = null, nowMs = Date.now() } = {}) {
  const scope = buildScope(session);
  if (!session || scope.role === UNASSIGNED_ROLE || !snapshot) return emptyProjection();

  const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const activeAccount = accountsById.get(scope.accountId) || null;

  const members = snapshot.members;
  const membersById = new Map(members.map((member) => [member.id, member]));
  const ownMembership = membersById.get(scope.uid) || null;
  const effectiveScope = Object.freeze({
    ...scope,
    allWorkspaces: scope.allWorkspaces || ownMembership?.allWorkspaces === true,
    workspaceIds: scope.workspaceIds.length
      ? scope.workspaceIds
      : Object.freeze([...(ownMembership?.workspaceIds || [])]),
    teamIds: Object.freeze([...(ownMembership?.teamIds || [])]),
  });

  const scopedWorkspaces = snapshot.workspaces
    .filter((workspace) => inWorkspaceScope(workspace.id, effectiveScope))
    .map((workspace) => ({ ...workspace, accountName: activeAccount?.name || scope.accountName }));

  const scopedTeams = effectiveScope.allWorkspaces
    ? snapshot.teams
    : snapshot.teams.filter((team) => effectiveScope.teamIds.includes(team.id));

  // A Client receives service aggregates only. It is given no people, no
  // devices, and no individual runs, so no artist's activity can be inferred
  // from what it can see.
  const isClient = effectiveScope.role === ROLE_IDS.CLIENT;
  const isArtist = effectiveScope.role === ROLE_IDS.ARTIST;

  const scopedExecutions = isClient
    ? EMPTY_ARRAY
    : snapshot.executions.filter((execution) => (
      inWorkspaceScope(execution.workspaceId, effectiveScope)
      && (!isArtist || execution.actorUid === effectiveScope.uid)
    ));

  const scopedAggregates = snapshot.dailyAggregates
    .filter((aggregate) => inWorkspaceScope(aggregate.workspaceId, effectiveScope));

  const scopedMembers = isClient || isArtist
    ? EMPTY_ARRAY
    : effectiveScope.allWorkspaces
      ? members
      // A scoped viewer sees somebody only through a shared workspace or a
      // shared team. Membership breadth is deliberately not a qualifier: an
      // account-wide Manager must not become visible to every Team Leader
      // merely because their own scope is wide.
      : members.filter((member) => (
        member.workspaceIds.some((workspaceId) => effectiveScope.workspaceIds.includes(workspaceId))
        || member.teamIds.some((teamId) => effectiveScope.teamIds.includes(teamId))
      ));

  const scopedDevices = isClient
    ? EMPTY_ARRAY
    : snapshot.devices.filter((device) => (
      inWorkspaceScope(device.workspaceId, effectiveScope)
      && (effectiveScope.allWorkspaces || effectiveScope.role !== ROLE_IDS.ARTIST || device.assignedUid === effectiveScope.uid)
    ));

  const scopedLicenses = effectiveScope.allWorkspaces ? snapshot.licenses : EMPTY_ARRAY;

  const workspacesById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaces = Object.freeze(scopedWorkspaces.map((workspace) => (
    workspaceView(workspace, members, scopedTeams, scopedExecutions, nowMs)
  )));
  const people = Object.freeze(scopedMembers.map(personView));
  const devices = Object.freeze(scopedDevices.map((device) => deviceView(device, membersById, nowMs)));
  const executions = Object.freeze(scopedExecutions.map(executionView));
  const aggregates = Object.freeze(scopedAggregates.map((aggregate) => aggregateView(aggregate, workspacesById)));

  const copy = DASHBOARD_COPY[effectiveScope.role] || DASHBOARD_COPY[ROLE_IDS.SUPER_ADMIN];
  const primaryWorkspace = workspaces[0] || null;
  const serviceAggregate = aggregates[0] || null;
  const toolEntries = buildToolEntries(catalog);
  const runnableTools = toolEntries.filter((tool) => tool.authorized);

  return Object.freeze({
    context: Object.freeze({
      role: effectiveScope.role,
      accountName: activeAccount?.name || scope.accountName,
      scopeKey: copy.scopeKey,
      kickerKey: copy.kickerKey,
      subtitleKey: copy.subtitleKey,
    }),
    dashboard: Object.freeze({
      metrics: buildMetrics({
        role: effectiveScope.role,
        workspaces,
        people,
        devices,
        executions,
        aggregates,
      }),
      primaryWorkspaceName: primaryWorkspace?.name || '',
      primaryWorkspaceState: primaryWorkspace?.state || 'review',
      detailed: !isClient,
    }),
    workspaces,
    telemetry: Object.freeze({
      kind: isClient ? 'aggregate' : 'detailed',
      events: executions,
      aggregates,
      simulatedCount: 0,
      canSimulate: false,
    }),
    team: Object.freeze({
      kind: isClient ? 'service' : 'people',
      people,
      serviceStatus: serviceAggregate?.successRate === '100.0%' ? 'active' : 'review',
      serviceAggregate,
    }),
    devices,
    searchCandidates: buildSearchCandidates({
      workspaces,
      people,
      executions,
      aggregates,
      role: effectiveScope.role,
    }),
    notifications: buildNotifications({
      scope: effectiveScope,
      devices,
      licenses: scopedLicenses,
      accounts: snapshot.accounts,
      nowMs,
    }),
    tools: Object.freeze({
      canSimulate: false,
      entries: toolEntries,
      runnableCount: runnableTools.length,
      deviceAuthorized: catalog?.deviceAuthorized === true,
      deviceReason: catalog?.deviceReason || null,
    }),
    execution: Object.freeze({
      accountId: effectiveScope.accountId,
      workspaceId: catalog?.workspaceId || effectiveScope.workspaceIds[0] || '',
      deviceId: catalog?.deviceId || '',
    }),
    scope: effectiveScope,
    live: true,
  });
}

/**
 * Choose the account a Super Administrator lands on when they have no membership.
 *
 * A Super Administrator signs in without belonging to any account, so the
 * interface has to pick a context for them. It used to take the first
 * persisted account, which is only sensible while every account is usable.
 *
 * It stopped being sensible in production. Each run of the authenticated
 * validation leaves its account behind suspended -- that is what its cleanup
 * is supposed to do -- and those shells sort ahead of the real account. The
 * console then opened on a suspended account, and every administrative call
 * failed with `failed-precondition` because the backend refuses an inactive
 * account. Nothing in the interface said so: the operator saw "check the
 * fields" on a form whose fields were correct.
 *
 * So prefer an account that can actually be operated. The fallback to the
 * first entry is kept deliberately: when nothing is active there is no better
 * answer, and the administrator still needs a context to see why.
 */
export function selectDefaultAccountContext(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return '';
  const operable = accounts.find((account) => account?.status === 'active');
  return (operable || accounts[0])?.id || '';
}

/**
 * The accounts worth offering as an administrative context.
 *
 * The context picker and the administrative forms serve different purposes.
 * A form must reach every account, including a suspended one, because
 * reactivating it is itself an administrative act. The context picker only
 * chooses where the console is pointed, and pointing it at an account the
 * backend refuses produces failures that read like defects in whatever the
 * operator tries next.
 *
 * The fallback matters as much as the filter: when nothing is active this
 * returns everything rather than an empty list, because a picker with no
 * options would strand the administrator on the one screen that could explain
 * the situation.
 */
export function selectOperableAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return EMPTY_ARRAY;
  const operable = accounts.filter((account) => account?.status === 'active');
  return operable.length > 0 ? operable : accounts;
}
