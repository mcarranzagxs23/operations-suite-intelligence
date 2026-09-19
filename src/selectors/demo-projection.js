import { ROLE_IDS, UNASSIGNED_ROLE } from '../access-control.js';
import { TOOL_CONTRACT } from '../product-contract.js';
import {
  demoAccounts,
  demoDailyAggregates,
  demoDevices,
  demoNotifications,
  demoPeople,
  demoTeams,
  demoTelemetry,
  demoWorkspaces,
} from '../data/demo-data.js';

// This selector is deliberately pure: it has no React, browser storage,
// cloud SDK, network, or logging dependency. It converts synthetic source
// records into a fail-closed presentation model before any view or search can
// render them.

const EMPTY_ARRAY = Object.freeze([]);

export const DEMO_ROLE_SCENARIOS = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: Object.freeze({
    role: ROLE_IDS.SUPER_ADMIN,
    id: 'demo-super-admin-miguel',
    displayName: 'Miguel Carranza',
    initials: 'MC',
    accountId: 'operations-internal',
    accountName: 'Operations Suite',
    allAccounts: true,
    allWorkspaces: true,
    workspaceIds: EMPTY_ARRAY,
    teamIds: EMPTY_ARRAY,
    actorId: '',
    scopeKey: 'scopeGlobal',
  }),
  [ROLE_IDS.MANAGER]: Object.freeze({
    role: ROLE_IDS.MANAGER,
    id: 'demo-manager-andrea',
    displayName: 'Andrea Morales',
    initials: 'AM',
    accountId: 'national-graphics',
    accountName: 'National Graphics',
    allAccounts: false,
    allWorkspaces: true,
    workspaceIds: EMPTY_ARRAY,
    teamIds: EMPTY_ARRAY,
    actorId: '',
    scopeKey: 'scopeAccount',
  }),
  [ROLE_IDS.TEAM_LEADER]: Object.freeze({
    role: ROLE_IDS.TEAM_LEADER,
    id: 'demo-leader-keyla',
    displayName: 'Keyla Rivera',
    initials: 'KR',
    accountId: 'national-graphics',
    accountName: 'National Graphics',
    allAccounts: false,
    allWorkspaces: false,
    workspaceIds: Object.freeze(['national-graphics-prepress']),
    teamIds: Object.freeze(['team-national-prepress']),
    actorId: '',
    scopeKey: 'scopeTeam',
  }),
  [ROLE_IDS.ARTIST]: Object.freeze({
    role: ROLE_IDS.ARTIST,
    id: 'demo-artist-marcos',
    displayName: 'Marcos Vega',
    initials: 'MV',
    accountId: 'national-graphics',
    accountName: 'National Graphics',
    allAccounts: false,
    allWorkspaces: false,
    workspaceIds: Object.freeze(['national-graphics-prepress']),
    teamIds: Object.freeze(['team-national-prepress']),
    actorId: 'demo-artist-marcos',
    scopeKey: 'scopePersonal',
  }),
  [ROLE_IDS.CLIENT]: Object.freeze({
    role: ROLE_IDS.CLIENT,
    id: 'demo-client-acme',
    displayName: 'Patricia Gómez',
    initials: 'PG',
    accountId: 'acme-account',
    accountName: 'ACME',
    allAccounts: false,
    allWorkspaces: false,
    workspaceIds: Object.freeze(['acme-service']),
    teamIds: EMPTY_ARRAY,
    actorId: '',
    scopeKey: 'scopeClient',
  }),
});

const DASHBOARD_COPY = Object.freeze({
  [ROLE_IDS.SUPER_ADMIN]: Object.freeze({ kickerKey: 'roleKickerSuperAdmin', subtitleKey: 'roleDashboardSuperAdmin' }),
  [ROLE_IDS.MANAGER]: Object.freeze({ kickerKey: 'roleKickerManager', subtitleKey: 'roleDashboardManager' }),
  [ROLE_IDS.TEAM_LEADER]: Object.freeze({ kickerKey: 'roleKickerTeamLeader', subtitleKey: 'roleDashboardTeamLeader' }),
  [ROLE_IDS.ARTIST]: Object.freeze({ kickerKey: 'roleKickerArtist', subtitleKey: 'roleDashboardArtist' }),
  [ROLE_IDS.CLIENT]: Object.freeze({ kickerKey: 'roleKickerClient', subtitleKey: 'roleDashboardClient' }),
});

function copyArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

function scenarioFor(role) {
  return DEMO_ROLE_SCENARIOS[role] || null;
}

function accountById(accountId) {
  return demoAccounts.find((account) => account.id === accountId) || null;
}

