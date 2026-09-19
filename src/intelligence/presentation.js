/**
 * Presentation-only derivations over the Intelligence projection.
 *
 * Pure and deterministic: no training, network, storage or clock. Every value
 * returned here is read from the result contract or recomputed from its rows
 * with the functions the pipeline itself uses, so the interface can explain a
 * number without ever producing one of its own.
 */
import {keyOf,observedMetrics} from './analysis.js';

export const SEVERITY_RANK=Object.freeze({none:0,low:1,medium:2,high:3,critical:4});
export const DETECTOR_IDS=Object.freeze(['IF','MAD','IQR']);
export const COMPONENT_IDS=Object.freeze(['outcome','anomaly','processing','trend']);
export const IMPACT_FIELDS=Object.freeze(['executions','anomalies','health','successRate','median']);
export const PERIOD_FIELDS=Object.freeze(['health','successRate','anomalyRate','failureRate','median','executions']);
const DAY=86400000;
const DIRECTED_REASONS=Object.freeze(['ANOMALY_RATE','FAILURE_RATE','CANCELLATION_RATE','DURATION_INCREASE']);

/* The grouping buildHealthViews uses in analysis.js. It is restated rather
   than exported from there because analysis.js belongs to the pipeline and
   stays untouched; a test proves both select the same reference rows. */
const ENTITY_KEYS=Object.freeze({
  global:()=>'global',
  account:r=>keyOf(r.account_id),
  workspace:r=>keyOf(r.account_id,r.workspace_id),
  device:r=>keyOf(r.account_id,r.workspace_id,r.device_id),
  tool:r=>keyOf(r.account_id,r.tool_id,r.action,r.tool_version),
});

/** The reference rows an entity's health was scored against. */
export function entityReferenceRows(entity,referenceRows) {
  const key=ENTITY_KEYS[entity?.entity_type];
  if(!key)throw new Error('UNKNOWN_ENTITY_TYPE');
  return entity.entity_type==='global'?referenceRows:referenceRows.filter(row=>key(row)===entity.key);
}

/** The health status a score maps to under the published thresholds. */
export function statusForScore(score,thresholds) {
  if(score==null)return 'insufficient_data';
  return score>=thresholds.healthy?'healthy':score>=thresholds.monitor?'monitor':score>=thresholds.high_risk?'high_risk':'critical';
}

const change=(delta,worse)=>delta==null?null:Math.abs(delta)<1e-12?'same':(delta>0)===(worse==='higher')?'worse':'better';

/**
 * How an entity's Health Score is built: each component with the weight the
 * result contract publishes, and the current period against its reference.
 */
export function explainHealth(entity,policy,referenceRows) {
  if(!policy?.weights||!policy?.thresholds)throw new Error('HEALTH_POLICY_MISSING');
  const components=COMPONENT_IDS.map(id=>{
    const value=entity.health_components?.[id]??null,weight=policy.weights[id];
    return {id,value,weight,contribution:value==null||!Number.isFinite(weight)?null:value*weight};
  });
  const complete=components.every(c=>c.contribution!=null);
  const reference=observedMetrics(entityReferenceRows(entity,referenceRows)),current=entity.metrics;
  const row=(id,kind,worse,now,past)=>{
    const delta=now==null||past==null?null:now-past;
    return {id,kind,worse,current:now??null,reference:past??null,delta,change:change(delta,worse)};
  };
  return {
    score:entity.health_score,status:entity.health_status,
    components,sum:complete?components.reduce((sum,c)=>sum+c.contribution,0):null,
    thresholds:policy.thresholds,minimumRuns:policy.minimumRuns,version:policy.version,
    sampleSize:entity.sample_size,referenceSize:reference.total,
    comparison:[
      row('successRate','rate','lower',current.successRate,reference.successRate),
      row('anomalyRate','rate','higher',current.anomalyRate,reference.anomalyRate),
      row('failureRate','rate','higher',current.failureRate,reference.failureRate),
      row('cancellationRate','rate','higher',current.cancellationRate,reference.cancellationRate),
      row('median','seconds','higher',current.duration?.median,reference.duration?.median),
      row('p95','seconds','higher',current.duration?.p95,reference.duration?.p95),
    ],
  };
}

/** Reason codes, once each, with the direction of the observed value against its reference. */
export function reasonSignals(reasons) {
  const signals=new Map();
  for(const r of reasons) {
    if(signals.has(r.code))continue;
    const directed=DIRECTED_REASONS.includes(r.code)&&Number.isFinite(r.observed)&&Number.isFinite(r.reference);
    signals.set(r.code,{code:r.code,direction:directed?(r.observed>r.reference?'up':r.observed<r.reference?'down':'flat'):null});
  }
  return [...signals.values()];
}

