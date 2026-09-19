import { useMemo, useState } from 'react';
import { ADMIN_OPERATIONS } from '../admin-operations.js';
import { auditExportFilename, buildAuditCsv } from '../audit-export.js';
import { buildEffectiveAccessReport } from '../effective-access.js';
import { ADMIN_FORMS, ADMIN_SECTIONS, listOperationsForSection } from '../forms/admin-forms.js';
import { READ_LIMITS } from '../read-limits.js';
import { selectOperableAccounts } from '../selectors/platform-projection.js';
import { formatBytes, formatPercentage } from '../usage-quotas.js';
import {
  buildOptionSources,
  formatInstant,
  labelForAuditAction,
  labelForRole,
  labelForValue,
} from './admin-presentation.js';

/**
 * The Super Administrator console.
 *
 * Every table below is persisted state read through Firestore Rules, and every
 * button opens an operation that reaches the platform through an audited
 * callable. There is no local-only mode and no draft list: what is shown is
 * what exists, and what is changed is changed for everyone.
 */

const SECTION_ICONS = Object.freeze({
  accounts: 'shield',
  workspaces: 'workspace',
  users: 'team',
  teams: 'team',
  roles: 'lock',
  tools: 'tools',
  assignments: 'grid',
  licenses: 'shield',
  devices: 'device',
  audit: 'docs',
  usage: 'telemetry',
});

const DEVICE_ACTIONS = Object.freeze(['approved', 'suspended', 'revoked']);

/** Sections that read data rather than change it, so they offer no operations. */
const READ_ONLY_SECTIONS = Object.freeze(['audit', 'usage']);

/**
 * Which bounded reads feed each section.
 *
 * Every Firestore query behind this console carries a limit, which is what
 * keeps one screen from becoming thousands of document reads. The cost is that
 * a table can stop short without looking like it did, so each section declares
 * the reads it depends on and says when one of them came back full.
 */
const SECTION_COLLECTIONS = Object.freeze({
  accounts: ['accounts'],
  workspaces: ['workspaces'],
  users: ['users', 'members'],
  teams: ['teams'],
  roles: ['customRoles'],
  tools: ['tools'],
  assignments: ['assignments'],
  licenses: ['licenses'],
  devices: ['devices'],
  audit: ['auditLogs', 'platformAuditLogs'],
  usage: [],
});

/**
 * Hand the operator a file.
 *
 * The object URL is revoked immediately after the click: leaving it alive
 * keeps the whole exported document in memory for the life of the tab, and an
 * audit export of a busy account is not small.
 */
function downloadTextFile(filename, text, mimeType = 'text/csv;charset=utf-8') {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

function statusTone(status) {
  if (['active', 'approved', 'published'].includes(status)) return 'success';
  if (['pending', 'invited', 'draft'].includes(status)) return 'warning';
  if (['suspended', 'archived', 'disabled', 'deprecated'].includes(status)) return 'neutral';
  return 'error';
}

function usageTone(level) {
  if (level === 'over') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'watch') return 'neutral';
  return 'success';
}

function labelForAccessReason(t, reason) {
  return reason ? t(`reason_${reason.replaceAll('.', '_')}`) : t('valueNone');
}

/**
 * How much room is left before Firebase would start charging.
 *
 * The caveat is rendered before the numbers, not after them. An operator who
 * reads "you are using 0.2% of your quota" and only afterwards learns it was
 * an estimate has already formed the wrong impression.
 */