function workspaceById(workspaceId) {
  return demoWorkspaces.find((workspace) => workspace.id === workspaceId) || null;
}

function teamById(teamId) {
  return demoTeams.find((team) => team.id === teamId) || null;
}

function personById(personId) {
  return demoPeople.find((person) => person.id === personId) || null;
}

function isInScope(record, scenario) {
  if (!record || !scenario) return false;
  if (!scenario.allAccounts && record.accountId !== scenario.accountId) return false;
  if (!scenario.allWorkspaces && !scenario.workspaceIds.includes(record.workspaceId || record.id)) return false;
  if (scenario.teamIds.length && record.teamId && !scenario.teamIds.includes(record.teamId)) return false;
  return true;
}

function hasTeamIntersection(person, teamIds) {
  return !teamIds.length || copyArray(person.teamIds).some((teamId) => teamIds.includes(teamId));
}

function accountDto(account) {
  return Object.freeze({ name: account.name, status: account.status });
}

function workspaceDto(workspace) {
  const account = accountById(workspace.accountId);
  const team = workspace.teamId ? teamById(workspace.teamId) : null;
  return Object.freeze({
    id: workspace.id,
    name: workspace.name,
    accountName: account?.name || '',
    teamName: team?.name || '',
    managerCount: workspace.managerCount,
    artistCount: workspace.artistCount,
    state: workspace.state,
    lastActivity: workspace.lastActivity,
  });
}

function personDto(person) {
  return Object.freeze({
    id: person.id,
    name: person.name,
    role: person.role,
    initials: person.initials,
    status: person.status,
  });
}

function deviceDto(device) {
  const person = personById(device.assignedUserId);
  return Object.freeze({
    id: device.id,
    name: device.name,
    user: person?.name || '',
    operatingSystem: device.operatingSystem,
    verification: device.verification,
    lastSeen: device.lastSeen,
  });
}

function detailedTelemetryDto(event) {
  return Object.freeze({
    id: event.id,
    tool: event.tool,
    action: event.action,
    event: event.event,
    time: event.time,
    status: event.status,
    duration: event.duration,
    kind: event.kind,
  });
}

function aggregateTelemetryDto(aggregate) {
  const workspace = workspaceById(aggregate.workspaceId);
  return Object.freeze({
    id: aggregate.id,
    workspaceName: workspace?.name || '',
    day: aggregate.day,
    totalRuns: aggregate.totalRuns,
    successfulRuns: aggregate.successfulRuns,
    successRate: aggregate.successRate,
    cleanVectorRuns: aggregate.cleanVectorRuns,
    sepMakerRuns: aggregate.sepMakerRuns,
  });
}

function sourceEventIsSafe(event) {
  return Boolean(
    event
    && typeof event.id === 'string'
    && typeof event.accountId === 'string'
    && typeof event.workspaceId === 'string'
    && typeof event.actorId === 'string'
    && typeof event.tool === 'string'
    && typeof event.action === 'string',
  );
}

function metric(id, value, detailKey, kind = 'positive') {
  return Object.freeze({ id, value: String(value), detailKey, kind });
}

function countSuccessful(events) {
  return events.filter((event) => event.status === 'success').length;
}

function percentage(successful, total) {
  if (!total) return '—';
  return `${((successful / total) * 100).toFixed(1)}%`;
}