/**
 * The featured anomaly, chosen by a fixed policy rather than by hand:
 * highest severity; then the largest distance from the reference median on
 * the log scale the detectors work on, so unusually fast and unusually slow
 * runs weigh alike; then the most recent; then the identifier.
 */
export function compareSpotlight(a,b) {
  return SEVERITY_RANK[b.severity]-SEVERITY_RANK[a.severity]
    ||Math.abs(Math.log(b.duration_ratio))-Math.abs(Math.log(a.duration_ratio))
    ||b.completed_at.localeCompare(a.completed_at)
    ||a.execution_id.localeCompare(b.execution_id);
}
export function selectSpotlightAnomaly(rows) {
  let best=null;
  for(const row of rows)if(row.is_anomaly&&row.duration_ratio>0&&(!best||compareSpotlight(row,best)<0))best=row;
  return best;
}

/** The first workspace the priority policy ranks, among those with enough data to score. */
export function selectPriorityWorkspace(priorityQueue) {
  return priorityQueue.find(e=>e.entity_type==='workspace'&&e.health_status!=='insufficient_data')??null;
}

/** Where an entity sits in the global queue and among entities of its own type. */
export function priorityContext(entity,view) {
  if(!entity||entity.entity_type==='global')return null;
  const same=e=>e.key===entity.key&&e.entity_type===entity.entity_type;
  const peers=view[entity.entity_type+'s']||[];
  return {rank:view.priorityQueue.find(same)?.priority??null,queueSize:view.priorityQueue.length,typeRank:peers.find(same)?.priority??null,typeSize:peers.length};
}

/** Label rows for markers on a 0–100 track, so labels closer than `gap` never overlap. */
export function layoutMarkerLabels(markers,gap=24) {
  const rows=[];
  return markers.filter(m=>m.at!=null).sort((a,b)=>a.at-b.at).map(m=>{
    let row=rows.findIndex(last=>m.at-last>=gap);
    if(row===-1){row=rows.length;rows.push(m.at);}else rows[row]=m.at;
    return {...m,row};
  });
}

/** A linear duration track in seconds: reference median, reference P95, the observed run and the IQR interval. */
export function durationScale({observed,median,p95,lower,upper}) {
  const values=[observed,median,p95,lower,upper].filter(v=>Number.isFinite(v)&&v>=0);
  const max=values.length?Math.max(...values)*1.08:1;
  const at=v=>Number.isFinite(v)?Math.round(Math.min(100,Math.max(0,v/max*100))*100)/100:null;
  return {
    max,
    band:Number.isFinite(lower)&&Number.isFinite(upper)?{from:at(lower),to:at(upper)}:null,
    markers:layoutMarkerLabels([{id:'median',value:median,at:at(median)},{id:'p95',value:p95,at:at(p95)},{id:'observed',value:observed,at:at(observed)}]),
  };
}

/** The calibrated decision detector of the model group that scored a row. */
export function decisionDetectorFor(row,metadata) {
  return (metadata.model_selection||[]).find(m=>m.group===row.model_id)?.decision_detector??null;
}

/** Everything "Why flagged" shows, read from the scored row and the model selection metadata. */
export function explainAnomaly(row,metadata) {
  const calibrated=decisionDetectorFor(row,metadata);
  const observed=row.duration_seconds,median=row.reference_median,p95=row.reference_p95;
  const lower=row.explanation?.iqr_lower_seconds??null,upper=row.explanation?.iqr_upper_seconds??null;
  const detectors=DETECTOR_IDS.map(id=>{
    const d=row.detectors[id];
    return {id,score:d.score,threshold:d.threshold,prediction:d.prediction,severity:d.severity,ratio:d.threshold>0?d.score/d.threshold:null,decision:id===calibrated};
  });
  return {
    executionId:row.execution_id,group:row.model_id,observed,median,p95,
    ratio:row.duration_ratio,medianChange:row.duration_ratio-1,medianDifference:observed-median,
    p95Ratio:observed/p95,p95Change:observed/p95-1,p95Difference:observed-p95,
    direction:row.duration_ratio>=1?'slower':'faster',
    iqr:{lower,upper},detectors,flaggedBy:detectors.filter(d=>d.prediction).map(d=>d.id),
    calibratedDetector:calibrated,
    // Set only while an explicit detector filter projects the view for comparison.
    projectionDetector:row.decision_detector!==calibrated?row.decision_detector:null,
    scale:durationScale({observed,median,p95,lower,upper}),
  };
}

