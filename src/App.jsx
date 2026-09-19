import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canAccess,
  roleLabel,
  ROLE_IDS,
  ROLE_META,
  UNASSIGNED_ROLE,
  visibleCapabilities,
} from './access-control.js';
import { createTranslator, getInitialLanguage, persistLanguage } from './i18n.js';
import { TOOL_CONTRACT, TOOL_REGISTRY_IDS } from './product-contract.js';
import {
  getAdminBackendState,
  isAdminBackendReady,
  submitAdminOperation,
} from './services/admin-service.js';
import { canPreviewDemoRoles } from './services/demo-role-preview.js';
import { isFirebaseConfigured } from './services/firebase.js';
import { emptyPlatformSnapshot, loadPlatformSnapshot } from './services/platform-data.js';
import { measureUsage } from './services/usage-metrics.js';
import {
  defaultWorkstationLabel,
  detectPlatform,
  enrollWorkstation,
  fetchAuthorizedCatalog,
  getInstallationId,
  recordExecution,
  rotateInstallationId,
  toExecutionEvent,
} from './services/workstation-service.js';
import {
  checkLocalBridgeHealth,
  getLatestLocalBridgeExecution,
  getLocalBridgeStatus,
  LocalBridgeError,
  pairLocalBridge,
  publishLocalBridgeCatalog,
} from './services/local-bridge-client.js';
import { observeSession, signIn, signOutSession } from './services/session-service.js';
import { switchActiveAccount } from './services/session-access.js';
import {
  createScopedDemoEvent,
  getDemoProjection,
  getDemoSession,
} from './selectors/demo-projection.js';
import { getPlatformProjection, selectDefaultAccountContext } from './selectors/platform-projection.js';
import { mayAttemptRecord, nextAttemptCount } from './telemetry-retry-policy.js';
import AdministrationConsole from './views/AdministrationConsole.jsx';
import IntelligenceCenter from './views/IntelligenceCenter.jsx';
import AdminOperationDialog from './views/AdminOperationDialog.jsx';
import { labelForReason, labelForValue } from './views/admin-presentation.js';

const FOUNDATION_VERSION = '3.0';
const HISTORY_VIEW_KEY = 'operationsSuiteView';
const BRIDGE_POLL_INTERVAL_MS = 2500;

/**
 * One drawn icon set, on a 24-unit grid.
 *
 * These were Unicode glyphs, which meant the interface borrowed whatever the
 * operating system happened to have: a chess pawn stood for a team and a card
 * suit for notifications. They also changed shape, weight and baseline between
 * machines, so nothing lined up the same way twice.
 *
 * Drawn paths sharing one grid and one stroke weight are predictable instead.
 * They are declared here rather than pulled from a package because two dozen
 * shapes do not justify a dependency, and they inherit `currentColor`, so every
 * existing rule that tints `.icon` keeps working untouched.
 */
const ICON_PATHS = Object.freeze({
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  tools: 'M4 7h16M4 17h16M9.5 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M14.5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  workspace: 'M3.5 5.5h17v13h-17zM3.5 10h17M9 10v8.5',
  telemetry: 'M3.5 3.5v17h17M7 15.5l4-5 3 3 5-7',
  team: 'M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H6a3.5 3.5 0 0 0-3.5 3.5V20M12 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21.5 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 4.7a3 3 0 0 1 0 5.8',
  device: 'M3 5h18v11H3zM9 20h6M12 16v4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1',
  support: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.6 9.4a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.4-2.5 2.4M12 17h.01',
  docs: 'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8zM14 3v5h5M9 13h6M9 17h4',
  bell: 'M18 8.8a6 6 0 1 0-12 0c0 5.7-2.4 7.2-2.4 7.2h16.8S18 14.5 18 8.8M13.7 19.4a2 2 0 0 1-3.4 0',
  search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0M20 20l-4.9-4.9',
  arrow: 'M4 12h15M13 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  check: 'M4.5 12.5l5 5 10-11',
  lock: 'M4.5 10.5h15V21h-15zM8 10.5V7a4 4 0 0 1 8 0v3.5',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  shield: 'M12 2.5L4 6v6c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5V6z',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.2V10h5.8M12 7.5V12l3 2',
  language: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18',
  file: 'M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8zM14 3v5h5',
  sync: 'M20.4 11A8.5 8.5 0 0 0 6.1 6.1L3.5 8.8M3.6 13a8.5 8.5 0 0 0 14.3 4.9l2.6-2.7M3.5 4v4.8h4.8M20.5 20v-4.8h-4.8',
  upload: 'M12 15.5V3.5M7.5 8L12 3.5 16.5 8M4 15.5v3A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5.5M12 7.6h.01',
  close: 'M6 6l12 12M18 6L6 18',
  dot: 'M12 12h.01',
  // The two products, drawn rather than approximated with a spare glyph: a
  // bezier between anchor points for vector cleanup, stacked plates for
  // colour separation.
  vector: 'M4.5 17.5c5.5 0 9.5-11 15-11M2 15h4.5v4.5H2zM17.5 2.5H22V7h-4.5z',
  separation: 'M12 3L3 7.5l9 4.5 9-4.5zM3 12.2l9 4.5 9-4.5M3 16.8l9 4.5 9-4.5',
});

function Icon({ name, size = 18 }) {
  return (
    <span className="icon" style={{ '--icon-size': `${size}px` }} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d={ICON_PATHS[name] || ICON_PATHS.dot} />
      </svg>
    </span>
  );
}

function Status({ children, tone = 'success', icon = true }) {
  return (
    <span className={`status status-${tone}`}>
      {icon && <span className="status-dot" />}
      {children}
    </span>
  );
}

/**
 * States plainly where the numbers on screen come from.
 *
 * The distinction is not decoration. A reader must never have to guess whether
 * a metric reflects the platform database or a synthetic role walkthrough, so
 * the banner names the source on every view that shows data.
 */
function DataSourceBanner({ t, live, compact = false }) {
  const title = live ? t('liveDataTitle') : t('sampleData');
  const note = live ? t('liveDataNote') : t('sampleDataNote');

  return (
    <section className={compact ? 'sample-banner compact' : 'sample-banner'} aria-label={title}>
      <Icon name={live ? 'shield' : 'info'} />
      <div>
        <strong>{title}</strong>
        {!compact && <span>{note}</span>}
      </div>
    </section>
  );
}

function RoleContext({ t, language, projection }) {
  const role = projection.context.role;
  const accent = ROLE_META[role]?.accent || 'neutral';
  const contextTitleKey = projection.live ? 'roleContextTitleLive' : 'roleContextTitle';

  return (
    <section className={`role-context-card ${accent}`} aria-label={t(contextTitleKey)}>
      <div className="role-context-icon"><Icon name="shield" size={17} /></div>
      <div className="role-context-copy">
        <span>{t(contextTitleKey)}</span>
        <strong>{roleLabel(role, language)} · {projection.context.accountName || t('accountNotAssigned')}</strong>
        <small>{t(projection.context.scopeKey)}</small>
      </div>
      <Status tone={projection.live ? 'success' : 'neutral'}>
        {projection.live ? t('liveDataShort') : t('sampleDataShort')}
      </Status>
    </section>
  );
}

function statusText(t, status) {
  const map = {
    success: t('success'),
    error: t('error'),
    cancelled: t('localExecutionCancelled'),
    simulated: t('simulated'),
    active: t('active'),
    review: t('underReview'),
    verified: t('verified'),
    illustratorActive: t('illustratorActive'),
    pending: t('value_pending'),
    approved: t('value_approved'),
    suspended: t('value_suspended'),
    revoked: t('value_revoked'),
  };

  return map[status] || status;
}

function statusTone(status) {
  if (status === 'error' || status === 'revoked') return 'error';
  if (status === 'simulated' || status === 'pending' || status === 'suspended') return 'warning';
  if (status === 'review' || status === 'illustratorActive' || status === 'cancelled') return 'neutral';
  return 'success';
}

function relativeSeenLabel(t, lastSeen) {
  if (!lastSeen || lastSeen.kind === 'never') return t('valueNone');
  if (lastSeen.kind === 'now') return t('now');
  if (lastSeen.kind === 'minutes') return t('minutesAgo', { minutes: lastSeen.minutes });
  return new Date(lastSeen.value).toISOString().slice(0, 16).replace('T', ' ');
}

function createInitialLocalBridgeState() {
  return {
    availability: 'checking',
    connection: 'unpaired',
    health: null,
    status: null,
    host: null,
    execution: null,
    errorCode: '',
  };
}

function getLocalBridgePresentation(t, localBridge) {
  if (localBridge.availability === 'checking' || localBridge.connection === 'pairing') {
    return { tone: 'neutral', label: t('bridgeChecking'), actionLabel: t('refreshLocalBridge') };
  }
  if (localBridge.availability === 'unavailable') {
    return { tone: 'error', label: t('bridgeUnavailable'), actionLabel: t('connectLocalBridge') };
  }
  if (localBridge.connection === 'paired' && localBridge.host?.illustrator === 'connected') {
    return { tone: 'success', label: t('illustratorConnected'), actionLabel: t('refreshLocalBridge') };
  }
  if (localBridge.connection === 'paired') {
    return { tone: 'success', label: t('bridgeConnected'), actionLabel: t('refreshLocalBridge') };
  }
  return { tone: 'neutral', label: t('bridgeReadyToPair'), actionLabel: t('connectLocalBridge') };
}

function getLocalBridgeErrorMessage(t, errorCode) {
  const keyByCode = {
    BRIDGE_UNAVAILABLE: 'bridgeErrorUnavailable',
    BRIDGE_TIMEOUT: 'bridgeErrorUnavailable',
    BRIDGE_RESPONSE_INVALID: 'bridgeErrorResponse',
    PAIRING_CODE_INVALID: 'bridgeErrorPairingCode',
    PAIRING_RATE_LIMITED: 'bridgeErrorRateLimited',
    SESSION_UNAUTHORIZED: 'bridgeErrorSession',
  };
  return t(keyByCode[errorCode] || 'bridgeErrorGeneric');
}

