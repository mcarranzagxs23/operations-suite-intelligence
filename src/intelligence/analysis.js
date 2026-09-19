/** Pure, deterministic derived analytics. No training, network, storage or clock. */
import {clamp,describe,median,round,wilsonUpperBound} from '../../data-science/lib/statistics.mjs';
export const HEALTH_POLICY=Object.freeze({version:'2.0.0',minimumRuns:20,weights:{outcome:0.25,anomaly:0.25,processing:0.25,trend:0.25},thresholds:{healthy:90,monitor:75,high_risk:60},clockToleranceMs:0});
export const keyOf=(...parts)=>JSON.stringify(parts);
const toolGroup=r=>keyOf(r.tool_id,r.action,r.tool_version);
const statuses={critical:0,high_risk:1,monitor:2,healthy:3,insufficient_data:4};
const rate=(rows,predicate)=>rows.length?rows.filter(predicate).length/rows.length:null;
export function observedMetrics(rows) {
  return {total:rows.length,successRate:rate(rows,r=>r.status==='success'),failureRate:rate(rows,r=>r.status==='failure'),cancellationRate:rate(rows,r=>r.status==='cancelled'),
    anomalyRate:rate(rows,r=>r.is_anomaly),highSeverityRate:rate(rows,r=>r.is_anomaly&&['high','critical'].includes(r.severity)),anomalies:rows.filter(r=>r.is_anomaly).length,
    highSeverity:rows.filter(r=>r.is_anomaly&&['high','critical'].includes(r.severity)).length,duration:describe(rows.map(r=>r.duration_seconds))};
}
function processing(rows,reference,minimumRuns) {
  const parts=[];
  for(const group of new Set(rows.map(toolGroup))) {
    const current=rows.filter(r=>toolGroup(r)===group),past=reference.filter(r=>toolGroup(r)===group);
    if(current.length<minimumRuns||past.length<minimumRuns)return null;
    const currentMedian=median(current.map(r=>r.duration_seconds)),baseline=describe(past.map(r=>r.duration_seconds));
    const delta=Math.max(0,(currentMedian-baseline.median)/Math.max(.001,baseline.p95-baseline.median));
    parts.push({group,count:current.length,observed:currentMedian,reference:baseline.median,p95:baseline.p95,deterioration:clamp(delta)});
  }
  return parts;
}
export function summarizeEntity(type,key,rows,reference,metadata,policy=HEALTH_POLICY) {
  const current=observedMetrics(rows),past=observedMetrics(reference),minimum=policy.minimumRuns;
  const ordered=rows.map(r=>r.completed_at).sort(),pastDates=reference.map(r=>r.completed_at).sort();
  const temporal=Boolean(ordered.length&&pastDates.length&&pastDates.at(-1)<ordered[0]);
  const parts=temporal?processing(rows,reference,minimum):null;
  const enough=current.total>=minimum&&past.total>=minimum&&parts!==null;
  const reasons=[];
  if(!enough)reasons.push({code:!temporal?'REFERENCE_UNAVAILABLE':'INSUFFICIENT_OBSERVATIONS',observed:current.total,reference:past.total,minimum});
  const upper=current.total?wilsonUpperBound(current.anomalies,current.total):null;
  const components={outcome:null,anomaly:null,processing:null,trend:null};
  if(enough) {
    components.outcome=100*current.successRate;
    components.anomaly=100*(1-upper);
    components.processing=100*(1-parts.reduce((sum,p)=>sum+p.deterioration*p.count,0)/current.total);
    components.trend=100*(1-clamp(Math.max(0,current.anomalyRate-past.anomalyRate,current.failureRate-past.failureRate,current.cancellationRate-past.cancellationRate,...parts.map(p=>p.deterioration))));
  }
  for(const [metric,code] of [['anomalyRate','ANOMALY_RATE'],['failureRate','FAILURE_RATE'],['cancellationRate','CANCELLATION_RATE']])
    if(current[metric]>0)reasons.push({code,observed:current[metric],reference:past[metric],count:current.total});
  for(const p of parts||[])if(p.deterioration>0)reasons.push({code:'DURATION_INCREASE',tool_group:p.group,observed:p.observed,reference:p.reference,p95:p.p95,ratio:p.observed/p.reference});
  const score=enough?Object.entries(components).reduce((sum,[name,value])=>sum+value*policy.weights[name],0):null;
  const status=!enough?'insufficient_data':score>=90?'healthy':score>=75?'monitor':score>=60?'high_risk':'critical';
  if(enough&&!reasons.length)reasons.push({code:'NO_ADVERSE_SIGNAL'});
  const scoped=type==='global'?null:rows[0]?.account_id??reference[0]?.account_id??null;
  return {key,entity_type:type,entity_id:type==='global'?'global':type==='account'?scoped:type==='workspace'?rows[0]?.workspace_id:type==='device'?rows[0]?.device_id:rows[0]?.tool_id,
    account_id:scoped,workspace_id:type==='device'?rows[0]?.workspace_id??null:null,platform:type==='device'?rows[0]?.device_platform??null:null,
    action:type==='tool'?rows[0]?.action??null:null,tool_version:type==='tool'?rows[0]?.tool_version??null:null,
    period_start:metadata.period_start,period_end:metadata.period_end,reference_start:metadata.reference_start,reference_end:metadata.reference_end,
    data_origin:[...new Set(rows.map(r=>r.data_origin))].sort(),dataset_version:metadata.dataset_version,model_version:metadata.model_version,detector:metadata.detector,computed_at:metadata.computed_at,
    sample_size:current.total,reference_sample_size:past.total,health_components:components,health_score:score===null?null:round(score,2),health_status:status,metrics:current,
    confidence:{anomaly_upper_95:upper,minimum_runs:minimum},latest_activity:ordered.at(-1)??null,latest_anomaly:rows.filter(r=>r.is_anomaly).map(r=>r.completed_at).sort().at(-1)??null,
    reasons,recommended_action:status==='insufficient_data'?'COLLECT_MORE_EXECUTIONS':status==='healthy'?'MONITOR_NEXT_EXECUTIONS':type==='tool'?'REVIEW_TOOL_VERSION':type==='workspace'?'REVIEW_WORKSPACE_ACTIVITY':'REVIEW_EXECUTIONS'};
}
export function priorityCompare(a,b) {
  return statuses[a.health_status]-statuses[b.health_status]||(a.health_score??101)-(b.health_score??101)
    ||(b.metrics.anomalyRate??0)-(a.metrics.anomalyRate??0)||(b.metrics.highSeverityRate??0)-(a.metrics.highSeverityRate??0)
    ||(b.metrics.failureRate??0)-(a.metrics.failureRate??0)||(b.metrics.cancellationRate??0)-(a.metrics.cancellationRate??0)
    ||(a.health_components.trend??100)-(b.health_components.trend??100)
    ||(b.confidence.anomaly_upper_95??0)-(a.confidence.anomaly_upper_95??0)
    ||String(b.latest_anomaly||'').localeCompare(String(a.latest_anomaly||''))||b.sample_size-a.sample_size||a.key.localeCompare(b.key);
}
export function buildHealthViews(rows,reference,metadata) {
  const definitions={accounts:r=>keyOf(r.account_id),workspaces:r=>keyOf(r.account_id,r.workspace_id),devices:r=>keyOf(r.account_id,r.workspace_id,r.device_id),tools:r=>keyOf(r.account_id,r.tool_id,r.action,r.tool_version)};
  const result={globalHealth:summarizeEntity('global','global',rows,reference,metadata)};
  for(const [name,key] of Object.entries(definitions)) {
    const groups=new Map();
    for(const row of rows){const id=key(row);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);}
    result[name]=[...groups].map(([id,group])=>summarizeEntity(name.slice(0,-1),id,group,reference.filter(r=>key(r)===id),metadata)).sort(priorityCompare).map((r,i)=>({...r,priority:i+1}));
  }
  result.priorityQueue=[...result.accounts,...result.workspaces,...result.devices,...result.tools].sort(priorityCompare).map((r,i)=>({...r,priority:i+1}));
  return result;
}
export function buildTrends(rows,reference,metadata) {
  const points=[],start=Date.parse(metadata.period_start),end=Date.parse(metadata.period_end);
  if(!Number.isFinite(start)||!Number.isFinite(end))return points;
  for(let cursor=start;cursor<=end;cursor+=7*86400000) {
    const from=new Date(cursor).toISOString(),to=new Date(Math.min(end,cursor+7*86400000-1)).toISOString();
    const bucket=rows.filter(r=>r.completed_at>=from&&r.completed_at<=to);
    const summary=summarizeEntity('global','global',bucket,reference,{...metadata,period_start:from,period_end:to});
    points.push({start:from,end:to,total:bucket.length,health:summary.health_score,health_status:summary.health_status,anomaly_rate:summary.metrics.anomalyRate,failure_rate:summary.metrics.failureRate,cancellation_rate:summary.metrics.cancellationRate,duration_median:summary.metrics.duration.median??null});
  }
  return points;
}