/** The detector comparison: held-out test metrics, and the calibration evidence that chose the decision detector. */
export function modelComparison(modelMetrics,metadata) {
  const selections=metadata.model_selection||[];
  const decision=[...new Set(selections.map(s=>s.decision_detector))];
  return {
    detectors:DETECTOR_IDS.map(id=>({id,metrics:modelMetrics.find(m=>m.group==='total'&&m.detector===id)??null,decision:decision.includes(id)})),
    decision,
    policies:[...new Set(selections.map(s=>s.selection?.policy).filter(Boolean))],
    usesTest:selections.some(s=>s.selection?.uses_test!==false),
    calibration:selections.map(s=>({group:s.group,decision:s.decision_detector,f1:Object.fromEntries(DETECTOR_IDS.map(id=>[id,s.selection?.comparison?.find(c=>c.detector===id)?.f1??null]))})),
    evaluationPeriod:metadata.evaluation_period??null,
  };
}

/**
 * Comparison only: how many of the selected executions a detector would flag,
 * next to the calibrated decision detector. Reads each row's stored detector
 * outputs; it changes no decision, no model and no Health Score.
 */
export function detectorAgreement(rows,focus,metadata) {
  if(!DETECTOR_IDS.includes(focus))throw new Error('INVALID_DETECTOR');
  const decisionOf=new Map((metadata.model_selection||[]).map(m=>[m.group,m.decision_detector]));
  let flagged=0,decisionFlagged=0,both=0,focusOnly=0,decisionOnly=0;
  for(const row of rows) {
    const decision=decisionOf.get(row.model_id);
    const f=row.detectors[focus].prediction===true,d=decision?row.detectors[decision].prediction===true:false;
    if(f)flagged++;
    if(d)decisionFlagged++;
    if(f&&d)both++;else if(f)focusOnly++;else if(d)decisionOnly++;
  }
  return {focus,decision:[...new Set(decisionOf.values())],total:rows.length,flagged,decisionFlagged,both,focusOnly,decisionOnly};
}

/** The headline figures of a projected view. */
export function summarizeView(view) {
  const g=view.globalHealth,m=g.metrics;
  return {executions:m.total,anomalies:m.anomalies,highSeverity:m.highSeverity,successRate:m.successRate,anomalyRate:m.anomalyRate,failureRate:m.failureRate,
    median:m.duration?.median??null,health:g.health_score,status:g.health_status};
}

/** Before → after for the figures a filter change moves. */
export function filterImpact(before,after) {
  return IMPACT_FIELDS.map(id=>({id,from:before[id]??null,to:after[id]??null,changed:(before[id]??null)!==(after[id]??null)}));
}

/**
 * Filters for the period that ends the day before the selected one starts,
 * with the same length. Only offered when that whole period lies inside the
 * inference window, so both sides are scored against the same reference and
 * nothing is borrowed from the training or test periods. The 90-day view is
 * the whole window and has no equivalent predecessor.
 */
export function previousPeriodFilters(filters,metadata) {
  const period=filters.period||'90';
  if(!['today','7','30'].includes(period))return null;
  const days=period==='today'?1:Number(period);
  const anchor=Date.parse(metadata.period_end.slice(0,10)+'T00:00:00.000Z');
  if(!Number.isFinite(anchor))return null;
  const currentStart=anchor-(days-1)*DAY,start=currentStart-days*DAY,end=currentStart-DAY;
  if(start<Date.parse(metadata.period_start))return null;
  const day=ms=>new Date(ms).toISOString().slice(0,10);
  return {...filters,period:'custom',start:day(start),end:day(end)};
}

/** Current against previous period, field by field. */
export function periodComparison(current,previous) {
  const a=summarizeView(current),b=summarizeView(previous);
  return PERIOD_FIELDS.map(id=>({id,current:a[id],previous:b[id],delta:a[id]==null||b[id]==null?null:a[id]-b[id]}));
}

/** The facts the closing conclusion states, all taken from the projected view. */
export function buildConclusion(view,metadata) {
  const first=view.priorityQueue.find(e=>e.health_status!=='insufficient_data')??null;
  const models=modelComparison(view.modelMetrics,metadata);
  return {
    first,queueSize:view.priorityQueue.length,
    evidence:first?Object.fromEntries(['ANOMALY_RATE','FAILURE_RATE'].map(code=>[code,first.reasons.find(r=>r.code===code)??null])):null,
    workspace:selectPriorityWorkspace(view.priorityQueue),
    anomaly:selectSpotlightAnomaly(view.anomalies),
    decision:models.decision,
    decisionMetrics:models.detectors.filter(d=>d.decision).map(d=>({id:d.id,f1:d.metrics?.f1??null})),
    otherMetrics:models.detectors.filter(d=>!d.decision).map(d=>({id:d.id,f1:d.metrics?.f1??null})),
    calibrated:models.policies.includes('CALIBRATION_F1_WITH_FIXED_CANDIDATES')&&!models.usesTest,
  };
}