function getLocalExecutionPresentation(t, execution) {
  if (!execution) return null;
  const tool = execution.tool === 'clean_vector_pro'
    ? TOOL_CONTRACT.cleanVector.productName
    : TOOL_CONTRACT.sepMaker.productName;
  const result = execution.result === 'success'
    ? { tone: 'success', label: t('localExecutionSuccess') }
    : execution.result === 'cancelled'
      ? { tone: 'neutral', label: t('localExecutionCancelled') }
      : { tone: 'error', label: t('localExecutionFailure') };
  const seconds = Math.round((execution.durationMs / 1000) * 10) / 10;
  return {
    ...result,
    tool,
    action: execution.action,
    duration: t('localExecutionDuration', { seconds }),
  };
}

function normalizeSearchValue(value, language) {
  return String(value || '')
    .toLocaleLowerCase(language)
    .normalize('NFD')
    .split('')
    .filter((character) => {
      const code = character.codePointAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useDialogAccessibility(dialog, setDialog) {
  const originRef = useRef(null);

  useEffect(() => {
    if (!dialog) return undefined;

    originRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const root = document.querySelector('[data-dialog-root="true"]');
    const focusables = root ? root.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) : [];
    const initial = Array.from(focusables).find((element) => element.autofocus) || focusables[0] || root;
    initial?.focus?.();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDialog(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const activeRoot = document.querySelector('[data-dialog-root="true"]');
      if (!activeRoot) return;
      const items = Array.from(activeRoot.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR));
      if (items.length === 0) {
        event.preventDefault();
        activeRoot.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      originRef.current?.focus();
    };
  }, [dialog, setDialog]);
}

function App() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [session, setSession] = useState(undefined);
  const [view, setView] = useState('dashboard');
  const [authError, setAuthError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [simulatedEvents, setSimulatedEvents] = useState([]);
  const [demoPreviewRole, setDemoPreviewRole] = useState(null);
  const [localBridge, setLocalBridge] = useState(createInitialLocalBridgeState);
  const [platformSnapshot, setPlatformSnapshot] = useState(emptyPlatformSnapshot);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformDataError, setPlatformDataError] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [accountContextId, setAccountContextId] = useState('');
  const [workstationBusy, setWorkstationBusy] = useState(false);
  const [workstationNotice, setWorkstationNotice] = useState('');
  const [usageReport, setUsageReport] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  // Intelligence's presentation mode. It lives here because it reshapes the
  // shell (a compact navigation rail), and it only applies on that view.
  const [defenseMode, setDefenseMode] = useState(false);
  const bridgeTokenRef = useRef('');
  const recordedExecutionsRef = useRef(new Map());
  // Results whose write is in flight right now, so the poll does not start a
  // second call for one the browser is already sending.
  const recordingExecutionsRef = useRef(new Set());
  const publishedCatalogRef = useRef('');

  useDialogAccessibility(dialog, setDialog);
  const t = useMemo(() => createTranslator(language), [language]);

  const canPreviewRoles = canPreviewDemoRoles(session);
  const isDemoPreview = demoPreviewRole !== null;
  const presentationSession = isDemoPreview ? getDemoSession(demoPreviewRole) : session;
  const role = presentationSession?.role;
  const roleTitle = roleLabel(role, language);
  const isLive = Boolean(session) && session.mode === 'firebase' && !isDemoPreview;
  const isSuperAdmin = session?.globalRole === ROLE_IDS.SUPER_ADMIN;
  const adminBackendState = getAdminBackendState();
  const backendReady = isAdminBackendReady();
  const installationId = useMemo(() => (isFirebaseConfigured ? getInstallationId() : ''), []);

  const dataAccountId = accountContextId || session?.activeAccountId || '';

  const projection = useMemo(() => (
    isLive
      ? getPlatformProjection({ session, snapshot: platformSnapshot, catalog })
      : getDemoProjection(presentationSession, simulatedEvents)
  ), [catalog, isLive, platformSnapshot, presentationSession, session, simulatedEvents]);

  const bridgePresentation = getLocalBridgePresentation(t, localBridge);

  const ownWorkstation = useMemo(() => (
    platformSnapshot.devices.find((device) => device.id === installationId) || null
  ), [installationId, platformSnapshot.devices]);

  /* ---------------------------------------------------------------- *
   * Platform data
   * ---------------------------------------------------------------- */

  const refreshPlatformSnapshot = useCallback(async () => {
    if (!isFirebaseConfigured || !session || session.mode !== 'firebase') {
      setPlatformSnapshot(emptyPlatformSnapshot());
      setPlatformDataError(false);
      return;
    }

    setPlatformLoading(true);
    setPlatformDataError(false);
    try {
      const membership = (session.memberships || [])
        .find((entry) => entry.accountId === dataAccountId) || null;
      const snapshot = await loadPlatformSnapshot({
        accountId: dataAccountId,
        uid: session.id,
        installationId,
        role: session.role,
        isSuperAdmin,
        allWorkspaces: isSuperAdmin || membership?.allWorkspaces === true,
        workspaceIds: membership?.workspaceIds || [],
      });
      setPlatformSnapshot(snapshot);
    } catch {
      setPlatformSnapshot(emptyPlatformSnapshot());
      setPlatformDataError(true);
    } finally {
      setPlatformLoading(false);
    }
  }, [dataAccountId, installationId, isSuperAdmin, session]);

  const refreshCatalog = useCallback(async () => {
    if (!isFirebaseConfigured || !backendReady || !dataAccountId || !session || session.mode !== 'firebase') {
      setCatalog(null);
      return;
    }

    try {
      setCatalog(await fetchAuthorizedCatalog({
        accountId: dataAccountId,
        deviceId: installationId,
      }));
    } catch {
      setCatalog(null);
    }
  }, [backendReady, dataAccountId, installationId, session]);

  /* ---------------------------------------------------------------- *
   * Local bridge
   * ---------------------------------------------------------------- */

  const refreshLocalBridge = useCallback(async () => {
    setLocalBridge((current) => ({ ...current, availability: 'checking', errorCode: '' }));
    try {
      const health = await checkLocalBridgeHealth();
      const token = bridgeTokenRef.current;
      if (!token) {
        setLocalBridge({
          availability: 'available',
          connection: 'unpaired',
          health,
          status: null,
          host: null,
          execution: null,
          errorCode: '',
        });
        return;
      }

      try {
        const details = await getLocalBridgeStatus(token);
        const latestExecution = await getLatestLocalBridgeExecution(token);
        setLocalBridge({
          availability: 'available',
          connection: 'paired',
          health,
          status: details.status,
          host: details.host,
          execution: latestExecution.execution,
          errorCode: '',
        });
      } catch (error) {
        bridgeTokenRef.current = '';
        publishedCatalogRef.current = '';
        setLocalBridge({
          availability: 'available',
          connection: 'unpaired',
          health,
          status: null,
          host: null,
          execution: null,
          errorCode: error instanceof LocalBridgeError ? error.code : 'BRIDGE_UNAVAILABLE',
        });
      }
    } catch (error) {
      bridgeTokenRef.current = '';
      publishedCatalogRef.current = '';
      setLocalBridge({
        availability: 'unavailable',
        connection: 'unpaired',
        health: null,
        status: null,
        host: null,
        execution: null,
        errorCode: error instanceof LocalBridgeError ? error.code : 'BRIDGE_UNAVAILABLE',
      });
    }
  }, []);

  const connectLocalBridge = useCallback(async (pairingCode) => {
    setLocalBridge((current) => ({ ...current, connection: 'pairing', errorCode: '' }));
    try {
      const pairing = await pairLocalBridge(pairingCode);
      bridgeTokenRef.current = pairing.session.accessToken;
      publishedCatalogRef.current = '';
      const details = await getLocalBridgeStatus(bridgeTokenRef.current);
      const latestExecution = await getLatestLocalBridgeExecution(bridgeTokenRef.current);
      // Publish immediately after a successful pairing as well as through the
      // reactive updater below. This closes the short lifecycle gap in which
      // an already-resolved catalog could otherwise wait for another render
      // before the CEP panel is allowed to read it.
      if (catalog) {
        const authorized = (catalog.tools || []).filter((tool) => tool.authorized);
        const fingerprint = JSON.stringify({
          device: catalog.deviceAuthorized,
          reason: catalog.deviceReason,
          tools: authorized.map((tool) => `${tool.toolId}@${tool.version}`),
        });
        await publishLocalBridgeCatalog(bridgeTokenRef.current, {
          deviceAuthorized: catalog.deviceAuthorized === true,
          deviceReason: catalog.deviceReason || null,
          tools: authorized.map((tool) => ({
            toolId: tool.toolId,
            displayName: tool.displayName,
            version: tool.version,
          })),
        });
        publishedCatalogRef.current = fingerprint;
        setWorkstationNotice(t('workstationPublishedToBridge'));
      }
      setLocalBridge({
        availability: 'available',
        connection: 'paired',
        health: {
          apiVersion: 'v1',
          bridgeVersion: pairing.status.connectorVersion,
          state: 'ready',
          transport: 'loopback',
          pairingRequired: false,
        },
        status: details.status,
        host: details.host,
        execution: latestExecution.execution,
        errorCode: '',
      });
      return true;
    } catch (error) {
      const errorCode = error instanceof LocalBridgeError ? error.code : 'BRIDGE_UNAVAILABLE';
      bridgeTokenRef.current = '';
      setLocalBridge((current) => ({
        ...current,
        availability: errorCode === 'BRIDGE_UNAVAILABLE' || errorCode === 'BRIDGE_TIMEOUT' ? 'unavailable' : 'available',
        connection: 'unpaired',
        errorCode,
      }));
      return false;
    }
  }, [catalog, t]);

  /**
   * Persist a finished Illustrator run.
   *
   * The bridge holds one sanitized result in memory and the browser polls it,
   * so the same result is seen repeatedly. `executionId` carries over from the
   * bridge message and the backend stores it under that id, which makes the
   * write idempotent; the attempt map below avoids a pointless round trip.
   *
   * A failed write is retried, because the usual cause is transient, but only
   * a fixed number of times. `telemetry-retry-policy.js` explains why that
   * ceiling exists and what it costs to omit it.
   */
  const persistExecution = useCallback(async (result) => {
    if (!isLive || !backendReady || !result) return;
    const attempts = recordedExecutionsRef.current.get(result.messageId) ?? 0;
    if (!mayAttemptRecord(attempts)) return;
    // The poll fires on a fixed interval, but a cold function can take several
    // seconds to answer. Without this the next tick starts a second call for a
    // result already in flight, and production showed three invocations where
    // one was needed. The backend is idempotent, so no duplicate was stored --
    // the cost was billed calls, not wrong data. The attempt ceiling bounded
    // it; this stops it happening at all.
    if (recordingExecutionsRef.current.has(result.messageId)) return;

    const event = toExecutionEvent(result, {
      accountId: dataAccountId,
      workspaceId: catalog?.workspaceId || '',
      deviceId: installationId,
    }, catalog?.tools || []);
    if (!event) return;

    // Counted before the call, so a request that never settles still consumes
    // its attempt rather than leaving the poll free to start another.
    recordedExecutionsRef.current.set(result.messageId, nextAttemptCount(attempts));
    recordingExecutionsRef.current.add(result.messageId);
    try {
      await recordExecution(event);
      recordedExecutionsRef.current.set(result.messageId, nextAttemptCount(attempts, { succeeded: true }));
      setWorkstationNotice(t('workstationExecutionRecorded'));
      await refreshPlatformSnapshot();
    } catch {
      setWorkstationNotice(t('workstationExecutionRecordFailed'));
    } finally {
      // Released whatever happened, so a genuine retry stays possible within
      // the ceiling; a failure that held the lock forever would silently spend
      // the remaining attempts on nothing.
      recordingExecutionsRef.current.delete(result.messageId);
    }
  }, [backendReady, catalog, dataAccountId, installationId, isLive, refreshPlatformSnapshot, t]);

  const refreshLatestLocalExecution = useCallback(async () => {
    const token = bridgeTokenRef.current;
    if (!token) return;

    try {
      const latestExecution = await getLatestLocalBridgeExecution(token);
      setLocalBridge((current) => (current.connection === 'paired'
        ? { ...current, execution: latestExecution.execution }
        : current));
      if (latestExecution.execution) await persistExecution(latestExecution.execution);
    } catch (error) {
      if (error instanceof LocalBridgeError && error.code === 'SESSION_UNAUTHORIZED') {
        refreshLocalBridge();
      }
    }
  }, [persistExecution, refreshLocalBridge]);

  /* ---------------------------------------------------------------- *
   * Effects
   * ---------------------------------------------------------------- */

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Operations Suite · ${t('pageTitle')}`;
    persistLanguage(language);
  }, [language, t]);

  useEffect(() => {
    const unsubscribe = observeSession(
      (nextSession) => {
        setDemoPreviewRole(null);
        setSession(nextSession);
        setAccountContextId(nextSession?.activeAccountId || '');
        setAuthError('');
        recordedExecutionsRef.current = new Map();
      },
      () => {
        setAuthError('session');
        setSession(null);
      },
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshPlatformSnapshot().catch(() => {
      if (!cancelled) setPlatformSnapshot(emptyPlatformSnapshot());
    });
    return () => { cancelled = true; };
  }, [refreshPlatformSnapshot]);

  // A Super Administrator signing in without a membership still needs an
  // account context. It must be one the backend will actually accept, so the
  // choice lives in a tested selector rather than in this effect.
  useEffect(() => {
    if (accountContextId || !isSuperAdmin || platformSnapshot.accounts.length === 0) return;
    const defaultAccountId = selectDefaultAccountContext(platformSnapshot.accounts);
    if (defaultAccountId) setAccountContextId(defaultAccountId);
  }, [accountContextId, isSuperAdmin, platformSnapshot.accounts]);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    if (!session || session.role === 'client') {
      bridgeTokenRef.current = '';
      setLocalBridge(createInitialLocalBridgeState());
      return undefined;
    }

    let cancelled = false;
    refreshLocalBridge().catch(() => {
      if (!cancelled) setLocalBridge((current) => ({ ...current, availability: 'unavailable' }));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshLocalBridge, session?.id, session?.role]);

  useEffect(() => {
    if (!session || session.role === 'client' || localBridge.connection !== 'paired') return undefined;
    const intervalId = window.setInterval(() => { refreshLatestLocalExecution(); }, BRIDGE_POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [localBridge.connection, refreshLatestLocalExecution, session?.id, session?.role]);

  /**
   * Hand the workstation catalog to the local bridge.
   *
   * The bridge holds no identity and makes no authorization decision. It
   * receives the catalog the backend already resolved for this operator on
   * this station, and serves exactly that to the Illustrator panel — so what
   * an administrator grants in the console is what appears in Illustrator, and
   * nothing else can be introduced along the way.
   */
  useEffect(() => {
    if (localBridge.connection !== 'paired' || !bridgeTokenRef.current || !catalog) return;

    const authorized = (catalog.tools || []).filter((tool) => tool.authorized);
    const fingerprint = JSON.stringify({
      device: catalog.deviceAuthorized,
      reason: catalog.deviceReason,
      tools: authorized.map((tool) => `${tool.toolId}@${tool.version}`),
    });
    if (publishedCatalogRef.current === fingerprint) return;

    publishLocalBridgeCatalog(bridgeTokenRef.current, {
      deviceAuthorized: catalog.deviceAuthorized === true,
      deviceReason: catalog.deviceReason || null,
      tools: authorized.map((tool) => ({
        toolId: tool.toolId,
        displayName: tool.displayName,
        version: tool.version,
      })),
    }).then(() => {
      publishedCatalogRef.current = fingerprint;
      setWorkstationNotice(t('workstationPublishedToBridge'));
    }).catch(() => {
      publishedCatalogRef.current = '';
    });
  }, [catalog, localBridge.connection, t]);

  const defenseActive = defenseMode && view === 'intelligence';
  useEffect(() => {
    if (view !== 'intelligence') setDefenseMode(false);
  }, [view]);

  const navigation = useMemo(() => {
    const all = [
      { id: 'dashboard', icon: 'grid', label: t('dashboard') },
      { id: 'tools', icon: 'tools', label: t('tools') },
      { id: 'workspaces', icon: 'workspace', label: t('workspaces') },
      { id: 'telemetry', icon: 'telemetry', label: t('telemetry') },
      { id: 'team', icon: 'team', label: t('team') },
      { id: 'devices', icon: 'device', label: t('devices') },
      { id: 'administration', icon: 'shield', label: t('administration') },
      { id: 'intelligence', icon: 'activity', label: t('intelligence') },
      { id: 'settings', icon: 'settings', label: t('settings') },
    ];

    return all.filter((item) => visibleCapabilities(role).includes(item.id));
  }, [role, t]);

  const searchResults = useMemo(() => {
    const needle = normalizeSearchValue(query.trim(), language);
    if (!needle) return [];

    const candidates = [
      ...navigation.map((item) => ({
        id: `view-${item.id}`,
        title: item.label,
        detail: t('viewDetails'),
        view: item.id,
      })),
      ...(canAccess(role, 'tools') ? (projection.tools.entries || []).map((tool) => ({
        id: `tool-${tool.toolId}`,
        title: tool.name,
        detail: t('tools'),
        view: 'tools',
      })) : []),
      ...projection.searchCandidates
        .filter((item) => canAccess(role, item.view))
        .map((item) => ({
          ...item,
          detail: item.roleEntry ? roleLabel(item.detail, language) : item.detail,
        })),
    ];

    return candidates
      .filter((item) => normalizeSearchValue(`${item.title} ${item.detail}`, language).includes(needle))
      .slice(0, 7);
  }, [language, navigation, projection.searchCandidates, projection.tools.entries, query, role, t]);

  const changeLanguage = (nextLanguage) => {
    if (nextLanguage === language) return;
    persistLanguage(nextLanguage);
    setLanguage(nextLanguage);
  };

  const replaceHistoryView = useCallback((nextView) => {
    if (typeof window === 'undefined') return;
    window.history.replaceState({
      ...(window.history.state || {}),
      [HISTORY_VIEW_KEY]: nextView,
    }, '');
  }, []);

  useEffect(() => {
    if (!role || typeof window === 'undefined') return undefined;

    if (!window.history.state?.[HISTORY_VIEW_KEY]) {
      replaceHistoryView(view);
    }

    const restoreView = (event) => {
      const requestedView = event.state?.[HISTORY_VIEW_KEY];
      setView(requestedView && canAccess(role, requestedView) ? requestedView : 'dashboard');
      setQuery('');
      setSearchOpen(false);
      setNotificationsOpen(false);
    };

    window.addEventListener('popstate', restoreView);
    return () => window.removeEventListener('popstate', restoreView);
  }, [replaceHistoryView, role, view]);

  const goTo = (nextView) => {
    const targetView = canAccess(role, nextView) ? nextView : 'dashboard';
    if (targetView !== view && typeof window !== 'undefined') {
      window.history.pushState({
        ...(window.history.state || {}),
        [HISTORY_VIEW_KEY]: targetView,
      }, '');
    }
    setView(targetView);
    setQuery('');
    setSearchOpen(false);
    setNotificationsOpen(false);
  };

  const openDialog = (type, details = {}) => {
    setNotificationsOpen(false);
    setDialog({ type, ...details });
  };

  const simulateEvent = (tool) => {
    const sampleEvent = createScopedDemoEvent(projection, tool);
    if (!sampleEvent) return;
    setSimulatedEvents((events) => [sampleEvent, ...events]);
  };

  const signOut = async () => {
    await signOutSession();
    bridgeTokenRef.current = '';
    publishedCatalogRef.current = '';
    setLocalBridge(createInitialLocalBridgeState());
    setDialog(null);
    setDemoPreviewRole(null);
    setSession(null);
    setPlatformSnapshot(emptyPlatformSnapshot());
    setCatalog(null);
    replaceHistoryView('dashboard');
  };

  const selectDemoPreviewRole = (nextRole) => {
    setDemoPreviewRole(nextRole);
    setSimulatedEvents([]);
    setView('dashboard');
    replaceHistoryView('dashboard');
    setQuery('');
    setSearchOpen(false);
    setNotificationsOpen(false);
  };

  const exitDemoPreview = () => {
    setDemoPreviewRole(null);
    setSimulatedEvents([]);
    setView('dashboard');
    replaceHistoryView('dashboard');
    setDialog(null);
  };

  /**
   * Apply one administrative operation.
   *
   * The call is the only way state changes, and the reload afterwards is what
   * makes the console honest: the tables show what the backend actually wrote,
   * never an optimistic guess about what it should have written.
   */
  const submitAdministrativeOperation = useCallback(async (operation, payload) => {
    await submitAdminOperation(operation, payload);
    await refreshPlatformSnapshot();
    await refreshCatalog();
  }, [refreshCatalog, refreshPlatformSnapshot]);

  const enrollThisWorkstation = useCallback(async () => {
    const workspaceId = catalog?.workspaceId
      || projection.workspaces[0]?.id
      || '';
    if (!dataAccountId || !workspaceId) {
      setWorkstationNotice(t('workstationEnrollFailed'));
      return;
    }

    setWorkstationBusy(true);
    try {
      await enrollWorkstation({
        accountId: dataAccountId,
        workspaceId,
        label: defaultWorkstationLabel(),
        platform: detectPlatform(),
      });
      await refreshPlatformSnapshot();
      await refreshCatalog();
      setWorkstationNotice('');
    } catch {
      setWorkstationNotice(t('workstationEnrollFailed'));
    } finally {
      setWorkstationBusy(false);
    }
  }, [catalog, dataAccountId, projection.workspaces, refreshCatalog, refreshPlatformSnapshot, t]);

  /**
   * Measure how close the deployment is to the no-cost quotas.
   *
   * Deliberately on demand. The measurement itself costs a small number of
   * reads, and a panel whose purpose is to keep costs at zero must not run on
   * every page load.
   */
  const measurePlatformUsage = useCallback(async () => {
    if (!isLive) return;

    setUsageLoading(true);
    try {
      setUsageReport(await measureUsage({
        accountIds: platformSnapshot.accounts.map((account) => account.id),
      }));
    } catch {
      setUsageReport(null);
    } finally {
      setUsageLoading(false);
    }
  }, [isLive, platformSnapshot.accounts]);

  const rotateWorkstationIdentity = useCallback(() => {
    rotateInstallationId();
    setWorkstationNotice(t('workstationRotated'));
    window.location.reload();
  }, [t]);

  if (session === undefined) {
    return <LoadingScreen t={t} />;
  }

  if (!session) {
    const errorMessage = authError === 'session' ? t('sessionError') : authError ? t('loginError') : '';
    return (
      <LoginScreen
        language={language}
        onChangeLanguage={changeLanguage}
        t={t}
        error={errorMessage}
        onSignIn={async (email, password) => {
          setAuthError('');
          try {
            setSession(await signIn(email, password));
          } catch {
            setAuthError('login');
          }
        }}
      />
    );
  }

  if (role === UNASSIGNED_ROLE) {
    return <UnassignedAccessScreen t={t} session={presentationSession} onSignOut={isFirebaseConfigured ? signOut : null} />;
  }

  const nextLanguage = language === 'es' ? 'en' : 'es';

  return (
    <main className={defenseActive ? 'app-shell defense-mode' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand-block">
          <img src="/operations-icon.png" alt={t('brandAlt')} className="brand-logo" />
          <div>
            <strong>OPERATIONS</strong>
            <span>{t('product')}</span>
          </div>
        </div>

        <button type="button" className="account-card" onClick={() => openDialog('profile')}>
          <div className="avatar">{presentationSession.initials}</div>
          <div className="account-copy">
            <strong>{presentationSession.displayName || '—'}</strong>
            <span>{roleTitle}</span>
          </div>
          <Icon name="arrow" size={15} />
        </button>

        {presentationSession.mode === 'demo' && (
          <section className="role-demo">
            <div className="eyebrow">{t('demoSession')}</div>
            <label htmlFor="role-select">{t('role')}</label>
            <select
              id="role-select"
              value={role}
              onChange={(event) => {
                if (isDemoPreview) {
                  selectDemoPreviewRole(event.target.value);
                } else {
                  setSession(getDemoSession(event.target.value));
                  setSimulatedEvents([]);
                  goTo('dashboard');
                }
              }}
            >
              {Object.entries(ROLE_META).filter(([id]) => id !== UNASSIGNED_ROLE).map(([id, item]) => (
                <option key={id} value={id}>{item[language]}</option>
              ))}
            </select>
            <small>{t('demoScenarioNote')}</small>
          </section>
        )}

        <nav className="sidebar-nav" aria-label={t('primaryNavigation')}>
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              aria-label={item.label}
              title={defenseActive ? item.label : undefined}
              onClick={() => goTo(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="nav-item" aria-label={t('support')} title={defenseActive ? t('support') : undefined} onClick={() => openDialog('support')}>
            <Icon name="support" />
            <span>{t('support')}</span>
          </button>
          <button type="button" className="nav-item" aria-label={t('documentation')} title={defenseActive ? t('documentation') : undefined} onClick={() => openDialog('documentation')}>
            <Icon name="docs" />
            <span>{t('documentation')}</span>
          </button>
          <div className="system-version">OS · {t('foundation', { version: FOUNDATION_VERSION })}</div>
        </div>
      </aside>

      <section className="content-shell">
        <header className="topbar">
          <div className="search-wrapper">
            <div className="search-box">
              <Icon name="search" />
              <input
                aria-label={t(isLive ? 'searchLive' : 'search')}
                placeholder={t(isLive ? 'searchLive' : 'search')}
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
              />
            </div>
            {searchOpen && query.trim() && (
              <div className="search-results" role="region" aria-label={t('searchResults')}>
                {searchResults.length ? searchResults.map((result) => (
                  <button
                    type="button"
                    key={result.id}
                    className="search-result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => goTo(result.view)}
                  >
                    <strong>{result.title}</strong>
                    <span>{result.detail}</span>
                  </button>
                )) : <p>{t('searchNoResults')}</p>}
                <small>{t('searchHint')}</small>
              </div>
            )}
          </div>

          <div className="topbar-actions">
            {role !== 'client' && (
              <>
                <Status tone={bridgePresentation.tone}>{bridgePresentation.label}</Status>
                <button type="button" className="sync-button" onClick={() => openDialog('bridge-connect')}>
                  <Icon name="sync" />
                  {bridgePresentation.actionLabel}
                </button>
              </>
            )}
            <button
              type="button"
              className="language-button"
              aria-label={t('changeLanguage', { language: t(nextLanguage === 'es' ? 'spanish' : 'english') })}
              onClick={() => changeLanguage(nextLanguage)}
            >
              <Icon name="language" />
              {language.toUpperCase()}
            </button>
            <div className="notifications-wrap">
              <button
                type="button"
                className="icon-button"
                aria-label={t('notifications')}
                aria-expanded={notificationsOpen}
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Icon name="bell" />
              </button>
              {notificationsOpen && (
                <NotificationPanel t={t} notifications={projection.notifications} live={projection.live} />
              )}
            </div>
            <button
              type="button"
              className="profile-dot"
              onClick={() => openDialog('profile')}
              aria-label={t('profileTitle')}
              title={t('profileTitle')}
            >
              {session.initials}
            </button>
          </div>
        </header>

        <div className="page-content">
          {isLive && platformDataError && (
            <section className="workspace-note" role="alert">
              <Icon name="info" />
              <div>
                <strong>{t('platformDataLoadFailedTitle')}</strong>
                <span>{t('platformDataLoadFailedBody')}</span>
              </div>
            </section>
          )}
          <RoleContext t={t} language={language} projection={projection} />
          {view === 'dashboard' && (
            <Dashboard
              t={t}
              language={language}
              role={role}
              onNavigate={goTo}
              onConnector={() => openDialog('bridge-connect')}
              session={presentationSession}
              projection={projection}
              localBridge={localBridge}
            />
          )}
          {view === 'intelligence' && canAccess(role, 'intelligence') && (
            <IntelligenceCenter
              t={t}
              language={language}
              session={presentationSession}
              defenseMode={defenseActive}
              onDefenseModeChange={setDefenseMode}
            />
          )}
          {view === 'tools' && canAccess(role, 'tools') && (
            <Tools
              t={t}
              projection={projection}
              localBridge={localBridge}
              onConnector={() => openDialog('bridge-connect')}
              workstation={ownWorkstation}
              installationId={installationId}
              onEnroll={enrollThisWorkstation}
              onRotateIdentity={rotateWorkstationIdentity}
              busy={workstationBusy}
              notice={workstationNotice}
              backendReady={backendReady}
            />
          )}
          {view === 'workspaces' && canAccess(role, 'workspaces') && (
            <Workspaces t={t} role={role} projection={projection} onOpenDialog={openDialog} />
          )}
          {view === 'telemetry' && canAccess(role, 'telemetry') && (
            <Telemetry t={t} projection={projection} onSimulate={simulateEvent} />
          )}
          {view === 'team' && canAccess(role, 'team') && (
            <Team t={t} language={language} projection={projection} onOpenDialog={openDialog} />
          )}
          {view === 'devices' && canAccess(role, 'devices') && (
            <Devices t={t} language={language} role={role} projection={projection} onNavigate={goTo} />
          )}
          {view === 'administration' && canAccess(role, 'administration') && (
            <AdministrationConsole
              t={t}
              language={language}
              snapshot={platformSnapshot}
              backendState={adminBackendState}
              refreshing={platformLoading}
              onRefresh={refreshPlatformSnapshot}
              onOpenOperation={(operation, initialValues) => openDialog('admin-operation', { operation, initialValues })}
              administeredAccountId={dataAccountId}
              onSelectAdministeredAccount={setAccountContextId}
              usageReport={usageReport}
              usageLoading={usageLoading}
              onMeasureUsage={measurePlatformUsage}
              StatusPill={Status}
              IconComponent={Icon}
            />
          )}
          {view === 'settings' && canAccess(role, 'settings') && (
            <Settings t={t} language={language} onChangeLanguage={changeLanguage} />
          )}
        </div>
      </section>

      <Dialog
        dialog={dialog}
        language={language}
        session={presentationSession}
        t={t}
        onClose={() => setDialog(null)}
        onSignOut={isFirebaseConfigured ? signOut : null}
        canPreviewRoles={canPreviewRoles}
        isDemoPreview={isDemoPreview}
        onSelectDemoPreviewRole={(nextRole) => {
          selectDemoPreviewRole(nextRole);
          setDialog(null);
        }}
        onExitDemoPreview={exitDemoPreview}
        onSubmitAdminOperation={submitAdministrativeOperation}
        platformSnapshot={platformSnapshot}
        administeredAccountId={dataAccountId}
        adminBackendState={adminBackendState}
        onSwitchActiveAccount={(accountId) => {
          setSession((current) => switchActiveAccount(current, accountId));
          setAccountContextId(accountId);
          setDialog(null);
        }}
        localBridge={localBridge}
        onPairLocalBridge={connectLocalBridge}
        onRefreshLocalBridge={refreshLocalBridge}
      />
    </main>
  );
}

function Dashboard({ t, language, role, onNavigate, onConnector, session, projection, localBridge }) {
  const { dashboard, telemetry } = projection;
  const isClient = telemetry.kind === 'aggregate';
  const bridgePresentation = getLocalBridgePresentation(t, localBridge);

  return (
    <>
      <section className="hero-row">
        <div>
          <div className={`eyebrow ${ROLE_META[role]?.accent || 'cyan'}`}><Icon name="shield" size={14} /> {t(projection.context.kickerKey)}</div>
          <h1>{t('welcome', { name: session.displayName?.split(' ')[0] || '—' })}</h1>
          <p>{t(projection.context.subtitleKey)}</p>
        </div>
        <div className="workspace-health">
          <span>{isClient ? t('serviceStatusTitle') : t('activeWorkspace')}</span>
          <strong>{isClient ? projection.context.accountName : (dashboard.primaryWorkspaceName || t('accountNotAssigned'))}</strong>
          <Status tone={statusTone(isClient ? projection.team.serviceStatus : dashboard.primaryWorkspaceState)}>
            {statusText(t, isClient ? projection.team.serviceStatus : dashboard.primaryWorkspaceState)}
          </Status>
        </div>
      </section>

      <DataSourceBanner t={t} live={projection.live} />

      {!isClient && <LocalExecutionNotice t={t} execution={localBridge.execution} />}

      <section className={`metric-grid ${dashboard.metrics.length === 3 ? 'role-metric-grid' : ''}`}>
        {dashboard.metrics.map((metric) => (
          <article className="metric-card" key={metric.id}>
            <span>{t(metric.id)}</span>
            <strong>{metric.value}</strong>
            <small className={metric.kind}>{t(metric.detailKey)}</small>
          </article>
        ))}
      </section>

      {isClient ? (
        <section className="service-dashboard-panel">
          <SectionTitle title={t('serviceOverviewTitle')} subtitle={t('serviceOverviewDescription')} action={t('telemetry')} onAction={() => onNavigate('telemetry')} />
          <AggregateTelemetry t={t} aggregates={telemetry.aggregates} />
        </section>
      ) : (
        <section className="dashboard-layout">
          <div className="main-stack">
            <SectionTitle
              title={t('openProductionCenter')}
              subtitle={t('localProcessingNote')}
              action={t('viewHistory')}
              onAction={() => onNavigate('tools')}
            />
            <AuthorizedToolGrid
              t={t}
              projection={projection}
              bridgePresentation={bridgePresentation}
              onConnector={onConnector}
              primaryWorkspaceName={dashboard.primaryWorkspaceName}
              localBridge={localBridge}
            />
          </div>
          <aside className="local-card">
            <div className="card-icon"><Icon name="lock" size={20} /></div>
            <h2>{t('localConfiguration')}</h2>
            <p>{t('localConfigurationNote')}</p>
            <div className="config-path">{t(projection.live ? 'workspaceMetadataDemoLive' : 'workspaceMetadataDemo')}</div>
            <span className="dim-badge">{projection.live ? t('liveDataShort') : t('sampleDataShort')}</span>
          </aside>
        </section>
      )}

      {!isClient && (
        <section className="activity-panel">
          <SectionTitle
            title={t('recentActivity')}
            subtitle={t(projection.live ? 'preparedEventsLive' : 'preparedEvents', { count: telemetry.events.length })}
            action={t('telemetry')}
            onAction={() => onNavigate('telemetry')}
          />
          <div className="activity-list">
            {telemetry.events.length === 0
              ? <p className="admin-drafts-empty">{t('adminNoRecords')}</p>
              : telemetry.events.slice(0, 4).map((item) => <ActivityRow key={item.id} item={item} t={t} language={language} />)}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * The tools an operator may actually run.
 *
 * In live mode every card comes from the backend-resolved catalog, so what is
 * displayed is precisely what the administrator authorized. A tool that is not
 * authorized is still shown, with the reason, rather than hidden: an operator
 * who can read "licence expired" acts on it, while one who sees an empty
 * screen files a support ticket.
 */
function AuthorizedToolGrid({ t, projection, bridgePresentation, onConnector, primaryWorkspaceName, localBridge }) {
  if (!projection.live) {
    return (
      <div className="tool-grid">
        <ToolCard
          tone="cyan"
          icon={<Icon name="vector" size={44} />}
          title={TOOL_CONTRACT.cleanVector.productName}
          version="v3.6.0"
          description={t('cleanVectorDescription')}
          details={[
            [t('toolStatus'), bridgePresentation.label],
            [t('activeWorkspace'), primaryWorkspaceName || t('accountNotAssigned')],
            [t('application'), localBridge.host?.illustrator === 'connected' ? t('illustratorConnected') : t('illustratorDisconnected')],
          ]}
          button={bridgePresentation.actionLabel}
          onAction={onConnector}
        />
        <ToolCard
          tone="orange"
          icon={<Icon name="separation" size={44} />}
          title={TOOL_CONTRACT.sepMaker.productName}
          version="v1.6"
          description={t('sepMakerDescription')}
          details={[
            [t('activeWorkspace'), primaryWorkspaceName || t('accountNotAssigned')],
            [t('toolStatus'), bridgePresentation.label],
            ['BASE', t('ready')],
          ]}
          button={bridgePresentation.actionLabel}
          onAction={onConnector}
        />
      </div>
    );
  }

  const entries = projection.tools.entries || [];
  if (entries.length === 0) {
    return (
      <section className="inline-notice">
        <Icon name="lock" />
        <p>{t('workstationCatalogEmpty')}</p>
      </section>
    );
  }

  return (
    <div className="tool-grid">
      {entries.map((tool) => (
        <ToolCard
          key={tool.toolId}
          tone={tool.accent}
          icon={tool.toolId === TOOL_REGISTRY_IDS.cleanVector ? '⌁' : '◇'}
          title={tool.name}
          version={tool.version ? `v${tool.version}` : t('valueNone')}
          description={tool.authorized
            ? t(tool.toolId === TOOL_REGISTRY_IDS.cleanVector ? 'cleanVectorDescription' : 'sepMakerDescription')
            : labelForReason(t, tool.reason)}
          details={[
            [t('toolStatus'), tool.authorized ? t('value_active') : labelForReason(t, tool.reason)],
            [t('activeWorkspace'), primaryWorkspaceName || t('accountNotAssigned')],
            [t('application'), localBridge.host?.illustrator === 'connected' ? t('illustratorConnected') : t('illustratorDisconnected')],
          ]}
          button={bridgePresentation.actionLabel}
          onAction={onConnector}
          muted={!tool.authorized}
        />
      ))}
    </div>
  );
}

function LocalExecutionNotice({ t, execution }) {
  const presentation = getLocalExecutionPresentation(t, execution);
  if (!presentation) return null;

  return (
    <section className="local-execution-notice" aria-live="polite" aria-label={t('latestLocalExecution')}>
      <div>
        <span>{t('latestLocalExecution')}</span>
        <strong>{presentation.tool} · {presentation.action}</strong>
        <small>{t('localExecutionResultAvailable')}</small>
      </div>
      <div className="local-execution-result">
        <Status tone={presentation.tone}>{presentation.label}</Status>
        <strong>{presentation.duration}</strong>
      </div>
    </section>
  );
}

function ToolCard({ tone, icon, title, version, description, details, button, onAction, muted = false }) {
  return (
    <article className={`tool-card ${tone}${muted ? ' muted' : ''}`}>
      <div className="tool-visual"><span>{icon}</span><div className="tool-glow" /></div>
      <div className="tool-content">
        <div className="tool-heading"><h2>{title}</h2><span className="version-chip">{version}</span></div>
        <p>{description}</p>
        <div className="tool-details">
          {details.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <button type="button" className={`primary-button ${tone}`} onClick={onAction}>
          {button}
          <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
}

function ActivityRow({ item, t }) {
  return (
    <div className="activity-row">
      <div className={`activity-mark ${item.kind}`}><Icon name={item.tool.includes('Clean') ? 'tools' : 'workspace'} /></div>
      <div className="activity-main"><strong>{item.tool}</strong><span>{item.action} · {item.event}</span></div>
      <div className="activity-time"><span>{t('duration')}</span><strong>{item.duration}</strong></div>
      <Status tone={statusTone(item.status)}>{statusText(t, item.status)}</Status>
      <time>{item.time}</time>
    </div>
  );
}

/**
 * The workstation an operator is sitting at.
 *
 * Enrolment lives beside the tools rather than in the fleet view because it is
 * the operator's own action, not an administrative one: they present a station
 * for approval, and an administrator decides. The identifier shown is a local
 * random value that can be rotated at any time — never a MAC address, a serial
 * number, or a machine name.
 */
function WorkstationPanel({
  t, workstation, installationId, onEnroll, onRotateIdentity, busy, notice, projection, backendReady,
}) {
  if (!projection.live || !backendReady) return null;

  const status = workstation?.status || 'unknown';
  const statusCopy = {
    approved: t('workstationApproved'),
    pending: t('workstationPending'),
    suspended: t('workstationSuspended'),
    revoked: t('workstationRevoked'),
  }[status] || t('workstationNotEnrolled');

  return (
    <section className="workstation-panel" aria-label={t('workstationTitle')}>
      <div className="workstation-head">
        <div>
          <div className="eyebrow cyan"><Icon name="device" size={14} /> {t('workstationKicker')}</div>
          <h2>{t('workstationTitle')}</h2>
          <p>{t('workstationDescription')}</p>
        </div>
        <Status tone={statusTone(status === 'unknown' ? 'pending' : status)}>{statusCopy}</Status>
      </div>
      <div className="workstation-details">
        <div>
          <span>{t('workstationLabel')}</span>
          <strong>{workstation?.label || defaultWorkstationLabel()}</strong>
        </div>
        <div>
          <span>{t('columnIdentifier')}</span>
          <strong>{installationId}</strong>
        </div>
        <div>
          <span>{t('workstationAuthorizedTools', { count: projection.tools.runnableCount || 0 })}</span>
          <strong>{projection.tools.deviceAuthorized ? t('value_approved') : labelForReason(t, projection.tools.deviceReason)}</strong>
        </div>
      </div>
      <p className="workstation-note"><Icon name="lock" size={15} />{t('workstationIdentityNote')}</p>
      {notice && <p className="admin-submit-result" role="status"><Icon name="info" size={15} />{notice}</p>}
      <div className="workstation-actions">
        <button type="button" className="primary-button cyan" onClick={onEnroll} disabled={busy}>
          {busy ? t('workstationEnrolling') : t('workstationEnroll')}<Icon name="arrow" />
        </button>
        <button type="button" className="ghost-action" onClick={onRotateIdentity}>{t('workstationRotate')}</button>
      </div>
    </section>
  );
}

function Tools({
  t, projection, onConnector, localBridge, workstation, installationId,
  onEnroll, onRotateIdentity, busy, notice, backendReady,
}) {
  const bridgePresentation = getLocalBridgePresentation(t, localBridge);
  const entries = projection.tools.entries || [];

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow cyan">{t('toolsKicker')}</div>
          <h1>{t('tools')}</h1>
          <p>{t(projection.live ? 'toolsDescriptionLive' : 'toolsDescription')}</p>
        </div>
        <Status tone={bridgePresentation.tone}>{bridgePresentation.label}</Status>
      </section>
      <DataSourceBanner t={t} live={projection.live} compact />

      <WorkstationPanel
        t={t}
        workstation={workstation}
        installationId={installationId}
        onEnroll={onEnroll}
        onRotateIdentity={onRotateIdentity}
        busy={busy}
        notice={notice}
        projection={projection}
        backendReady={backendReady}
      />

      {projection.live ? (
        entries.length === 0 ? (
          <section className="inline-notice"><Icon name="lock" /><p>{t('workstationCatalogEmpty')}</p></section>
        ) : (
          <div className="tool-grid full">
            {entries.map((tool) => (
              <ToolCard
                key={tool.toolId}
                tone={tool.accent}
                icon={tool.toolId === TOOL_REGISTRY_IDS.cleanVector ? '⌁' : '◇'}
                title={tool.name}
                version={tool.version ? `v${tool.version}` : t('valueNone')}
                description={tool.authorized
                  ? t(tool.toolId === TOOL_REGISTRY_IDS.cleanVector ? 'cleanVectorDescription' : 'sepMakerDescription')
                  : labelForReason(t, tool.reason)}
                details={[
                  [t('trigger'), t(tool.toolId === TOOL_REGISTRY_IDS.cleanVector ? 'cleanTrigger' : 'sepTrigger')],
                  [t('toolStatus'), tool.authorized ? t('value_active') : labelForReason(t, tool.reason)],
                  [t('columnTarget'), tool.assignedVia ? labelForValue(t, tool.assignedVia.target) : t('valueNone')],
                ]}
                button={bridgePresentation.actionLabel}
                onAction={onConnector}
                muted={!tool.authorized}
              />
            ))}
          </div>
        )
      ) : (
        <div className="tool-grid full">
          <ToolCard
            tone="cyan"
            icon={<Icon name="vector" size={44} />}
            title={TOOL_CONTRACT.cleanVector.productName}
            version="v3.6.0"
            description={t('cleanVectorDescription')}
            details={[
              [t('trigger'), t('cleanTrigger')],
              [t('reservedEvent'), TOOL_CONTRACT.cleanVector.eventType],
              [t('toolStatus'), bridgePresentation.label],
            ]}
            button={bridgePresentation.actionLabel}
            onAction={onConnector}
          />
          <ToolCard
            tone="orange"
            icon={<Icon name="separation" size={44} />}
            title={TOOL_CONTRACT.sepMaker.productName}
            version="v1.6"
            description={t('sepMakerDescription')}
            details={[
              [t('trigger'), t('sepTrigger')],
              [t('reservedEvent'), TOOL_CONTRACT.sepMaker.eventType],
              [t('toolStatus'), bridgePresentation.label],
            ]}
            button={bridgePresentation.actionLabel}
            onAction={onConnector}
          />
        </div>
      )}

      <section className="integration-strip"><Icon name="info" /><p>{t('toolsIntegrationNote')}</p></section>
    </>
  );
}

function Workspaces({ t, role, projection, onOpenDialog }) {
  const canManageWorkspaces = role === 'super_admin';
  const isArtist = role === 'artist';

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow orange">{t('workspaceKicker')}</div>
          <h1>{t('workspaceRegistry')}</h1>
          <p>{t('workspaceDescription')}</p>
        </div>
        {canManageWorkspaces && (
          <button type="button" className="primary-button cyan" onClick={() => onOpenDialog('workspace')}>
            <Icon name="plus" />
            {t('newWorkspace')}
          </button>
        )}
      </section>
      <DataSourceBanner t={t} live={projection.live} compact />
      <div className="workspace-note">
        <Icon name="lock" />
        <div><strong>{t(projection.live ? 'workspaceCloudNoticeLive' : 'workspaceCloudNotice')}</strong><span>{t('localConfigurationNote')}</span></div>
      </div>
      <section className="table-card">
        <div className="table-heading">
          <h2>{t('authorizedWorkspaces')}</h2>
          <Status tone="neutral">{t('activeWorkspaces', { count: projection.workspaces.length })}</Status>
        </div>
        {projection.workspaces.length === 0 ? (
          <p className="admin-drafts-empty">{t('adminNoRecords')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('workspace')}</th>
                  {!isArtist && <th>{t('client')}</th>}
                  {!isArtist && <th>{t('team')}</th>}
                  {!isArtist && <th>{t('managers')}</th>}
                  {!isArtist && <th>{t('artists')}</th>}
                  <th>{t('lastActivity')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {projection.workspaces.map((workspace) => (
                  <tr key={workspace.id}>
                    <td><strong>{workspace.name}</strong><small>{t(projection.live ? 'workspaceMetadataDemoLive' : 'workspaceMetadataDemo')}</small></td>
                    {!isArtist && <td>{workspace.accountName}</td>}
                    {!isArtist && <td>{workspace.teamName || '—'}</td>}
                    {!isArtist && <td>{workspace.managerCount}</td>}
                    {!isArtist && <td>{workspace.artistCount}</td>}
                    <td>{projection.live ? relativeSeenLabel(t, workspace.lastActivity) : workspace.lastActivity}</td>
                    <td><Status tone={statusTone(workspace.state)}>{statusText(t, workspace.state)}</Status></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function AggregateTelemetry({ t, aggregates }) {
  if (!aggregates.length) {
    return <p className="aggregate-empty">{t('noAggregateTelemetry')}</p>;
  }

  return (
    <div className="aggregate-grid">
      {aggregates.map((aggregate) => (
        <article className="aggregate-card" key={aggregate.id}>
          <div className="aggregate-card-heading">
            <div><span>{t('workspace')}</span><strong>{aggregate.workspaceName}</strong></div>
            <Status tone="success">{aggregate.successRate}</Status>
          </div>
          <div className="aggregate-card-metrics">
            <div><span>{t('serviceRuns')}</span><strong>{aggregate.totalRuns}</strong></div>
            <div><span>{t('successfulRuns')}</span><strong>{aggregate.successfulRuns}</strong></div>
            <div><span>{TOOL_CONTRACT.cleanVector.productName}</span><strong>{aggregate.cleanVectorRuns}</strong></div>
            <div><span>{TOOL_CONTRACT.sepMaker.productName}</span><strong>{aggregate.sepMakerRuns}</strong></div>
          </div>
          <small>{aggregate.day}</small>
        </article>
      ))}
    </div>
  );
}

function Telemetry({ t, projection, onSimulate }) {
  const { telemetry } = projection;
  const isAggregate = telemetry.kind === 'aggregate';

  if (isAggregate) {
    return (
      <>
        <section className="page-heading">
          <div>
            <div className="eyebrow blue">{t('serviceTelemetryKicker')}</div>
            <h1>{t('serviceTelemetryTitle')}</h1>
            <p>{t('serviceTelemetryDescription')}</p>
          </div>
          <Status tone="neutral">{t('aggregateOnly')}</Status>
        </section>
        <DataSourceBanner t={t} live={projection.live} compact />
        <section className="integration-strip"><Icon name="lock" /><p>{t('clientTelemetryPrivacy')}</p></section>
        <AggregateTelemetry t={t} aggregates={telemetry.aggregates} />
      </>
    );
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow cyan">{t('telemetryKicker')}</div>
          <h1>{t('telemetryTitle')}</h1>
          {/*
            * Live telemetry and the demonstration share this screen, and the
            * demonstration copy used to describe both. It announced that real
            * telemetry "will be implemented" and called the list sample data
            * while the screen displayed executions that had genuinely been
            * persisted in Firestore — next to a badge reading "real data".
            * A screen that denies what it is showing teaches the reader to
            * distrust every other claim on it.
            */}
          <p>{t(projection.live ? 'telemetryDescriptionLive' : 'telemetryDescription')}</p>
        </div>
        <div className="counter-card">
          <span>{projection.live ? t('recentEvents') : t('simulatedEvents')}</span>
          <strong>{projection.live ? telemetry.events.length : telemetry.simulatedCount}</strong>
        </div>
      </section>
      <DataSourceBanner t={t} live={projection.live} compact />
      {!projection.live && telemetry.canSimulate && (
        <section className="trigger-grid">
          <article className="trigger-card cyan">
            <div className="trigger-head"><span className="tool-symbol">⌁</span><div><h2>{TOOL_CONTRACT.cleanVector.productName}</h2><p>{t('cleanTrigger')}</p></div></div>
            <div className="trigger-flow"><span>{TOOL_CONTRACT.cleanVector.action}</span><Icon name="arrow" /><span>{TOOL_CONTRACT.cleanVector.eventType}</span><Icon name="arrow" /><span>{t('eventPrepared')}</span></div>
            <button type="button" className="primary-button cyan" onClick={() => onSimulate('cleanVector')}>
              {t('simulateDemoEvent')}<Icon name="arrow" />
            </button>
          </article>
          <article className="trigger-card orange">
            <div className="trigger-head"><span className="tool-symbol">◇</span><div><h2>{TOOL_CONTRACT.sepMaker.productName}</h2><p>{t('sepTrigger')}</p></div></div>
            <div className="trigger-flow"><span>{TOOL_CONTRACT.sepMaker.action}</span><Icon name="arrow" /><span>{TOOL_CONTRACT.sepMaker.eventType}</span><Icon name="arrow" /><span>{t('eventPrepared')}</span></div>
            <button type="button" className="primary-button orange" onClick={() => onSimulate('sepMaker')}>
              {t('simulateDemoEvent')}<Icon name="arrow" />
            </button>
          </article>
        </section>
      )}
      {!projection.live && !telemetry.canSimulate && (
        <section className="inline-notice"><Icon name="lock" /><p>{t('telemetryReadOnlyNotice')}</p></section>
      )}
      <section className="integration-strip"><Icon name="info" /><p>{t('telemetryFlowNotice')}</p></section>
      <section className="table-card">
        <div className="table-heading"><h2>{t(projection.live ? 'recentEvents' : 'simulatedEvents')}</h2><Status tone="neutral">{t('telemetryPrivacy')}</Status></div>
        {telemetry.events.length === 0 ? (
          <p className="admin-drafts-empty">{t('adminNoRecords')}</p>
        ) : (
          <div className="activity-list padded">
            {telemetry.events.map((item) => <ActivityRow key={item.id} item={item} t={t} />)}
          </div>
        )}
      </section>
    </>
  );
}

function Team({ t, language, projection, onOpenDialog }) {
  const isClient = projection.team.kind === 'service';

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow purple">{t('teamKicker')}</div>
          <h1>{isClient ? t('clientCollaboration') : t('team')}</h1>
          <p>{t(projection.live ? 'teamDescriptionLive' : 'teamDescription')}</p>
        </div>
        <Status tone="neutral">{isClient ? t('clientView') : t(projection.live ? 'teamActiveLive' : 'teamActive')}</Status>
      </section>
      <DataSourceBanner t={t} live={projection.live} compact />
      {isClient ? (
        <section className="service-dashboard-panel">
          <SectionTitle title={t('serviceCollaborationTitle')} subtitle={t('serviceCollaborationDescription')} />
          <ServiceStatusCard t={t} aggregate={projection.team.serviceAggregate} status={projection.team.serviceStatus} />
        </section>
      ) : projection.team.people.length === 0 ? (
        <p className="admin-drafts-empty">{t('adminNoRecords')}</p>
      ) : (
        <div className="people-grid">
          {projection.team.people.map((person) => (
            <article className="person-card" key={person.id}>
              <div className="avatar large">{person.initials}</div>
              <div>
                <h2>{person.name}</h2>
                <p>{roleLabel(person.role, language)}</p>
                <Status tone={statusTone(person.status)}>{statusText(t, person.status)}</Status>
              </div>
              <button type="button" className="ghost-button" aria-label={`${t('viewDetails')}: ${person.name}`} onClick={() => onOpenDialog('person', { person })}>
                <Icon name="arrow" />
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ServiceStatusCard({ t, aggregate, status }) {
  return (
    <article className="service-status-card">
      <div className="card-icon"><Icon name="shield" size={20} /></div>
      <div>
        <h2>{t('serviceStatusTitle')}</h2>
        <p>{t('serviceStatusDescription')}</p>
        <Status tone={statusTone(status)}>{statusText(t, status)}</Status>
      </div>
      {aggregate && <div className="service-status-metrics"><span>{t('serviceRuns')}</span><strong>{aggregate.totalRuns}</strong><small>{aggregate.successRate}</small></div>}
    </article>
  );
}

/**
 * Fleet view.
 *
 * Approving, suspending, and revoking a station happens in the administration
 * console, which is where every audited mutation lives. This view is the
 * operational read of the same records.
 */
function Devices({ t, role, projection, onNavigate }) {
  if (role !== 'super_admin') return <NoPermission t={t} />;

  const devices = projection.devices;
  const counts = {
    approved: devices.filter((device) => device.verification === 'approved').length,
    pending: devices.filter((device) => device.verification === 'pending').length,
    revoked: devices.filter((device) => device.verification === 'revoked' || device.verification === 'suspended').length,
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow cyan">{t('devicesKicker')}</div>
          <h1>{t('deviceSecurityTitle')}</h1>
          <p>{t('deviceSecurityDescription')}</p>
        </div>
        <button type="button" className="primary-button cyan" onClick={() => onNavigate('administration')}>
          <Icon name="shield" />
          {t('adminConsoleTitle')}
        </button>
      </section>
      <DataSourceBanner t={t} live={projection.live} compact />
      <div className="metric-grid compact">
        <article className="metric-card"><span>{t('authorized')}</span><strong>{counts.approved}</strong><small className="positive">{t(projection.live ? 'authorizedDetailLive' : 'authorizedDetail')}</small></article>
        <article className="metric-card"><span>{t('pending')}</span><strong>{counts.pending}</strong><small className="warning">{t('pendingDetail')}</small></article>
        <article className="metric-card"><span>{t('revoked')}</span><strong>{counts.revoked}</strong><small className="neutral">{t('revokedDetail')}</small></article>
      </div>
      <section className="table-card">
        <div className="table-heading"><h2>{t('authorizedStations')}</h2><Status tone="neutral">{t('protectedData')}</Status></div>
        {devices.length === 0 ? (
          <p className="admin-drafts-empty">{t('adminNoRecords')}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('workstationName')}</th>
                  <th>{t('assignedUser')}</th>
                  <th>{t('operatingSystem')}</th>
                  <th>{t('verification')}</th>
                  <th>{t('lastActivity')}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id}>
                    <td><strong>{device.name}</strong><small>{t('opaqueIdentity')}</small></td>
                    <td>{device.user || t('valueNone')}</td>
                    <td>{device.operatingSystem}</td>
                    <td><Status tone={statusTone(device.verification)}>{statusText(t, device.verification)}</Status></td>
                    <td>{projection.live ? relativeSeenLabel(t, device.lastSeen) : (device.lastSeen.kind === 'now' ? t('now') : t('minutesAgo', { minutes: device.lastSeen.minutes }))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Settings({ t, language, onChangeLanguage }) {
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow orange">OPERATIONS SUITE</div>
          <h1>{t('accountSettings')}</h1>
          <p>{t('settingsDescription')}</p>
        </div>
      </section>
      <div className="settings-grid">
        <section className="setting-card">
          <h2>{t('language')}</h2>
          <p>{t('languageDescription')}</p>
          <div className="segmented">
            <button type="button" className={language === 'es' ? 'selected' : ''} onClick={() => onChangeLanguage('es')}>{t('spanish')}</button>
            <button type="button" className={language === 'en' ? 'selected' : ''} onClick={() => onChangeLanguage('en')}>{t('english')}</button>
          </div>
        </section>
        <section className="setting-card">
          <h2>{t('integrationArchitecture')}</h2>
          <p>{t('architectureDescription')}</p>
          <Status tone="neutral">{t('foundation', { version: FOUNDATION_VERSION })}</Status>
        </section>
      </div>
      <section className="architecture-card">
        <div><span>01</span><h2>{t('applicationWeb')}</h2><p>{t('applicationWebDetail')}</p></div>
        <Icon name="arrow" />
        <div><span>02</span><h2>{t('localConnector')}</h2><p>{t('localConnectorDetail')}</p></div>
        <Icon name="arrow" />
        <div><span>03</span><h2>{t('illustrator')}</h2><p>{t('illustratorDetail')}</p></div>
      </section>
    </>
  );
}

function NoPermission({ t }) {
  return (
    <section className="empty-state">
      <div className="empty-icon"><Icon name="lock" size={32} /></div>
      <h1>{t('noPermissionTitle')}</h1>
      <p>{t('noPermissionBody')}</p>
    </section>
  );
}

/**
 * Shown while the session is still being resolved.
 *
 * The wait is real, so it gets a moving indicator: a still page with a line of
 * text cannot be told apart from a page that has stopped working. The spinner
 * is decorative and hidden from assistive technology — `role="status"` on the
 * region is what announces the heading, which is already translated — and the
 * stylesheet's reduced-motion rule stops it turning for anyone who asked for
 * less movement, leaving the same text in place.
 */
function LoadingScreen({ t }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" role="status" aria-live="polite">
        <img src="/operations-icon.png" alt={t('brandAlt')} className="auth-logo" />
        <span className="auth-kicker">OPERATIONS SUITE</span>
        <h1>{t('loadingSecureAccess')}</h1>
        <span className="spinner" aria-hidden="true" />
      </section>
    </main>
  );
}

function UnassignedAccessScreen({ t, session, onSignOut }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <img src="/operations-icon.png" alt={t('brandAlt')} className="auth-logo" />
          <div><span className="auth-kicker">OPERATIONS</span><strong>{t('product')}</strong></div>
        </div>
        <div className="auth-heading">
          <div className="eyebrow orange"><Icon name="lock" size={14} /> {t('secureAccess')}</div>
          <h1>{t('unassignedAccessTitle')}</h1>
          <p>{t('unassignedAccessBody')}</p>
        </div>
        <div className="auth-notice"><Icon name="info" />{session.displayName || '—'}</div>
        {onSignOut && <button type="button" className="primary-button orange unassigned-signout" onClick={onSignOut}>{t('signOut')}</button>}
      </section>
    </main>
  );
}

function LoginScreen({ language, onChangeLanguage, t, error, onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const nextLanguage = language === 'es' ? 'en' : 'es';

  const submit = async (event) => {
    event.preventDefault();
    setPending(true);
    try {
      await onSignIn(email, password);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand">
          <img src="/operations-icon.png" alt={t('brandAlt')} className="auth-logo" />
          <div><span className="auth-kicker">OPERATIONS</span><strong>{t('product')}</strong></div>
        </div>
        <div className="auth-heading">
          <div className="eyebrow cyan"><Icon name="shield" size={14} /> {t('secureAccess')}</div>
          <h1>{t('signIn')}</h1>
          <p>{t('secureAccessDescription')}</p>
        </div>
        {isFirebaseConfigured ? (
          <form onSubmit={submit} className="auth-form">
            <label>{t('email')}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label>{t('password')}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
            {error && <p className="auth-error">{error}</p>}
            <button className="primary-button cyan" type="submit" disabled={pending}>{pending ? t('signingIn') : t('signIn')}<Icon name="arrow" /></button>
          </form>
        ) : <div className="auth-notice"><Icon name="info" />{t('demoSession')}</div>}
        <div className="auth-footer">
          <span>{isFirebaseConfigured ? t('firebaseAuthentication') : t('sampleData')}</span>
          <button
            type="button"
            className="language-button"
            aria-label={t('changeLanguage', { language: t(nextLanguage === 'es' ? 'spanish' : 'english') })}
            onClick={() => onChangeLanguage(nextLanguage)}
          >
            <Icon name="language" /> {language.toUpperCase()}
          </button>
        </div>
      </section>
    </main>
  );
}

function NotificationPanel({ t, notifications, live }) {
  return (
    <section className="notification-panel" role="status" aria-label={t('notifications')}>
      <div className="popover-heading">
        <strong>{t('notifications')}</strong>
        <Status tone={live ? 'success' : 'neutral'}>{live ? t('liveDataShort') : t('sampleDataShort')}</Status>
      </div>
      {notifications.map((notification) => (
        <article key={notification.id} className="notification-item">
          <Icon name="info" />
          <div>
            <strong>{t(notification.titleKey, notification.values || {})}</strong>
            <p>{t(notification.bodyKey, notification.values || {})}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

function LocalBridgeDialog({
  t,
  localBridge,
  onClose,
  onPairLocalBridge,
  onRefreshLocalBridge,
}) {
  const [pairingCode, setPairingCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const bridgePresentation = getLocalBridgePresentation(t, localBridge);
  const connected = localBridge.connection === 'paired';
  const errorCode = attempted || localBridge.availability === 'unavailable' ? localBridge.errorCode : '';

  const refresh = async () => {
    setSubmitting(true);
    await onRefreshLocalBridge();
    setSubmitting(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    setAttempted(true);
    setSubmitting(true);
    const paired = await onPairLocalBridge(pairingCode);
    setSubmitting(false);
    if (paired) setPairingCode('');
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card bridge-modal" data-dialog-root="true" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description">
        <button type="button" className="modal-close" aria-label={t('close')} onClick={onClose}><Icon name="close" /></button>
        <div className="eyebrow cyan"><Icon name="sync" size={14} /> {t('localConnector')}</div>
        <h2 id="dialog-title">{t('localBridgeTitle')}</h2>
        <p id="dialog-description">{connected ? t('bridgePairedDescription') : t('bridgeDialogDescription')}</p>

        <div className="bridge-state" aria-live="polite">
          <Status tone={bridgePresentation.tone}>{bridgePresentation.label}</Status>
          <span>{connected ? t('bridgeTokenMemoryOnly') : t('bridgeLoopbackOnly')}</span>
        </div>

        {!connected && (
          <>
            <ol className="dialog-list bridge-instructions">
              <li>{t('bridgeInstructionOne')}</li>
              <li>{t('bridgeInstructionTwo')}</li>
              <li>{t('bridgeInstructionThree')}</li>
            </ol>
            <div className="bridge-command"><code>npm run bridge:dev</code></div>
            <form className="bridge-pair-form" onSubmit={submit}>
              <label htmlFor="local-bridge-pairing-code">{t('bridgePairingCode')}</label>
              <input
                id="local-bridge-pairing-code"
                value={pairingCode}
                maxLength={32}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck="false"
                placeholder="OS-XXXX-XXXX"
                onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              />
              {errorCode && <p className="bridge-form-error" role="alert">{getLocalBridgeErrorMessage(t, errorCode)}</p>}
              <div className="dialog-actions">
                <button type="button" className="ghost-action" onClick={refresh} disabled={submitting}>{t('refreshLocalBridge')}</button>
                <button type="submit" className="primary-button cyan" disabled={submitting || pairingCode.trim().length < 4}>
                  {t('pairLocalBridge')}<Icon name="arrow" />
                </button>
              </div>
            </form>
          </>
        )}

        {connected && (
          <div className="dialog-actions">
            <button type="button" className="ghost-action" onClick={refresh} disabled={submitting}>{t('refreshLocalBridge')}</button>
            <button type="button" className="primary-button cyan" onClick={onClose}>{t('close')}</button>
          </div>
        )}
      </section>
    </div>
  );
}

function Dialog({
  dialog,
  language,
  session,
  t,
  onClose,
  onSignOut,
  onSwitchActiveAccount,
  canPreviewRoles,
  isDemoPreview,
  onSelectDemoPreviewRole,
  onExitDemoPreview,
  onSubmitAdminOperation,
  platformSnapshot,
  administeredAccountId,
  adminBackendState,
  localBridge,
  onPairLocalBridge,
  onRefreshLocalBridge,
}) {
  if (!dialog) return null;

  if (dialog.type === 'admin-operation') {
    return (
      <AdminOperationDialog
        key={`${dialog.operation}-${JSON.stringify(dialog.initialValues || {})}`}
        t={t}
        operation={dialog.operation}
        snapshot={platformSnapshot}
        administeredAccountId={administeredAccountId}
        initialValues={dialog.initialValues || {}}
        onClose={onClose}
        onSubmit={onSubmitAdminOperation}
        IconComponent={Icon}
        StatusPill={Status}
        backendLabel={adminBackendState === 'ready' ? t('adminBackendReadyProduction') : t('adminBackendReadyEmulator')}
      />
    );
  }

  if (dialog.type === 'bridge-connect') {
    return (
      <LocalBridgeDialog
        t={t}
        localBridge={localBridge}
        onClose={onClose}
        onPairLocalBridge={onPairLocalBridge}
        onRefreshLocalBridge={onRefreshLocalBridge}
      />
    );
  }

  let title = '';
  let body = '';
  let details = null;
  let footer = null;
  let accountSelector = null;
  let demoRolePreview = null;

  if (dialog.type === 'connector') {
    title = t('connectorRequirementsTitle');
    body = t('connectorRequirementsBody');
    details = [
      t('connectorRequirementOne'),
      t('connectorRequirementTwo'),
      t('connectorRequirementThree'),
    ];
  } else if (dialog.type === 'sync') {
    title = t('syncTitle');
    body = t('syncBody');
    details = [t('connectorRequirementOne'), t('connectorRequirementThree')];
  } else if (dialog.type === 'workspace') {
    title = t('workspaceAdminTitle');
    body = t('workspaceAdminBody');
  } else if (dialog.type === 'device') {
    title = t('deviceAdminTitle');
    body = t('deviceAdminBody');
  } else if (dialog.type === 'person') {
    title = t('personDetailsTitle');
    body = t('personDetailsBody');
    details = dialog.person ? [
      `${t('role')}: ${roleLabel(dialog.person.role, language)}`,
      `${t('status')}: ${statusText(t, dialog.person.status)}`,
    ] : null;
  } else if (dialog.type === 'support') {
    title = t('supportTitle');
    body = t('supportBody');
  } else if (dialog.type === 'documentation') {
    title = t('documentationTitle');
    body = t('documentationBody');
  } else if (dialog.type === 'profile') {
    title = t('profileTitle');
    body = isDemoPreview ? t('demoRolePreviewActiveBody') : t('profileActionUnavailable');
    details = [
      `${t('currentSession')}: ${session.mode === 'demo' ? t('demoSession') : t('firebaseSession')}`,
      `${t('activeAccount')}: ${session.accountName || t('accountNotAssigned')}`,
      `${t('role')}: ${roleLabel(session.role, language)}`,
    ];
    const activeMemberships = (session.memberships || []).filter((membership) => membership.status === 'active');
    if (activeMemberships.length > 1) {
      accountSelector = (
        <div className="account-switcher">
          <span>{t('switchActiveAccount')}</span>
          <div>
            {activeMemberships.map((membership) => (
              <button
                type="button"
                key={membership.accountId}
                className={membership.accountId === session.activeAccountId ? 'selected' : ''}
                onClick={() => onSwitchActiveAccount(membership.accountId)}
              >
                {membership.accountName || membership.accountId}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (canPreviewRoles) {
      demoRolePreview = (
        <section className="demo-role-preview">
          <span>{t('demoRolePreviewTitle')}</span>
          <p>{t('demoRolePreviewBody')}</p>
          <label htmlFor="demo-preview-role">{t('demoRolePreviewSelect')}</label>
          <select
            id="demo-preview-role"
            value={isDemoPreview ? session.role : ''}
            onChange={(event) => {
              if (event.target.value) onSelectDemoPreviewRole(event.target.value);
            }}
          >
            <option value="" disabled>{t('demoRolePreviewPlaceholder')}</option>
            {Object.entries(ROLE_META)
              .filter(([id]) => id !== UNASSIGNED_ROLE && id !== ROLE_IDS.SUPER_ADMIN)
              .map(([id, item]) => <option key={id} value={id}>{item[language]}</option>)}
          </select>
          {isDemoPreview && (
            <button type="button" className="ghost-action" onClick={onExitDemoPreview}>
              {t('exitDemoRolePreview')}
            </button>
          )}
        </section>
      );
    }
    if (onSignOut) {
      footer = <button type="button" className="primary-button orange" onClick={onSignOut}>{t('signOut')}</button>;
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" data-dialog-root="true" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-description">
        <button type="button" className="modal-close" aria-label={t('close')} onClick={onClose}><Icon name="close" /></button>
        <div className="eyebrow cyan"><Icon name="info" size={14} /> {t('product')}</div>
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-description">{body}</p>
        {details && <ul className="dialog-list">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
        {accountSelector}
        {demoRolePreview}
        <div className="dialog-actions">
          {footer}
          <button type="button" className="ghost-action" onClick={onClose}>{t('close')}</button>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, subtitle, action, onAction }) {
  return (
    <div className="section-title">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action && <button type="button" className="text-action" onClick={onAction}>{action}<Icon name="arrow" /></button>}
    </div>
  );
}

export default App;
