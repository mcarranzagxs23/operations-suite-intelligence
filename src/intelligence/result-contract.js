export const RESULT_SCHEMA_VERSION='2.0.0';
export const RESULT_KEYS=['schema_version','metadata','detectors','globalHealth','accounts','workspaces','devices','tools','observations','referenceObservations','evaluationObservations','anomalies','priorityQueue','trends','modelMetrics','dataQuality','explanations','filtersMetadata'];
export const OBSERVATION_KEYS=['execution_id','account_id','workspace_id','device_id','tool_id','tool_version','action','status','error_code','duration_seconds','completed_at','device_platform','data_origin','expected_anomaly','model_id','model_version','decision_detector','detectors','is_anomaly','severity','anomaly_score','reference_median','reference_p95','duration_ratio','explanation','recommended_action'];
const instant=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{6,128}$/.test(s);
export function validateIntelligenceResult(result) {
  const issues=[];
  if(!result||typeof result!=='object')return {valid:false,issues:['result.invalid']};
  if(result.schema_version!==RESULT_SCHEMA_VERSION)issues.push('schema_version.invalid');
  for(const key of RESULT_KEYS)if(!(key in result))issues.push(key+'.missing');
  if(Object.keys(result).some(k=>!RESULT_KEYS.includes(k)))issues.push('result.unexpected_field');
  const m=result.metadata;
  if(!m||!['ACADEMIC_SYNTHETIC','AUTHORIZED_CONTROLLED'].includes(m.mode)||typeof m.complete!=='boolean'||!Array.isArray(m.account_ids))issues.push('metadata.invalid');
  else {
    for(const key of ['dataset_version','model_version','detector_version'])if(typeof m[key]!=='string'||!m[key].length)issues.push('metadata.'+key);
    if(m.data_origin!==(m.mode==='ACADEMIC_SYNTHETIC'?'SYNTHETIC':'REAL_CONTROLLED'))issues.push('metadata.data_origin');
    if(!Array.isArray(result.detectors))issues.push('detectors.invalid');
    if(!Array.isArray(m.model_selection)||!m.evaluation_period||!instant(m.evaluation_period.start)||!instant(m.evaluation_period.end))issues.push('metadata.model_selection');
    for(const key of ['period_start','period_end','reference_start','reference_end','computed_at'])if(!instant(m[key]))issues.push('metadata.'+key);
    if(m.period_start>m.period_end||m.reference_end>=m.period_start)issues.push('metadata.temporal_overlap');
  }
  for(const name of ['accounts','workspaces','devices','tools','observations','referenceObservations','evaluationObservations','anomalies','priorityQueue','trends','modelMetrics'])if(!Array.isArray(result[name]))issues.push(name+'.invalid');
  for(const name of ['observations','referenceObservations','evaluationObservations']) {
    const rows=result[name];if(!Array.isArray(rows))continue;
    if(rows.length>10000)issues.push(name+'.too_large');
    const seen=new Set();
    for(const row of rows) {
      if(!row||typeof row!=='object'||Object.keys(row).some(k=>!OBSERVATION_KEYS.includes(k))||OBSERVATION_KEYS.some(k=>!(k in row))) {issues.push(name+'.unexpected_shape');continue;}
      for(const field of ['execution_id','account_id','workspace_id','device_id'])if(!id(row[field]))issues.push(name+'.invalid_id');
      if(!m?.account_ids?.includes(row.account_id))issues.push(name+'.scope');
      const key=row.account_id+'/'+row.execution_id;if(seen.has(key))issues.push(name+'.duplicate');seen.add(key);
      if(!Number.isFinite(row.duration_seconds)||row.duration_seconds<=0||row.duration_seconds>43200||!instant(row.completed_at))issues.push(name+'.invalid_measurement');
      if(!['SYNTHETIC','REAL_CONTROLLED'].includes(row.data_origin)||!(row.expected_anomaly===null||typeof row.expected_anomaly==='boolean'))issues.push(name+'.invalid_origin');
      if(row.data_origin!==m?.data_origin)issues.push(name+'.origin_mismatch');
      if(!['IF','MAD','IQR'].includes(row.decision_detector)||!row.explanation||row.explanation.observed_seconds!==row.duration_seconds)issues.push(name+'.invalid_explanation');
      const range=name==='observations'?{start:m?.period_start,end:m?.period_end}:name==='referenceObservations'?{start:m?.reference_start,end:m?.reference_end}:m?.evaluation_period;
      if(!range||row.completed_at<range.start||row.completed_at>range.end)issues.push(name+'.period');
      if(typeof row.is_anomaly!=='boolean'||!['none','low','medium','high','critical'].includes(row.severity)||(!row.is_anomaly&&row.severity!=='none'))issues.push(name+'.invalid_severity');
      if(!['success','failure','cancelled'].includes(row.status)||!['windows','macos'].includes(row.device_platform))issues.push(name+'.invalid_category');
      for(const d of ['IF','MAD','IQR'])if(!Number.isFinite(row.detectors?.[d]?.score)||!Number.isFinite(row.detectors?.[d]?.threshold)||typeof row.detectors?.[d]?.prediction!=='boolean')issues.push(name+'.invalid_detector');
    }
  }
  for(const name of ['accounts','workspaces','devices','tools','priorityQueue']) {
    const entities=Array.isArray(result[name])?result[name]:[],keys=new Set();
    for(const e of entities) {if(!e||typeof e!=='object'){issues.push(name+'.invalid_entity');continue;}if(keys.has(e.key))issues.push(name+'.duplicate');keys.add(e.key);if(!m?.account_ids?.includes(e.account_id))issues.push(name+'.scope');
      if(!['healthy','monitor','high_risk','critical','insufficient_data'].includes(e.health_status)||!e.metrics||!Array.isArray(e.reasons))issues.push(name+'.invalid_entity');
      if(e.health_status==='insufficient_data'?e.health_score!==null:!Number.isFinite(e.health_score)||e.health_score<0||e.health_score>100)issues.push(name+'.invalid_health');}
  }
  if(result.globalHealth?.sample_size!==result.observations?.length)issues.push('globalHealth.count_mismatch');
  if(Array.isArray(result.observations)&&Array.isArray(result.anomalies)&&result.anomalies.length!==result.observations.filter(r=>r?.is_anomaly).length)issues.push('anomalies.count_mismatch');
  if(!result.dataQuality||!result.explanations||!result.filtersMetadata)issues.push('supporting_evidence.missing');
  return {valid:issues.length===0,issues:[...new Set(issues)]};
}
export function assertIntelligenceResult(value) {const r=validateIntelligenceResult(value);if(!r.valid)throw new Error('INVALID_INTELLIGENCE_RESULT: '+r.issues.join(', '));return value;}
