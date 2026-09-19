import {buildHealthViews,buildTrends,HEALTH_POLICY,keyOf} from '../../src/intelligence/analysis.js';
import {evaluateDetector} from '../../src/intelligence/metrics.js';
import {OBSERVATION_KEYS,RESULT_SCHEMA_VERSION,assertIntelligenceResult} from '../../src/intelligence/result-contract.js';
const publicRow=row=>Object.fromEntries(OBSERVATION_KEYS.map(key=>[key,row[key]]));
export function buildResult({scored,artifact,dataQuality,computedAt,mode='ACADEMIC_SYNTHETIC',coverage={complete:true},reconciliation={status:'NOT_APPLICABLE',differences:[]},period,referencePeriod}) {
  const p=period||artifact.periods.inference,r=referencePeriod||artifact.periods.train;
  const select=range=>scored.filter(row=>row.completed_at>=range.start&&row.completed_at<=range.end).map(publicRow);
  const observations=select(p),reference=coverage.complete?select(r):[];
  const evaluation=mode==='ACADEMIC_SYNTHETIC'?select(artifact.periods.test):observations;
  const accountIds=[...new Set(scored.map(row=>row.account_id))].sort();
  const metadata={mode,complete:coverage.complete,coverage,reconciliation,account_ids:accountIds,period_start:p.start,period_end:p.end,reference_start:r.start,reference_end:r.end,
    dataset_version:artifact.dataset_version,model_version:artifact.model_version,detector_version:'2.0.0',data_origin:mode==='ACADEMIC_SYNTHETIC'?'SYNTHETIC':'REAL_CONTROLLED',model_training_origin:'SYNTHETIC',detector:'CALIBRATION_SELECTED',computed_at:computedAt,
    health_policy:HEALTH_POLICY,model_selection:artifact.models.map(m=>({group:m.group,decision_detector:m.decision_detector,selection:m.selection,thresholds:m.thresholds,features:m.features,seed:m.seed,treeCount:m.treeCount,sampleSize:m.sampleSize,training_period:artifact.periods.train})),
    evaluation_period:mode==='ACADEMIC_SYNTHETIC'?artifact.periods.test:p,model_validation:mode==='ACADEMIC_SYNTHETIC'?'SYNTHETIC_BENCHMARK':'TRANSFER_FROM_SYNTHETIC_NOT_OPERATIONALLY_VALIDATED'};
  const health=buildHealthViews(observations,reference,metadata),modelMetrics=[];
  for(const group of [...artifact.models.map(m=>m.group),'total'])for(const detector of ['IF','MAD','IQR'])
    modelMetrics.push({...evaluateDetector(group==='total'?evaluation:evaluation.filter(row=>row.model_id===group),detector),group});
  const filtersMetadata={available_start:p.start,available_end:p.end,periods:['today','7','30','90','custom'],
    accounts:accountIds,workspaces:[...new Set(observations.map(row=>keyOf(row.account_id,row.workspace_id)))].sort(),devices:[...new Set(observations.map(row=>keyOf(row.account_id,row.workspace_id,row.device_id)))].sort(),
    tools:[...new Set(observations.map(row=>row.tool_id))].sort(),platforms:[...new Set(observations.map(row=>row.device_platform))].sort()};
  const result={schema_version:RESULT_SCHEMA_VERSION,metadata,detectors:metadata.model_selection,...health,observations,referenceObservations:reference,evaluationObservations:evaluation,
    anomalies:observations.filter(row=>row.is_anomaly),trends:buildTrends(observations,reference,metadata),modelMetrics,dataQuality,
    explanations:Object.fromEntries(health.priorityQueue.map(entity=>[entity.key,entity.reasons])),filtersMetadata};
  return assertIntelligenceResult(result);
}