function UsagePanel({ t, language, report, loading, onMeasure, StatusPill, IconComponent }) {
  return (
    <>
      <section className="workspace-note admin-notice">
        <IconComponent name="info" />
        <div>
          <strong>{t('usageTitle')}</strong>
          <span>{t('usageEstimateNotice')}</span>
        </div>
      </section>

      <div className="admin-draft-heading">
        <div>
          <h2>{t('usageDescription')}</h2>
          <p>{t('usageMeasureCost')}</p>
        </div>
        <button type="button" className="primary-button cyan" onClick={onMeasure} disabled={loading}>
          {loading ? t('usageMeasuring') : t('usageMeasure')}
          <IconComponent name="sync" />
        </button>
      </div>

      {!report ? (
        <p className="admin-drafts-empty">{t('usageNotMeasured')}</p>
      ) : (
        <>
          <div className="metric-grid compact">
            <article className="metric-card">
              <span>{t('usageTotalDocuments')}</span>
              <strong>{report.totalDocuments}</strong>
              <small className="neutral">{formatBytes(report.storedBytes)}</small>
            </article>
            <article className="metric-card">
              <span>{t('usageExecutionsThisMonth')}</span>
              <strong>{report.executionsThisMonth}</strong>
              <small className="neutral">{formatInstant(report.measuredAt, language)}</small>
            </article>
            <article className="metric-card">
              <span>{t('columnStatus')}</span>
              <strong>{t(`usageLevel_${report.level}`)}</strong>
              <small className={report.level === 'ok' ? 'positive' : 'warning'}>
                {t('usageMeasuredAt', { time: formatInstant(report.measuredAt, language) })}
              </small>
            </article>
          </div>

          {report.unavailable.length > 0 && (
            <p className="admin-form-error" role="status">
              {t('usageUnavailable', { count: report.unavailable.length })}
            </p>
          )}

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('columnName')}</th>
                  <th>{t('columnUsed')}</th>
                  <th>{t('columnLimit')}</th>
                  <th>{t('columnRemaining')}</th>
                  <th>{t('columnStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((metric) => (
                  <tr key={metric.id}>
                    <td><strong>{t(`usageMetric_${metric.id}`)}</strong></td>
                    <td>{metric.unit === 'bytes' ? formatBytes(metric.used) : metric.used}</td>
                    <td>{metric.unit === 'bytes' ? formatBytes(metric.limit) : metric.limit}</td>
                    <td>
                      {metric.unit === 'bytes' ? formatBytes(metric.remaining) : metric.remaining}
                      <small>{formatPercentage(metric.ratio)}</small>
                    </td>
                    <td>
                      <StatusPill tone={usageTone(metric.level)}>{t(`usageLevel_${metric.level}`)}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('columnName')}</th>
                  <th>{t('columnDocuments')}</th>
                  <th>{t('columnEstimatedSize')}</th>
                </tr>
              </thead>
              <tbody>
                {report.collections.map((entry) => (
                  <tr key={entry.name}>
                    <td><strong>{entry.name}</strong></td>
                    <td>{entry.count}</td>
                    <td>{formatBytes(entry.estimatedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="workstation-note">
            <IconComponent name="lock" size={15} />
            {report.quotasVerifiedOn
              ? `${t('usageQuotasVerified', { date: report.quotasVerifiedOn })} ${t('usageCostGuide')}`
              : t('usageCostGuide')}
          </p>
        </>
      )}
    </>
  );
}

function Table({ columns, rows, emptyLabel, renderRow }) {
  if (rows.length === 0) return <p className="admin-drafts-empty">{emptyLabel}</p>;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

function EffectiveAccessPanel({ t, report, accountName, sources, onClose, StatusPill }) {
  if (!report) return null;

  return (
    <section className="table-card access-review-card" aria-live="polite" aria-labelledby="effective-access-title">
      <div className="table-heading">
        <div>
          <h2 id="effective-access-title">{t('adminEffectiveAccessTitle', { name: report.user.displayName })}</h2>
          <p>{t('adminEffectiveAccessDescription')}</p>
        </div>
        <button type="button" className="ghost-action" onClick={onClose}>{t('adminEffectiveAccessClose')}</button>
      </div>

      <div className="access-review-summary">
        <div><span>{t('columnAccount')}</span><strong>{accountName}</strong></div>
        <div><span>{t('columnRole')}</span><strong>{report.membership ? labelForRole(t, report.membership.role) : t('valueNone')}</strong></div>
        <div><span>{t('columnStatus')}</span><StatusPill tone={statusTone(report.user.status)}>{labelForValue(t, report.user.status)}</StatusPill></div>
        <div>
          <span>{t('columnScope')}</span>
          <strong>{report.membership
            ? report.membership.allWorkspaces
              ? t('field_allWorkspaces')
              : report.membership.workspaceIds.map(sources.workspaceLabel).join(', ') || t('valueNone')
            : t('valueNone')}</strong>
        </div>
      </div>

      {!report.membership && <p className="admin-drafts-empty">{t('adminEffectiveAccessNoMembership')}</p>}
      {report.membership && report.devices.length === 0 && <p className="admin-drafts-empty">{t('adminEffectiveAccessNoDevices')}</p>}

      {report.devices.map((device) => (
        <section className="access-review-device" key={device.id}>
          <div className="access-review-device-heading">
            <div>
              <strong>{t('adminEffectiveAccessDevice', { label: device.label })}</strong>
              <small>{sources.workspaceLabel(device.workspaceId)} · {labelForValue(t, device.platform)} · {device.id}</small>
            </div>
            <StatusPill tone={statusTone(device.status)}>{labelForValue(t, device.status)}</StatusPill>
          </div>
          <p className="access-review-device-reason">
            {device.catalog.deviceAuthorized
              ? t('workstationApproved')
              : labelForAccessReason(t, device.catalog.deviceReason)}
          </p>
          <div className="access-review-tools" aria-label={t('adminEffectiveAccessTools')}>
            {device.catalog.tools.map((tool) => (
              <div className="access-review-tool" key={tool.toolId}>
                <div>
                  <strong>{tool.displayName}</strong>
                  <small>{tool.version || labelForAccessReason(t, tool.reason)}</small>
                </div>
                <StatusPill tone={tool.authorized ? 'success' : 'error'}>
                  {tool.authorized ? t('value_approved') : labelForAccessReason(t, tool.reason)}
                </StatusPill>
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="admin-form-security">{t('adminEffectiveAccessSource')}</p>
    </section>
  );
}

export default function AdministrationConsole({
  t,
  language,
  snapshot,
  backendState,
  refreshing,
  onRefresh,
  onOpenOperation,
  administeredAccountId,
  onSelectAdministeredAccount,
  usageReport,
  usageLoading,
  onMeasureUsage,
  StatusPill,
  IconComponent,
}) {
  const [section, setSection] = useState('accounts');
  const [exportState, setExportState] = useState('idle');
  const [selectedAccessUserId, setSelectedAccessUserId] = useState('');
  const sources = useMemo(() => buildOptionSources({ snapshot, t }), [snapshot, t]);

  /*
   * The context picker is narrower than `sources.accounts` on purpose.
   *
   * `sources.accounts` feeds the administrative forms, which must be able to
   * reach a suspended account — reactivating one is an administrative act. The
   * picker only decides where the console points, and pointing it at an
   * account the backend refuses turns every later operation into a failure
   * that reads like a defect somewhere else.
   *
   * The account currently in context is always kept, even when it is not
   * operable, so the control never shows blank while the console is genuinely
   * pointed there. Suspended accounts remain visible in the table below with
   * their status, so nothing is hidden from the administrator.
   */
  const accountContextOptions = useMemo(() => {
    const operable = new Set(selectOperableAccounts(snapshot.accounts).map((account) => account.id));
    return sources.accounts.filter((entry) => operable.has(entry.value) || entry.value === administeredAccountId);
  }, [administeredAccountId, snapshot.accounts, sources.accounts]);

  const backendLabel = backendState === 'ready'
    ? t('adminBackendReadyProduction')
    : backendState === 'emulator-ready'
      ? t('adminBackendReadyEmulator')
      : backendState === 'firebase-not-configured'
        ? t('adminBackendMissing')
        : t('adminBackendDisabled');
  const backendReady = backendState === 'ready' || backendState === 'emulator-ready';

  const operations = READ_ONLY_SECTIONS.includes(section) ? [] : listOperationsForSection(section);
  const auditRows = useMemo(() => [
    ...snapshot.auditLogs.map((entry) => ({ ...entry, scope: t('auditAccountScope') })),
    ...snapshot.platformAuditLogs.map((entry) => ({ ...entry, scope: t('auditPlatformScope') })),
  ].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))), [snapshot, t]);
  const selectedAccessReport = useMemo(() => {
    const user = snapshot.users.find((entry) => entry.id === selectedAccessUserId) || null;
    if (!user || !administeredAccountId) return null;
    const membership = snapshot.members.find((entry) => entry.id === user.id) || null;
    return buildEffectiveAccessReport({
      accountId: administeredAccountId,
      user,
      membership,
      devices: snapshot.devices,
      registry: snapshot.tools,
      assignments: snapshot.assignments,
      licenses: snapshot.licenses,
      nowMs: Number.isFinite(Date.parse(snapshot.loadedAt)) ? Date.parse(snapshot.loadedAt) : Date.now(),
    });
  }, [administeredAccountId, selectedAccessUserId, snapshot]);
  const administeredAccountName = snapshot.accounts.find((account) => account.id === administeredAccountId)?.name
    || administeredAccountId;

  // A read that came back exactly full may or may not have left records
  // behind. The notice says the limit was reached, which is the only part that
  // is actually known.
  const truncatedReads = useMemo(() => {
    const reached = new Set(snapshot.truncated || []);
    return (SECTION_COLLECTIONS[section] || []).filter((name) => reached.has(name));
  }, [snapshot, section]);

  const handleExportAudit = () => {
    const csv = buildAuditCsv({
      rows: auditRows,
      t,
      resolveActor: (uid) => sources.personLabel(uid),
      resolveAction: (action) => labelForAuditAction(t, action),
    });
    setExportState(downloadTextFile(auditExportFilename(), csv) ? 'done' : 'failed');
  };

  const sectionRowCount = {
    accounts: snapshot.accounts.length,
    workspaces: snapshot.workspaces.length,
    users: snapshot.users.length,
    teams: snapshot.teams.length,
    roles: snapshot.customRoles.length,
    tools: snapshot.tools.length,
    assignments: snapshot.assignments.length,
    licenses: snapshot.licenses.length,
    devices: snapshot.devices.length,
    audit: auditRows.length,
    usage: usageReport ? usageReport.collections.length : 0,
  }[section] || 0;

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow cyan">{t('adminConsoleKicker')}</div>
          <h1>{t('adminConsoleTitle')}</h1>
          <p>{t('adminConsoleSubtitle')}</p>
        </div>
        <div className="admin-heading-actions">
          <StatusPill tone={backendReady ? 'success' : 'warning'}>{backendLabel}</StatusPill>
          <button type="button" className="ghost-action" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? t('adminRefreshing') : t('adminRefresh')}
          </button>
        </div>
      </section>

      <section className="admin-status-card">
        <div>
          <span>{t('adminActiveAccount')}</span>
          <select
            aria-label={t('adminActiveAccount')}
            value={administeredAccountId}
            onChange={(event) => onSelectAdministeredAccount(event.target.value)}
          >
            {snapshot.accounts.length === 0 && <option value="">{t('adminNoRecords')}</option>}
            {accountContextOptions.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </div>
        {snapshot.partial && snapshot.loadedAt && (
          <StatusPill tone="warning">{t('adminPartialData')}</StatusPill>
        )}
        {snapshot.loadedAt && (
          <StatusPill tone="neutral">
            {t('adminLastLoaded', { time: formatInstant(snapshot.loadedAt, language) })}
          </StatusPill>
        )}
      </section>

      <nav className="admin-tabs" aria-label={t('adminConsoleTitle')}>
        {[...ADMIN_SECTIONS, ...READ_ONLY_SECTIONS].map((entry) => (
          <button
            key={entry}
            type="button"
            className={section === entry ? 'admin-tab active' : 'admin-tab'}
            aria-current={section === entry ? 'page' : undefined}
            onClick={() => {
              setSection(entry);
              // A stale "exported" line under a table the operator has since
              // left and come back to would claim something happened just now.
              setExportState('idle');
            }}
          >
            <IconComponent name={SECTION_ICONS[entry]} size={15} />
            <span>{t(`adminSection_${entry}`)}</span>
          </button>
        ))}
      </nav>

      {operations.length > 0 && (
        <section className="admin-section">
          <div className="admin-draft-heading">
            <div>
              <h2>{t('adminOperationsFor')}</h2>
              <p>{t(`adminSection_${section}`)}</p>
            </div>
            <StatusPill tone="neutral">{t('adminRecordCount', { count: sectionRowCount })}</StatusPill>
          </div>
          <div className="admin-grid">
            {operations.map((operation) => (
              <button
                type="button"
                key={operation}
                className="admin-operation-card"
                disabled={!backendReady}
                onClick={() => onOpenOperation(operation)}
              >
                <span className="admin-operation-icon">
                  <IconComponent name={ADMIN_FORMS[operation].icon} size={19} />
                </span>
                <span>
                  <strong>{t(`opTitle_${operation}`)}</strong>
                  <small>{t(`opBody_${operation}`)}</small>
                </span>
                <IconComponent name="arrow" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="table-card">
        <div className="table-heading">
          <h2>{t(`adminSection_${section}`)}</h2>
          <div className="admin-heading-actions">
            {section === 'audit' && (
              <button
                type="button"
                className="ghost-action"
                onClick={handleExportAudit}
                disabled={auditRows.length === 0}
              >
                {t('auditExport')}
                <IconComponent name="docs" size={15} />
              </button>
            )}
            <StatusPill tone="neutral">{t('adminRecordCount', { count: sectionRowCount })}</StatusPill>
          </div>
        </div>

        {truncatedReads.length > 0 && (
          <section className="workspace-note admin-notice" role="status">
            <IconComponent name="info" />
            <div>
              <strong>{t('adminReadLimitTitle')}</strong>
              <span>
                {t('adminReadLimitReached', {
                  limit: truncatedReads
                    .map((name) => READ_LIMITS[name])
                    .reduce((lowest, value) => Math.min(lowest, value), Number.MAX_SAFE_INTEGER),
                })}
              </span>
            </div>
          </section>
        )}

        {section === 'audit' && exportState !== 'idle' && (
          <p className={exportState === 'done' ? 'admin-submit-result' : 'admin-form-error'} role="status">
            {exportState === 'done'
              ? t('auditExportDone', { count: auditRows.length })
              : t('auditExportFailed')}
          </p>
        )}

        {section === 'accounts' && (
          <Table
            columns={[t('columnName'), t('columnStatus'), t('field_defaultLocale'), t('columnIdentifier')]}
            rows={snapshot.accounts}
            emptyLabel={t('adminNoRecords')}
            renderRow={(account) => (
              <tr key={account.id}>
                <td><strong>{account.name}</strong></td>
                <td><StatusPill tone={statusTone(account.status)}>{labelForValue(t, account.status)}</StatusPill></td>
                <td>{labelForValue(t, account.defaultLocale)}</td>
                <td><small>{account.id}</small></td>
              </tr>
            )}
          />
        )}

        {section === 'workspaces' && (
          <Table
            columns={[t('columnName'), t('field_code'), t('columnStatus'), t('columnIdentifier')]}
            rows={snapshot.workspaces}
            emptyLabel={t('adminNoRecords')}
            renderRow={(workspace) => (
              <tr key={workspace.id}>
                <td><strong>{workspace.name}</strong></td>
                <td>{workspace.code || t('valueNone')}</td>
                <td><StatusPill tone={statusTone(workspace.status)}>{labelForValue(t, workspace.status)}</StatusPill></td>
                <td><small>{workspace.id}</small></td>
              </tr>
            )}
          />
        )}

        {section === 'users' && (
          <Table
            columns={[t('columnName'), t('columnEmail'), t('columnStatus'), t('columnRole'), t('columnScope')]}
            rows={snapshot.users}
            emptyLabel={t('adminNoRecords')}
            renderRow={(user) => {
              const membership = snapshot.members.find((member) => member.id === user.id) || null;
              return (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong><small>{user.id}</small>
                    <div className="admin-inline-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={!backendReady}
                        onClick={() => onOpenOperation(ADMIN_OPERATIONS.UPDATE_USER_PROFILE, {
                          targetUid: user.id,
                          displayName: user.displayName,
                          locale: user.locale,
                        })}
                      >
                        {t('opTitle_adminUpdateUserProfile')}
                      </button>
                      <button type="button" className="ghost-action" onClick={() => setSelectedAccessUserId(user.id)}>
                        {t('adminReviewAccess')}
                      </button>
                    </div>
                  </td>
                  <td>{user.email || t('valueNone')}</td>
                  <td><StatusPill tone={statusTone(user.status)}>{labelForValue(t, user.status)}</StatusPill></td>
                  <td>{membership ? labelForRole(t, membership.role) : t('valueNone')}</td>
                  <td>
                    {membership
                      ? membership.allWorkspaces
                        ? t('field_allWorkspaces')
                        : membership.workspaceIds.map(sources.workspaceLabel).join(', ') || t('valueNone')
                      : t('valueNone')}
                  </td>
                </tr>
              );
            }}
          />
        )}

        {section === 'users' && selectedAccessReport && (
          <EffectiveAccessPanel
            t={t}
            report={selectedAccessReport}
            accountName={administeredAccountName}
            sources={sources}
            onClose={() => setSelectedAccessUserId('')}
            StatusPill={StatusPill}
          />
        )}

        {section === 'teams' && (
          <Table
            columns={[t('columnName'), t('columnLeaders'), t('columnMembers'), t('columnWorkspace'), t('columnStatus')]}
            rows={snapshot.teams}
            emptyLabel={t('adminNoRecords')}
            renderRow={(team) => (
              <tr key={team.id}>
                <td><strong>{team.name}</strong></td>
                <td>{team.leaderUids.map(sources.personLabel).join(', ') || t('valueNone')}</td>
                <td>{team.memberUids.length}</td>
                <td>{team.workspaceId ? sources.workspaceLabel(team.workspaceId) : t('valueNone')}</td>
                <td><StatusPill tone={statusTone(team.status)}>{labelForValue(t, team.status)}</StatusPill></td>
              </tr>
            )}
          />
        )}

        {section === 'roles' && (
          <Table
            columns={[t('columnName'), t('columnIdentifier'), t('columnPermissions'), t('columnStatus')]}
            rows={snapshot.customRoles}
            emptyLabel={t('adminNoRecords')}
            renderRow={(role) => (
              <tr key={role.id}>
                <td><strong>{role.displayName}</strong></td>
                <td><small>{role.roleId}</small></td>
                <td>
                  {role.grants.length === 0
                    ? t('grantEmpty')
                    : role.grants.map((grant) => `${grant.permission} · ${t(`scopeLabel_${grant.scope}`)}`).join(' | ')}
                </td>
                <td><StatusPill tone={statusTone(role.status)}>{labelForValue(t, role.status)}</StatusPill></td>
              </tr>
            )}
          />
        )}

        {section === 'tools' && (
          <Table
            columns={[t('columnName'), t('columnType'), t('columnVersion'), t('columnPublisher'), t('columnStatus')]}
            rows={snapshot.tools}
            emptyLabel={t('adminNoRecords')}
            renderRow={(tool) => (
              <tr key={tool.toolId}>
                <td><strong>{tool.displayName}</strong><small>{tool.toolId}</small></td>
                <td>{labelForValue(t, tool.type)}</td>
                <td>
                  {tool.publishedVersion || t('valueNone')}
                  <small>{t('adminRecordCount', { count: tool.versions.length })}</small>
                </td>
                <td>{tool.publisher}</td>
                <td><StatusPill tone={statusTone(tool.status)}>{labelForValue(t, tool.status)}</StatusPill></td>
              </tr>
            )}
          />
        )}

        {section === 'assignments' && (
          <Table
            columns={[t('columnTool'), t('columnTarget'), t('columnEffect'), t('field_note')]}
            rows={snapshot.assignments}
            emptyLabel={t('adminNoRecords')}
            renderRow={(assignment) => (
              <tr key={assignment.id}>
                <td><strong>{sources.toolLabel(assignment.toolId)}</strong></td>
                <td>
                  {labelForValue(t, assignment.target)}
                  <small>
                    {assignment.target === 'role'
                      ? labelForRole(t, assignment.targetId)
                      : assignment.target === 'workspace'
                        ? sources.workspaceLabel(assignment.targetId)
                        : assignment.target === 'user'
                          ? sources.personLabel(assignment.targetId)
                          : assignment.targetId || ''}
                  </small>
                </td>
                <td>
                  <StatusPill tone={assignment.effect === 'grant' ? 'success' : 'error'}>
                    {labelForValue(t, assignment.effect)}
                  </StatusPill>
                </td>
                <td>{assignment.note || t('valueNone')}</td>
              </tr>
            )}
          />
        )}

        {section === 'licenses' && (
          <Table
            columns={[t('columnTool'), t('columnScope'), t('columnSeats'), t('columnValidity'), t('columnStatus')]}
            rows={snapshot.licenses}
            emptyLabel={t('adminNoRecords')}
            renderRow={(license) => (
              <tr key={license.id}>
                <td><strong>{sources.toolLabel(license.toolId)}</strong></td>
                <td>
                  {labelForValue(t, license.scope)}
                  <small>
                    {license.scope === 'workspace'
                      ? sources.workspaceLabel(license.scopeId)
                      : license.scope === 'user'
                        ? sources.personLabel(license.scopeId)
                        : ''}
                  </small>
                </td>
                <td>{license.seats === null ? t('valueUnlimited') : license.seats}</td>
                <td>
                  {license.expiresAt
                    ? formatInstant(license.expiresAt, language)
                    : t('valueNoExpiry')}
                </td>
                <td><StatusPill tone={statusTone(license.status)}>{labelForValue(t, license.status)}</StatusPill></td>
              </tr>
            )}
          />
        )}

        {section === 'devices' && (
          <Table
            columns={[t('columnName'), t('columnPerson'), t('columnPlatform'), t('columnWorkspace'), t('columnStatus'), t('columnLastSeen')]}
            rows={snapshot.devices}
            emptyLabel={t('adminNoRecords')}
            renderRow={(device) => (
              <tr key={device.id}>
                <td><strong>{device.label}</strong><small>{device.id}</small></td>
                <td>{sources.personLabel(device.assignedUid)}</td>
                <td>{labelForValue(t, device.platform)}</td>
                <td>{sources.workspaceLabel(device.workspaceId)}</td>
                <td>
                  <StatusPill tone={statusTone(device.status)}>{labelForValue(t, device.status)}</StatusPill>
                  <div className="admin-inline-actions">
                    {DEVICE_ACTIONS.filter((status) => status !== device.status).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className="ghost-action"
                        disabled={!backendReady}
                        onClick={() => onOpenOperation(ADMIN_OPERATIONS.SET_DEVICE_STATUS, {
                          accountId: administeredAccountId,
                          deviceId: device.id,
                          status,
                        })}
                      >
                        {labelForValue(t, status)}
                      </button>
                    ))}
                  </div>
                </td>
                <td>{device.lastSeenAt ? formatInstant(device.lastSeenAt, language) : t('valueNone')}</td>
              </tr>
            )}
          />
        )}

        {section === 'audit' && (
          <Table
            columns={[t('columnWhen'), t('columnAction'), t('columnScope'), t('columnActor'), t('columnTarget')]}
            rows={auditRows}
            emptyLabel={t('adminNoRecords')}
            renderRow={(entry) => (
              <tr key={`${entry.scope}-${entry.id}`}>
                <td>{formatInstant(entry.createdAt, language) || t('valueNone')}</td>
                <td><strong>{labelForAuditAction(t, entry.action)}</strong></td>
                <td>{entry.scope}</td>
                <td>{sources.personLabel(entry.actorUid)}</td>
                <td><small>{entry.targetType} · {entry.targetId}</small></td>
              </tr>
            )}
          />
        )}

        {section === 'usage' && (
          <UsagePanel
            t={t}
            language={language}
            report={usageReport}
            loading={usageLoading}
            onMeasure={onMeasureUsage}
            StatusPill={StatusPill}
            IconComponent={IconComponent}
          />
        )}
      </section>
    </>
  );
}
