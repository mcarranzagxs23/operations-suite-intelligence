import {evaluateDetector} from '../../src/intelligence/metrics.js';
export {evaluateDetector} from '../../src/intelligence/metrics.js';
import {createHash} from 'node:crypto';
import {fitIsolationForest,loadIsolationForest} from './isolation-forest.mjs';
import {median,medianAbsoluteDeviation,quantile} from './statistics.mjs';
export const MODEL_VERSION='2.0.0';
export const DETECTORS=Object.freeze(['IF','MAD','IQR']);
export const INITIAL_FEATURE_COLUMNS=Object.freeze(['log_duration']);
export const groupKey=row=>row.tool_id+'__'+row.action;
export function temporalSplit(rows,{developmentDays=90}={}) {
  const days=[...new Set(rows.map(r=>r.completed_at.slice(0,10)))].sort();
  if(!Number.isInteger(developmentDays)||developmentDays<30||days.length<developmentDays)throw new Error('INSUFFICIENT_TEMPORAL_COVERAGE');
  const trainEnd=days[Math.floor(developmentDays*.6)-1]+'T23:59:59.999Z',calibrationEnd=days[Math.floor(developmentDays*.8)-1]+'T23:59:59.999Z',testEnd=days[developmentDays-1]+'T23:59:59.999Z';
  const ranges={train:{start:days[0]+'T00:00:00.000Z',end:trainEnd},calibration:{start:new Date(Date.parse(trainEnd)+1).toISOString(),end:calibrationEnd},test:{start:new Date(Date.parse(calibrationEnd)+1).toISOString(),end:testEnd},inference:{start:new Date(Date.parse(testEnd)+1).toISOString(),end:days.at(-1)+'T23:59:59.999Z'}};
  const select=range=>rows.filter(r=>r.completed_at>=range.start&&r.completed_at<=range.end);
  return {...Object.fromEntries(Object.entries(ranges).map(([name,range])=>[name,select(range)])),ranges};
}