function buildMetrics({ role, workspaces, people, devices, detailedEvents, aggregates }) {
  const aggregateRuns = aggregates.reduce((sum, aggregate) => sum + aggregate.totalRuns, 0);
  const aggregateSuccesses = aggregates.reduce((sum, aggregate) => sum + aggregate.successfulRuns, 0);
  const detailedSuccesses = countSuccessful(detailedEvents);

  if (role === ROLE_IDS.SUPER_ADMIN) {
    return Object.freeze([
      metric('todayRuns', aggregateRuns, 'metricPortfolioRunsDetail'),
      metric('successfulRuns', percentage(aggregateSuccesses, aggregateRuns), 'metricPortfolioSuccessDetail'),
      metric('assignedArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricPortfolioArtistsDetail', 'neutral'),
      metric('activeDevices', devices.length, 'metricPortfolioDevicesDetail', 'warning'),
    ]);
  }

  if (role === ROLE_IDS.MANAGER) {
    return Object.freeze([
      metric('accountRuns', aggregateRuns, 'metricAccountRunsDetail'),
      metric('accountSuccess', percentage(aggregateSuccesses, aggregateRuns), 'metricAccountSuccessDetail'),
      metric('accountWorkspaces', workspaces.length, 'metricAccountWorkspacesDetail', 'neutral'),
      metric('accountArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricAccountArtistsDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.TEAM_LEADER) {
    return Object.freeze([
      metric('teamRuns', aggregateRuns, 'metricTeamRunsDetail'),
      metric('teamSuccess', percentage(aggregateSuccesses, aggregateRuns), 'metricTeamSuccessDetail'),
      metric('teamArtists', people.filter((person) => person.role === ROLE_IDS.ARTIST).length, 'metricTeamArtistsDetail', 'neutral'),
      metric('teamWorkspaces', workspaces.length, 'metricTeamWorkspacesDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.ARTIST) {
    return Object.freeze([
      metric('myRuns', detailedEvents.length, 'metricMyRunsDetail'),
      metric('mySuccess', percentage(detailedSuccesses, detailedEvents.length), 'metricMySuccessDetail'),
      metric('myWorkspaces', workspaces.length, 'metricMyWorkspacesDetail', 'neutral'),
    ]);
  }

  if (role === ROLE_IDS.CLIENT) {
    return Object.freeze([
      metric('serviceRuns', aggregateRuns, 'metricServiceRunsDetail'),
      metric('serviceSuccess', percentage(aggregateSuccesses, aggregateRuns), 'metricServiceSuccessDetail'),
      metric('serviceWorkspaces', aggregates.length, 'metricServiceWorkspacesDetail', 'neutral'),
    ]);
  }

  return EMPTY_ARRAY;
}

function buildSearchCandidates({ workspaces, people, detailedEvents, aggregates, role }) {
  const entries = [
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
    ...detailedEvents.map((event) => Object.freeze({
      id: `event-${event.id}`,
      title: event.tool,
      detail: event.event,
      view: 'telemetry',
    })),
  ];

  if (role === ROLE_IDS.CLIENT) {
    return Object.freeze(aggregates.map((aggregate) => Object.freeze({
      id: `aggregate-${aggregate.id}`,
      title: aggregate.workspaceName,
      detail: aggregate.day,
      view: 'telemetry',
    })));
  }

  return Object.freeze(entries);
}

function emptyProjection() {
  return Object.freeze({
    context: Object.freeze({ role: UNASSIGNED_ROLE, accountName: '', scopeKey: 'scopeNone', kickerKey: 'roleKickerUnassigned', subtitleKey: 'roleDashboardUnassigned' }),
    dashboard: Object.freeze({ metrics: EMPTY_ARRAY, primaryWorkspaceName: '', primaryWorkspaceState: 'review', detailed: false }),
    workspaces: EMPTY_ARRAY,
    telemetry: Object.freeze({ kind: 'aggregate', events: EMPTY_ARRAY, aggregates: EMPTY_ARRAY, simulatedCount: 0, canSimulate: false }),
    team: Object.freeze({ kind: 'service', people: EMPTY_ARRAY, serviceStatus: 'review', serviceAggregate: null }),
    devices: EMPTY_ARRAY,
    searchCandidates: EMPTY_ARRAY,
    notifications: demoNotifications,
    tools: Object.freeze({ canSimulate: false }),
    execution: null,
  });
}

/**
 * Provides a complete synthetic identity when the local demo role selector is
 * used. It changes identity, account and scope together, never only a role.
 */
export function getDemoSession(role) {
  const scenario = scenarioFor(role);
  if (!scenario) return null;

  return Object.freeze({
    id: scenario.id,
    displayName: scenario.displayName,
    initials: scenario.initials,
    role: scenario.role,
    accountId: scenario.accountId,
    activeAccountId: scenario.accountId,
    accountName: scenario.accountName,
    language: 'es',
    mode: 'demo',
    demoScenario: scenario.role,
    memberships: EMPTY_ARRAY,
  });
}

export function getDemoScenario(role) {
  const scenario = scenarioFor(role);
  if (!scenario) return null;
  return Object.freeze({
    ...scenario,
    workspaceIds: Object.freeze(copyArray(scenario.workspaceIds)),
    teamIds: Object.freeze(copyArray(scenario.teamIds)),
  });
}

/**
 * Filters first, maps second. The returned Client projection intentionally
 * cannot carry people, devices, raw events, actor IDs, device IDs, file names,
 * paths, or workspace configuration data.
 */
export function getDemoProjection(session, localEvents = EMPTY_ARRAY) {
  const scenario = scenarioFor(session?.demoScenario || session?.role);
  if (!scenario) return emptyProjection();

  const scopedWorkspaces = demoWorkspaces.filter((workspace) => isInScope(workspace, scenario));
  const scopedPeople = scenario.role === ROLE_IDS.CLIENT || scenario.role === ROLE_IDS.ARTIST
    ? EMPTY_ARRAY
    : demoPeople.filter((person) => (
      isInScope({ accountId: person.accountId, workspaceId: person.workspaceIds?.[0] || '', teamId: person.teamIds?.[0] || '' }, scenario)
      && hasTeamIntersection(person, scenario.teamIds)
    ));
  const sourceEvents = [...demoTelemetry, ...copyArray(localEvents).filter(sourceEventIsSafe)];
  const scopedSourceEvents = sourceEvents.filter((event) => {
    if (!isInScope(event, scenario)) return false;
    return scenario.role !== ROLE_IDS.ARTIST || event.actorId === scenario.actorId;
  });
  const scopedAggregates = demoDailyAggregates.filter((aggregate) => isInScope(aggregate, scenario));
  const scopedDevices = scenario.role === ROLE_IDS.SUPER_ADMIN
    ? demoDevices.map(deviceDto)
    : EMPTY_ARRAY;
  const workspaces = Object.freeze(scopedWorkspaces.map(workspaceDto));
  const people = Object.freeze(scopedPeople.map(personDto));
  const detailedEvents = scenario.role === ROLE_IDS.CLIENT
    ? EMPTY_ARRAY
    : Object.freeze(scopedSourceEvents.map(detailedTelemetryDto));
  const aggregates = Object.freeze(scopedAggregates.map(aggregateTelemetryDto));
  const telemetryKind = scenario.role === ROLE_IDS.CLIENT ? 'aggregate' : 'detailed';
  const metrics = buildMetrics({
    role: scenario.role,
    workspaces,
    people,
    devices: scopedDevices,
    detailedEvents,
    aggregates,
  });
  const primaryWorkspace = workspaces[0] || null;
  const dashboardCopy = DASHBOARD_COPY[scenario.role] || DASHBOARD_COPY[ROLE_IDS.SUPER_ADMIN];
  const serviceAggregate = aggregates[0] || null;
  const canSimulate = scenario.role === ROLE_IDS.ARTIST && Boolean(scenario.actorId && scenario.workspaceIds[0]);

  return Object.freeze({
    context: Object.freeze({
      role: scenario.role,
      accountName: scenario.allAccounts ? scenario.accountName : (accountById(scenario.accountId)?.name || scenario.accountName),
      scopeKey: scenario.scopeKey,
      kickerKey: dashboardCopy.kickerKey,
      subtitleKey: dashboardCopy.subtitleKey,
    }),
    dashboard: Object.freeze({
      metrics,
      primaryWorkspaceName: primaryWorkspace?.name || '',
      primaryWorkspaceState: primaryWorkspace?.state || 'review',
      detailed: telemetryKind === 'detailed',
    }),
    workspaces,
    telemetry: Object.freeze({
      kind: telemetryKind,
      events: detailedEvents,
      aggregates,
      simulatedCount: detailedEvents.filter((event) => event.status === 'simulated').length,
      canSimulate,
    }),
    team: Object.freeze({
      kind: scenario.role === ROLE_IDS.CLIENT ? 'service' : 'people',
      people,
      serviceStatus: serviceAggregate?.successRate === '100%' ? 'active' : 'review',
      serviceAggregate,
    }),
    devices: Object.freeze(scopedDevices),
    searchCandidates: buildSearchCandidates({ workspaces, people, detailedEvents, aggregates, role: scenario.role }),
    notifications: demoNotifications,
    tools: Object.freeze({ canSimulate }),
    execution: canSimulate ? Object.freeze({
      accountId: scenario.accountId,
      workspaceId: scenario.workspaceIds[0],
      teamId: scenario.teamIds[0] || '',
      actorId: scenario.actorId,
    }) : null,
  });
}

/**
 * Prepares a local-only event for the Artist scenario. It never sends or
 * stores the event outside React state; the normal projection filters it again
 * before any view can display it.
 */
export function createScopedDemoEvent(projection, tool, now = new Date()) {
  const scope = projection?.execution;
  if (!projection?.tools?.canSimulate || !scope || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  if (tool !== 'cleanVector' && tool !== 'sepMaker') return null;

  const isCleanVector = tool === 'cleanVector';
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return Object.freeze({
    id: `simulated-${now.getTime()}-${tool}`,
    tool: isCleanVector ? TOOL_CONTRACT.cleanVector.productName : TOOL_CONTRACT.sepMaker.productName,
    action: isCleanVector ? TOOL_CONTRACT.cleanVector.action : TOOL_CONTRACT.sepMaker.action,
    event: isCleanVector ? TOOL_CONTRACT.cleanVector.eventType : TOOL_CONTRACT.sepMaker.eventType,
    time,
    status: 'simulated',
    duration: '—',
    kind: isCleanVector ? 'cyan' : 'orange',
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    teamId: scope.teamId,
    actorId: scope.actorId,
  });
}
