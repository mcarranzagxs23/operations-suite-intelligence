import {buildHealthViews,buildTrends,keyOf} from '../intelligence/analysis.js';
import {evaluateDetector} from '../intelligence/metrics.js';
import {assertIntelligenceResult} from '../intelligence/result-contract.js';
export function assertIntelligenceSession(session,role=session?.role) {
  const academicDemo=session?.mode==='demo'&&session?.demoScenario==='super_admin';
  if((session?.globalRole!=='super_admin'&&!academicDemo)||role!=='super_admin')throw new Error('DENIED');
}
export function projectIntelligence(result,filters={},session) {
  assertIntelligenceSession(session);assertIntelligenceResult(result);
  const end=result.metadata.period_end,anchor=Date.parse(end.slice(0,10)+'T00:00:00.000Z'),period=filters.period||'90';
  if(!['today','7','30','90','custom'].includes(period))throw new Error('INVALID_PERIOD');
  let start=period==='custom'?filters.start+'T00:00:00.000Z':new Date(anchor-((period==='today'?1:Number(period))-1)*86400000).toISOString();
  let finish=period==='custom'?filters.end+'T23:59:59.999Z':end;
  if(!['today','7','30','90','custom'].includes(period)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(finish))||start>finish)throw new Error('INVALID_PERIOD');
  start=start<result.metadata.period_start?result.metadata.period_start:start;
  finish=finish>end?end:finish;
  const detector=filters.detector||'decision';
  if(!['decision','IF','MAD','IQR'].includes(detector))throw new Error('INVALID_DETECTOR');
  const remap=row=>{
    if(detector==='decision')return row;
    const d=row.detectors[detector];
    return {...row,is_anomaly:d.prediction,severity:d.severity,decision_detector:detector,recommended_action:d.prediction?'REVIEW_EXECUTIONS':'MONITOR_NEXT_EXECUTIONS',explanation:{...row.explanation,code:d.prediction?'DURATION_DEVIATION':'WITHIN_REFERENCE'}};
  };
  const matches=row=>(!filters.account||row.account_id===filters.account)&&(!filters.workspace||keyOf(row.account_id,row.workspace_id)===filters.workspace)
    &&(!filters.device||keyOf(row.account_id,row.workspace_id,row.device_id)===filters.device)&&(!filters.tool||row.tool_id===filters.tool)
    &&(!filters.platform||row.device_platform===filters.platform)&&(!filters.status||row.status===filters.status)&&(!filters.severity||row.severity===filters.severity);
  const selected=result.observations.map(remap).filter(matches).filter(row=>row.completed_at>=start&&row.completed_at<=finish);
  const reference=result.referenceObservations.map(remap).filter(matches);
  const metadata={...result.metadata,period_start:start,period_end:finish,detector:detector==='decision'?'CALIBRATION_SELECTED':detector};
  const health=buildHealthViews(selected,reference,metadata);
  const evaluation=result.evaluationObservations.filter(row=>(!filters.account||row.account_id===filters.account)&&(!filters.tool||row.tool_id===filters.tool)&&(!filters.workspace||keyOf(row.account_id,row.workspace_id)===filters.workspace)&&(!filters.device||keyOf(row.account_id,row.workspace_id,row.device_id)===filters.device)&&(!filters.platform||row.device_platform===filters.platform));
  const modelMetrics=[];
  for(const group of [...new Set(result.metadata.model_selection.map(m=>m.group)),'total'])for(const d of ['IF','MAD','IQR'])modelMetrics.push({...evaluateDetector(group==='total'?evaluation:evaluation.filter(row=>row.model_id===group),d),group});
  // referenceObservations: the filtered reference cohort health was scored against, so a view can show it.
  return {metadata,...health,observations:selected,referenceObservations:reference,anomalies:selected.filter(row=>row.is_anomaly),trends:buildTrends(selected,reference,metadata),modelMetrics,empty:selected.length===0};
}
