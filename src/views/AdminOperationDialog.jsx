import { useMemo, useState } from 'react';
import { ADMIN_OPERATIONS } from '../admin-operations.js';
import {
  ADMIN_FORMS,
  ASSIGNABLE_PERMISSIONS,
  ASSIGNABLE_SCOPES,
  buildAdminPayload,
  createAdminFormValues,
  deriveWorkspaceCodePreview,
  validateAdminForm,
} from '../forms/admin-forms.js';
import {
  buildOptionSources,
  hintForField,
  labelForField,
  labelForIssue,
  optionsForField,
} from './admin-presentation.js';

/**
 * One dialog renders all twenty administrative operations.
 *
 * The form is generated from the shared field definitions, so a rule added to
 * the contract appears here without a second implementation. That matters
 * beyond convenience: twenty hand-written forms would drift, and the one
 * that drifted would be the one that let an invalid grant through.
 *
 * Validation here is a courtesy to the operator. The callable backend
 * validates the same payload again with its own copy of the rules, because a
 * check that runs in a browser is not a control.
 */

/**
 * Changes that remove access from a real person or workstation ask for an
 * explicit acknowledgement. The intent is not friction for its own sake: these
 * are the operations whose effect is invisible from the administrator's own
 * screen and immediate for somebody else.
 */
function requiresAcknowledgement(operation, values) {
  switch (operation) {
    case ADMIN_OPERATIONS.SET_USER_STATUS:
      return values.status === 'suspended';
    case ADMIN_OPERATIONS.SET_MEMBERSHIP_STATUS:
      return values.status === 'suspended' || values.status === 'revoked';
    case ADMIN_OPERATIONS.SET_DEVICE_STATUS:
      return values.status === 'suspended' || values.status === 'revoked';
    case ADMIN_OPERATIONS.SET_LICENSE_STATUS:
      return values.status !== 'active';
    case ADMIN_OPERATIONS.SET_TOOL_STATUS:
      return values.status === 'disabled';
    case ADMIN_OPERATIONS.SET_CUSTOM_ROLE_STATUS:
      return values.status === 'disabled';
    case ADMIN_OPERATIONS.UPDATE_ACCOUNT:
      return values.status === 'suspended';
    case ADMIN_OPERATIONS.UPDATE_WORKSPACE:
      return values.status === 'archived';
    case ADMIN_OPERATIONS.DELETE_ASSIGNMENT:
      return true;
    case ADMIN_OPERATIONS.UPSERT_ASSIGNMENT:
      return values.effect === 'deny';
    default:
      return false;
  }
}

