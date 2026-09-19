import {fromCsv,toCsv} from './csv.mjs';
import {ANALYTICAL_SCHEMA_VERSION,RAW_COLUMNS,anomalyLabel,entityKey,validateRawRecord} from './analytical-contract.mjs';
export {validateRawRecord} from './analytical-contract.mjs';
export const ANALYTIC_COLUMNS=Object.freeze([...RAW_COLUMNS,'duration_seconds','log_duration','hour_of_day','day_of_week','hour_sin','hour_cos','day_sin','day_cos']);
export function transformRawRecord(row) {
  const validation=validateRawRecord(row);
  if (!validation.valid) throw new Error('INVALID_RECORD: '+validation.issues.join(', '));
  const date=new Date(row.completed_at),hour=date.getUTCHours(),day=date.getUTCDay();
  return Object.freeze({...row,expected_anomaly:anomalyLabel(row.expected_anomaly),error_code:row.error_code||null,host_version:row.host_version||null,suite_version:row.suite_version||null,synthetic_pattern:row.synthetic_pattern||null,
    duration_ms:Number(row.duration_ms),duration_seconds:Number(row.duration_ms)/1000,log_duration:Math.log1p(Number(row.duration_ms)),started_at:new Date(row.started_at).toISOString(),completed_at:date.toISOString(),received_at:new Date(row.received_at).toISOString(),
    hour_of_day:hour,day_of_week:day,hour_sin:Math.sin(2*Math.PI*hour/24),hour_cos:Math.cos(2*Math.PI*hour/24),day_sin:Math.sin(2*Math.PI*day/7),day_cos:Math.cos(2*Math.PI*day/7)});
}
export function transformRecords(rows,{datasetVersion='0.2.0',generatedAt=new Date().toISOString()}={}) {
  if (!Array.isArray(rows)) throw new Error('DATASET_NOT_ARRAY');
  const groups=new Map(),rejected=[],deduplicated=[],conflicts=[];
  for (const [index,raw] of rows.entries()) {
    const validation=validateRawRecord(raw);
    if (!validation.valid) {rejected.push({row:index+2,issues:validation.issues});continue;}
    const record=transformRawRecord(raw),key=entityKey(record.account_id,record.execution_id);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({row:index+2,record});
  }
  const transformed=[];
  for (const [key,entries] of groups) {
    const signatures=new Set(entries.map(({record})=>JSON.stringify(ANALYTIC_COLUMNS.map(col=>record[col]))));
    if (signatures.size>1) {
      conflicts.push({key,rows:entries.map(entry=>entry.row),code:'CONFLICT'});
      for (const entry of entries) rejected.push({row:entry.row,issues:['execution_id.CONFLICT']});
    } else {transformed.push(entries[0].record);deduplicated.push(...entries.slice(1).map(entry=>({row:entry.row,code:'IDENTICAL_DUPLICATE'})));}
  }
  transformed.sort((a,b)=>a.completed_at.localeCompare(b.completed_at)||entityKey(a.account_id,a.execution_id).localeCompare(entityKey(b.account_id,b.execution_id)));
  const reasons={},origins={};
  for (const entry of rejected) for (const issue of entry.issues) reasons[issue]=(reasons[issue]||0)+1;
  for (const row of transformed) origins[row.data_origin]=(origins[row.data_origin]||0)+1;
  const report={schema_version:ANALYTICAL_SCHEMA_VERSION,dataset_version:datasetVersion,generated_at:generatedAt,input_count:rows.length,accepted_count:transformed.length,rejected_count:rejected.length,deduplicated_count:deduplicated.length,conflict_count:conflicts.length,
    rejections_by_reason:reasons,rejections:rejected,duplicates:deduplicated,conflicts,date_range:{start:transformed[0]?.completed_at??null,end:transformed.at(-1)?.completed_at??null},data_origin_distribution:origins,
    account_count:new Set(transformed.map(r=>r.account_id)).size,workspace_count:new Set(transformed.map(r=>entityKey(r.account_id,r.workspace_id))).size,device_count:new Set(transformed.map(r=>entityKey(r.account_id,r.device_id))).size,tool_count:new Set(transformed.map(r=>r.tool_id)).size};
  return {transformed,rejected,report};
}
export function runEtlFromCsv(text,options) {
  try {const result=transformRecords(fromCsv(text),options);return {...result,csv:toCsv(result.transformed,ANALYTIC_COLUMNS)};}
  catch(error) {if(error.message.startsWith('CSV'))return {transformed:[],rejected:[{row:null,issues:['csv.invalid']}],csv:'',report:{...transformRecords([],options).report,parse_error:error.message,rejected_count:1,rejections_by_reason:{'csv.invalid':1}}};throw error;}
}