function statistic(value,detector,model,forest) {
  if(detector==='IF')return forest.score([value]);
  if(detector==='MAD')return model.baseline.mad>0?Math.abs(.6745*(value-model.baseline.medianLog)/model.baseline.mad):Math.abs(value-model.baseline.medianLog);
  return Math.max(0,(model.baseline.q1-value)/Math.max(model.baseline.iqr,1e-9),(value-model.baseline.q3)/Math.max(model.baseline.iqr,1e-9));
}
function detection(value,detector,model,forest) {
  const score=statistic(value,detector,model,forest),threshold=model.thresholds[detector],prediction=score>threshold,s=model.severityThresholds?.[detector];
  const severity=!prediction?'none':!s?'low':score>=s.critical?'critical':score>=s.high?'high':score>=s.medium?'medium':'low';
  return {score,threshold,prediction,severity,reason_code:detector==='IF'?'ISOLATED_DURATION':detector==='MAD'?'ROBUST_DURATION_DISTANCE':'OUTSIDE_QUARTILE_FENCES'};
}
export function loadDetectorArtifact(artifact) {
  if(!artifact||artifact.model_version!==MODEL_VERSION||artifact.schema_version!=='2.0.0'||!Array.isArray(artifact.models)||!artifact.models.length)throw new Error('INVALID_MODEL_ARTIFACT');
  const models=new Map();
  for(const model of artifact.models) {
    if(model.features?.join(',')!=='log_duration'||!DETECTORS.includes(model.decision_detector)||DETECTORS.some(d=>!Number.isFinite(model.thresholds?.[d])))throw new Error('INVALID_MODEL_METADATA');
    models.set(model.group,{model,forest:loadIsolationForest(model.forest)});
  }
  return {score(row) {
    const entry=models.get(groupKey(row));
    if(!entry)throw new Error('MODEL_GROUP_UNAVAILABLE');
    if(!Number.isFinite(row.log_duration))throw new Error('INVALID_FEATURE');
    const {model,forest}=entry,detectors=Object.fromEntries(DETECTORS.map(d=>[d,detection(row.log_duration,d,model,forest)])),decision=detectors[model.decision_detector];
    return {...row,model_id:model.group,model_version:artifact.model_version,decision_detector:model.decision_detector,detectors,is_anomaly:decision.prediction,severity:decision.severity,anomaly_score:detectors.IF.score,
      reference_median:model.baseline.medianSeconds,reference_p95:model.baseline.p95Seconds,duration_ratio:row.duration_seconds/model.baseline.medianSeconds,
      explanation:{code:decision.prediction?'DURATION_DEVIATION':'WITHIN_REFERENCE',observed_seconds:row.duration_seconds,reference_median:model.baseline.medianSeconds,reference_p95:model.baseline.p95Seconds,ratio:row.duration_seconds/model.baseline.medianSeconds,iqr_lower_seconds:Math.expm1(model.baseline.q1-model.thresholds.IQR*model.baseline.iqr)/1000,iqr_upper_seconds:Math.expm1(model.baseline.q3+model.thresholds.IQR*model.baseline.iqr)/1000,detected_by:DETECTORS.filter(d=>detectors[d].prediction)},
      recommended_action:decision.prediction?'REVIEW_EXECUTIONS':'MONITOR_NEXT_EXECUTIONS'};
  }};
}
export function trainDetectors(rows,{seed=20260915,treeCount=200,sampleSize=256,minimumGroupSize=90,alertFraction=.05,datasetVersion='0.2.0',developmentDays=90}={}) {
  if(!Number.isInteger(minimumGroupSize)||minimumGroupSize<30||!Number.isFinite(alertFraction)||alertFraction<=0||alertFraction>=.5)throw new Error('INVALID_MODEL_POLICY');
  const split=temporalSplit(rows,{developmentDays}),models=[];
  for(const group of [...new Set(split.train.map(groupKey))].sort()) {
    const train=split.train.filter(r=>groupKey(r)===group),cal=split.calibration.filter(r=>groupKey(r)===group);
    if(train.length<minimumGroupSize||cal.length<30||new Set(train.map(r=>r.completed_at.slice(0,10))).size<7||new Set(cal.map(r=>r.completed_at.slice(0,10))).size<7)throw new Error('INSUFFICIENT_GROUP: '+group);
    const forest=fitIsolationForest(train.map(r=>[r.log_duration]),{treeCount,sampleSize,seed:seed+models.length}),values=train.map(r=>r.log_duration),durations=train.map(r=>r.duration_seconds),q1=quantile(values,.25),q3=quantile(values,.75),mad=medianAbsoluteDeviation(values);
    const model={group,features:['log_duration'],seed:seed+models.length,treeCount,sampleSize:forest.sampleSize,maxDepth:forest.artifact.maxDepth,train_count:train.length,calibration_count:cal.length,
      baseline:{medianLog:median(values),mad,q1,q3,iqr:q3-q1,medianSeconds:median(durations),p95Seconds:quantile(durations,.95)},
      thresholds:{IF:quantile(cal.map(r=>forest.score([r.log_duration])),1-alertFraction),MAD:mad>0?3.5:1e-9,IQR:1.5},forest:forest.artifact,decision_detector:'MAD',severityThresholds:{}};
    for(const d of DETECTORS) {
      const scores=cal.map(r=>statistic(r.log_duration,d,model,forest)),floor=model.thresholds[d];
      model.severityThresholds[d]={medium:Math.max(floor,quantile(scores,.975)),high:Math.max(floor,quantile(scores,.99)),critical:Math.max(floor,quantile(scores,.995))};
    }
    const calScored=cal.map(r=>({...r,detectors:Object.fromEntries(DETECTORS.map(d=>[d,detection(r.log_duration,d,model,forest)]))}));
    const comparison=DETECTORS.map(d=>evaluateDetector(calScored,d));
    const eligible=cal.filter(r=>typeof r.expected_anomaly==='boolean');
    const enoughLabels=eligible.length>=30&&eligible.filter(r=>r.expected_anomaly).length>=5;
    const tieOrder={MAD:0,IQR:1,IF:2};
    if(enoughLabels)model.decision_detector=[...comparison].sort((a,b)=>(b.f1??-1)-(a.f1??-1)||tieOrder[a.detector]-tieOrder[b.detector])[0].detector;
    model.selection={policy:enoughLabels?'CALIBRATION_F1_WITH_FIXED_CANDIDATES':'MAD_FIXED_UNVALIDATED_FALLBACK',comparison,uses_test:false};
    models.push(model);
  }
  const fingerprint=createHash('sha256').update(JSON.stringify(rows.map(r=>[r.account_id,r.execution_id,r.completed_at,r.duration_ms,r.expected_anomaly]))).digest('hex');
  const artifact={schema_version:'2.0.0',model_version:MODEL_VERSION,detector_version:'2.0.0',dataset_version:datasetVersion,dataset_fingerprint:fingerprint,
    features:['log_duration'],excluded_features:['status','error_code','account_id','workspace_id','device_id','actor_uid','expected_anomaly'],seed,alert_fraction:alertFraction,periods:split.ranges,models};
  const loaded=loadDetectorArtifact(artifact),scored=rows.map(row=>loaded.score(row));
  const test=scored.filter(r=>r.completed_at>=split.ranges.test.start&&r.completed_at<=split.ranges.test.end),metrics=[];
  for(const group of [...models.map(m=>m.group),'total'])for(const d of DETECTORS)metrics.push({...evaluateDetector(group==='total'?test:test.filter(r=>groupKey(r)===group),d),group});
  return {artifact,scored,metrics,split};
}