function GrantEditor({ t, grants, onChange, fieldId }) {
  const [permission, setPermission] = useState(ASSIGNABLE_PERMISSIONS[0]);
  const [scope, setScope] = useState(ASSIGNABLE_SCOPES[0]);

  return (
    <div className="admin-grant-editor" id={fieldId}>
      <div className="admin-grant-picker">
        <select
          aria-label={t('field_grants')}
          value={permission}
          onChange={(event) => setPermission(event.target.value)}
        >
          {ASSIGNABLE_PERMISSIONS.map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>
        <select
          aria-label={t('columnScope')}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          {ASSIGNABLE_SCOPES.map((entry) => (
            <option key={entry} value={entry}>{t(`scopeLabel_${entry}`)}</option>
          ))}
        </select>
        <button
          type="button"
          className="ghost-action"
          onClick={() => {
            if (grants.some((grant) => grant.permission === permission && grant.scope === scope)) return;
            onChange([...grants, { permission, scope }]);
          }}
        >
          {t('grantAdd')}
        </button>
      </div>
      {grants.length === 0 ? (
        <small>{t('grantEmpty')}</small>
      ) : (
        <ul className="admin-grant-list">
          {grants.map((grant) => (
            <li key={`${grant.permission}@${grant.scope}`}>
              <span>{grant.permission} · {t(`scopeLabel_${grant.scope}`)}</span>
              <button
                type="button"
                className="ghost-action"
                onClick={() => onChange(grants.filter((entry) => (
                  entry.permission !== grant.permission || entry.scope !== grant.scope
                )))}
              >
                {t('grantRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminOperationDialog({
  t,
  operation,
  snapshot,
  administeredAccountId,
  initialValues = {},
  onClose,
  onSubmit,
  IconComponent,
  StatusPill,
  backendLabel,
}) {
  const definition = ADMIN_FORMS[operation];
  const [values, setValues] = useState(() => ({
    ...createAdminFormValues(operation),
    ...(definition?.fields.some((item) => item.name === 'accountId')
      ? { accountId: administeredAccountId }
      : {}),
    ...initialValues,
  }));
  const [issues, setIssues] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const sources = useMemo(() => buildOptionSources({ snapshot, values, t }), [snapshot, values, t]);
  const needsAcknowledgement = definition ? requiresAcknowledgement(operation, values) : false;

  if (!definition) return null;

  const issueFor = (name) => {
    const issue = issues.find((item) => item.field === name);
    return issue ? labelForIssue(t, issue.code) : '';
  };

  const update = (name, value) => {
    setSaved(false);
    setFailed(false);
    setValues((current) => {
      const next = { ...current, [name]: value };
      // A dependent selector must not keep a value from the kind it no longer
      // refers to; a stale target would be submitted silently.
      if (name === 'target') next.targetId = '';
      if (name === 'scope') next.scopeId = '';
      if (name === 'allWorkspaces' && value === true) next.workspaceIds = [];
      return next;
    });
    setIssues((current) => current.filter((item) => item.field !== name && item.field !== 'form'));
  };

  const submit = async (event) => {
    event.preventDefault();
    const validation = validateAdminForm(operation, values);
    if (!validation.valid) {
      setIssues(validation.issues);
      setSaved(false);
      return;
    }
    if (needsAcknowledgement && !acknowledged) return;

    setSaving(true);
    setFailed(false);
    try {
      await onSubmit(operation, buildAdminPayload(operation, values));
      setIssues([]);
      setSaved(true);
    } catch {
      setFailed(true);
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  const renderControl = (item, index) => {
    const fieldId = `admin-field-${item.name}`;
    const error = issueFor(item.name);
    const hint = hintForField(t, item.name);
    const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
      .filter(Boolean).join(' ') || undefined;
    const autoFocus = index === 0;

    if (item.name === 'accountId') {
      return (
        <div className="admin-field" key={item.name}>
          <label htmlFor={fieldId}>{labelForField(t, item.name)}</label>
          <select id={fieldId} value={values.accountId || ''} disabled>
            {sources.accounts.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
          <small>{t('adminActiveAccount')}</small>
        </div>
      );
    }

    let control = null;
    switch (item.kind) {
      case 'boolean':
        return (
          <label className="admin-check-row" key={item.name} htmlFor={fieldId}>
            <input
              id={fieldId}
              type="checkbox"
              checked={values[item.name] === true}
              onChange={(event) => update(item.name, event.target.checked)}
            />
            <span>{labelForField(t, item.name)}</span>
            {hint && <small id={`${fieldId}-hint`}>{hint}</small>}
          </label>
        );
      case 'grants':
        control = (
          <GrantEditor
            t={t}
            fieldId={fieldId}
            grants={values[item.name] || []}
            onChange={(next) => update(item.name, next)}
          />
        );
        break;
      case 'multiselect': {
        const options = optionsForField(item, sources, t);
        control = (
          <div className="admin-workspace-options" id={fieldId}>
            {options.length === 0 ? <small>{t('adminNoRecords')}</small> : options.map((entry) => (
              <label key={entry.value} className="admin-check-row" htmlFor={`${fieldId}-${entry.value}`}>
                <input
                  id={`${fieldId}-${entry.value}`}
                  type="checkbox"
                  disabled={item.name === 'workspaceIds' && values.allWorkspaces === true}
                  checked={(values[item.name] || []).includes(entry.value)}
                  onChange={(event) => update(
                    item.name,
                    event.target.checked
                      ? [...(values[item.name] || []), entry.value]
                      : (values[item.name] || []).filter((id) => id !== entry.value),
                  )}
                />
                <span>{entry.label}</span>
              </label>
            ))}
          </div>
        );
        break;
      }
      case 'select':
      case 'target':
      case 'licenseScope': {
        const options = optionsForField(item, sources, t);
        control = (
          <select
            autoFocus={autoFocus}
            id={fieldId}
            value={values[item.name] ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(item.name, event.target.value)}
          >
            <option value="">{t('formChooseOption')}</option>
            {options.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.detail ? `${entry.label} — ${entry.detail}` : entry.label}
              </option>
            ))}
          </select>
        );
        break;
      }
      case 'password':
        control = (
          <input
            autoFocus={autoFocus}
            id={fieldId}
            type="password"
            autoComplete="new-password"
            value={values[item.name] ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(item.name, event.target.value)}
          />
        );
        break;
      case 'email':
        control = (
          <input
            autoFocus={autoFocus}
            id={fieldId}
            type="email"
            autoComplete="off"
            value={values[item.name] ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(item.name, event.target.value)}
          />
        );
        break;
      case 'number':
        control = (
          <input
            autoFocus={autoFocus}
            id={fieldId}
            type="number"
            min="1"
            value={values[item.name] ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(item.name, event.target.value)}
          />
        );
        break;
      case 'datetime':
        control = (
          <input
            autoFocus={autoFocus}
            id={fieldId}
            type="date"
            value={(values[item.name] || '').slice(0, 10)}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(
              item.name,
              event.target.value ? `${event.target.value}T00:00:00.000Z` : '',
            )}
          />
        );
        break;
      default:
        control = (
          <input
            autoFocus={autoFocus}
            id={fieldId}
            value={values[item.name] ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => update(item.name, event.target.value)}
          />
        );
    }

    const derivedCode = item.name === 'code' && !values.code
      ? deriveWorkspaceCodePreview(values.displayName || '')
      : '';

    return (
      <div className="admin-field" key={item.name}>
        <label htmlFor={fieldId}>{labelForField(t, item.name)}</label>
        {control}
        {(hint || derivedCode) && (
          <small id={`${fieldId}-hint`}>{derivedCode ? `${hint} ${derivedCode}` : hint}</small>
        )}
        {error && <p id={`${fieldId}-error`} role="alert">{error}</p>}
      </div>
    );
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="modal-card admin-modal"
        data-dialog-root="true"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="admin-dialog-description"
      >
        <button type="button" className="modal-close" aria-label={t('close')} onClick={onClose}>
          <IconComponent name="close" />
        </button>
        <div className="admin-modal-topline">
          <div className="eyebrow cyan">
            <IconComponent name="shield" size={14} /> {t('adminConsoleKicker')}
          </div>
          <StatusPill tone="success">{backendLabel}</StatusPill>
        </div>
        <h2 id="dialog-title">{t(`opTitle_${operation}`)}</h2>
        <p id="admin-dialog-description">{t(`opBody_${operation}`)}</p>
        <div className="admin-stepper" aria-label={t('adminOperationStep')}>
          <span>01</span><IconComponent name="arrow" size={13} />
          <span>02</span><IconComponent name="arrow" size={13} />
          <span>{t('adminPersistStep')}</span>
        </div>
        <p className="admin-form-security">
          <IconComponent name="lock" size={15} />{t('adminFormSecurity')}
        </p>

        <form className="admin-form" onSubmit={submit} noValidate>
          <div className="admin-form-grid">
            {definition.fields
              .filter((item) => item.kind !== 'multiselect' && item.kind !== 'grants' && item.kind !== 'boolean')
              .map(renderControl)}
          </div>

          {definition.fields.some((item) => item.kind === 'boolean' || item.kind === 'multiselect' || item.kind === 'grants') && (
            <fieldset className="admin-fieldset">
              <legend>{t('formScope')}</legend>
              {definition.fields
                .filter((item) => item.kind === 'boolean' || item.kind === 'multiselect' || item.kind === 'grants')
                .map((item, index) => (
                  <div className="admin-field-block" key={item.name}>
                    {item.kind !== 'boolean' && <strong>{labelForField(t, item.name)}</strong>}
                    {renderControl(item, index + 100)}
                  </div>
                ))}
            </fieldset>
          )}

          {needsAcknowledgement && (
            <div className="admin-risk-notice">
              <IconComponent name="lock" size={16} />
              <div>
                <strong>{t(`opTitle_${operation}`)}</strong>
                <span>{t('adminConfirmDestructive')}</span>
              </div>
              <label className="admin-check-row" htmlFor="admin-risk-acknowledgement">
                <input
                  id="admin-risk-acknowledgement"
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>{t('formAcknowledgeRestriction')}</span>
              </label>
            </div>
          )}

          {issues.some((item) => item.field === 'form') && (
            <p className="admin-form-error" role="alert">{issueFor('form')}</p>
          )}
          {failed && <p className="admin-form-error" role="alert">{t('adminSaveFailed')}</p>}
          {saved && (
            <p className="admin-submit-result" role="status">
              <IconComponent name="check" size={15} />{t('adminSaved')}
            </p>
          )}

          <div className="dialog-actions">
            <button type="button" className="ghost-action" onClick={onClose}>{t('close')}</button>
            <button
              type="submit"
              className="primary-button cyan"
              disabled={saving || (needsAcknowledgement && !acknowledged)}
            >
              {saving ? t('adminSaving') : t('adminSave')}<IconComponent name="arrow" />
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
