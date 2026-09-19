/** Analytical v2 does not change the production ExecutionEvent V1. */
export const ANALYTICAL_SCHEMA_VERSION = '2.0.0';
export const RAW_COLUMNS = Object.freeze(['execution_id','account_id','workspace_id','device_id','actor_uid','tool_id','tool_version','action','status','error_code','duration_ms','started_at','completed_at','received_at','source','host_version','suite_version','device_platform','data_origin','expected_anomaly','synthetic_pattern']);
export const TOOL_ACTIONS = Object.freeze({'clean-vector-pro':'CLEAN ART','sepmaker-pro':'Apply'});
export const ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const MODES = Object.freeze({ACADEMIC_SYNTHETIC:'SYNTHETIC',AUTHORIZED_CONTROLLED:'REAL_CONTROLLED'});
export const entityKey = (...parts) => JSON.stringify(parts);
export function strictInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.length === 20 ? value.replace('Z','.000Z') : value);
}
export function anomalyLabel(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  if (value === null || value === '' || value === 'unknown') return null;
  return undefined;
}
export function validateRawRecord(row) {
  const issues = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {valid:false,issues:['record.invalid']};
  for (const key of RAW_COLUMNS) if (!(key in row)) issues.push(key+'.missing');
  if (Object.keys(row).some(key=>!RAW_COLUMNS.includes(key))) issues.push('record.unexpected_field');
  for (const key of ['execution_id','account_id','workspace_id','device_id','actor_uid']) if (typeof row[key] !== 'string' || !ID_PATTERN.test(row[key])) issues.push(key+'.invalid');
  if (!Object.hasOwn(TOOL_ACTIONS,row.tool_id)) issues.push('tool_id.invalid');
  if (TOOL_ACTIONS[row.tool_id] !== row.action) issues.push('action.invalid');
  if (typeof row.tool_version !== 'string' || row.tool_version.length>32 || !SEMVER_PATTERN.test(row.tool_version)) issues.push('tool_version.invalid');
  if (!['success','failure','cancelled'].includes(row.status)) issues.push('status.invalid');
  const errors=['ACTION_CANCELLED','DOCUMENT_UNAVAILABLE','HOST_UNAVAILABLE','PROCESSING_FAILED','VALIDATION_FAILED'];
  if (row.status==='success' ? ![null,''].includes(row.error_code) : !errors.includes(row.error_code)) issues.push('error_code.invalid');
  if (!['local_bridge','web_manual'].includes(row.source)) issues.push('source.invalid');
  if (!['windows','macos'].includes(row.device_platform)) issues.push('device_platform.invalid');
  if (!Object.values(MODES).includes(row.data_origin)) issues.push('data_origin.invalid');
  if (anomalyLabel(row.expected_anomaly)===undefined) issues.push('expected_anomaly.invalid');
  if (row.data_origin==='SYNTHETIC' && anomalyLabel(row.expected_anomaly)===null) issues.push('expected_anomaly.required_for_synthetic');
  for (const key of ['host_version','suite_version']) if (row[key]!==null && row[key]!=='' && (typeof row[key]!=='string' || !/^[A-Za-z0-9 .()-]{1,32}$/.test(row[key]))) issues.push(key+'.invalid');
  if (![null,'','normal','duration_spike','duration_drop','degradation'].includes(row.synthetic_pattern)) issues.push('synthetic_pattern.invalid');
  if (row.data_origin==='REAL_CONTROLLED' && ![null,''].includes(row.synthetic_pattern)) issues.push('synthetic_pattern.not_allowed_for_controlled');
  const duration=Number(row.duration_ms);
  if (!/^\d+$/.test(String(row.duration_ms)) || !Number.isSafeInteger(duration) || duration<=0 || duration>43200000) issues.push('duration_ms.invalid');
  for (const key of ['started_at','completed_at','received_at']) if (!strictInstant(row[key])) issues.push(key+'.invalid');
  if (strictInstant(row.started_at)&&strictInstant(row.completed_at)&&Date.parse(row.started_at)>Date.parse(row.completed_at)) issues.push('completed_at.before_started_at');
  // Zero silent clock tolerance: a skewed controlled export is reported.
  if (strictInstant(row.completed_at)&&strictInstant(row.received_at)&&Date.parse(row.completed_at)>Date.parse(row.received_at)) issues.push('received_at.before_completed_at');
  return {valid:issues.length===0,issues:[...new Set(issues)]};
}
