import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectIntelligence} from '../src/selectors/intelligence-projection.js';
import {observedMetrics} from '../src/intelligence/analysis.js';
import {
  SEVERITY_RANK,buildConclusion,compareSpotlight,detectorAgreement,entityReferenceRows,explainAnomaly,explainHealth,filterImpact,
  layoutMarkerLabels,modelComparison,periodComparison,previousPeriodFilters,priorityContext,reasonSignals,selectPriorityWorkspace,
  selectSpotlightAnomaly,statusForScore,summarizeView,
} from '../src/intelligence/presentation.js';

// Every value the defense views show is derived here from the real result
// contract; these tests prove the derivations reproduce the pipeline's own
// numbers and never introduce one of their own.
const result=JSON.parse(await readFile(new URL('../data-science/artifacts/v0.2/intelligence-result.json',import.meta.url),'utf8'));
const admin={role:'super_admin',globalRole:'super_admin'};
const project=filters=>projectIntelligence(result,filters,admin);
const policy=result.metadata.health_policy;
const FILTERS=[{},{period:'30'},{period:'7'},{account:'account_demo_b'},{account:'account_demo_a',period:'30'},{tool:'sepmaker-pro'},{detector:'IF'},{status:'failure'}];
const entitiesOf=view=>[view.globalHealth,...view.accounts,...view.workspaces,...view.devices,...view.tools];
const close=(a,b,tolerance)=>Math.abs(a-b)<=tolerance;

test('the health explanation reproduces every published Health Score from the contract weights',()=>{
  let scored=0;
  for(const filters of FILTERS) {
    const view=project(filters);
    for(const entity of entitiesOf(view)) {
      const x=explainHealth(entity,policy,view.referenceObservations);
      assert.deepEqual(x.components.map(c=>c.weight),Object.values(policy.weights));
      for(const c of x.components)assert.equal(c.value,entity.health_components[c.id]);
      if(entity.health_score===null){assert.equal(x.sum,null);continue;}
      scored++;
      assert.ok(close(x.sum,entity.health_score,.005),`${entity.key}: ${x.sum} vs ${entity.health_score}`);
    }
  }
  assert.ok(scored>50);
});

test('weights and thresholds are read from the result contract, not from constants',()=>{
  const view=project({}),entity=view.workspaces[0];
  const altered={...policy,weights:{outcome:.4,anomaly:.2,processing:.2,trend:.2},thresholds:{healthy:95,monitor:80,high_risk:50}};
  const x=explainHealth(entity,altered,view.referenceObservations);
  assert.deepEqual(x.components.map(c=>c.weight),[.4,.2,.2,.2]);
  assert.ok(close(x.components[0].contribution,entity.health_components.outcome*.4,1e-9));
  assert.deepEqual(x.thresholds,altered.thresholds);
  assert.throws(()=>explainHealth(entity,{},view.referenceObservations),/HEALTH_POLICY_MISSING/);
});

test('status bands from the published thresholds agree with the status of every entity',()=>{
  for(const filters of FILTERS)for(const entity of entitiesOf(project(filters)))
    assert.equal(statusForScore(entity.health_score,policy.thresholds),entity.health_status,entity.key);
});

test('current vs reference uses exactly the reference cohort each score was computed against',()=>{
  for(const filters of FILTERS) {
    const view=project(filters);
    for(const entity of entitiesOf(view)) {
      const x=explainHealth(entity,policy,view.referenceObservations);
      assert.equal(x.referenceSize,entity.reference_sample_size,entity.key);
      const byId=Object.fromEntries(x.comparison.map(c=>[c.id,c]));
      assert.equal(byId.successRate.current,entity.metrics.successRate);
      assert.equal(byId.median.current,entity.metrics.duration.median??null);
      // Independent check: the pipeline stored the reference rate in each reason; the explorer must show the same value.
      for(const [code,id] of [['ANOMALY_RATE','anomalyRate'],['FAILURE_RATE','failureRate'],['CANCELLATION_RATE','cancellationRate']]) {
        const reason=entity.reasons.find(r=>r.code===code);
        if(reason)assert.equal(byId[id].reference,reason.reference,`${entity.key} ${code}`);
      }
    }
  }
  const view=project({}),workspace=view.workspaces.find(w=>w.health_status==='critical');
  const reference=observedMetrics(entityReferenceRows(workspace,view.referenceObservations));
  assert.equal(reference.total,workspace.reference_sample_size);
  assert.throws(()=>entityReferenceRows({entity_type:'nope'},[]),/UNKNOWN_ENTITY_TYPE/);
});

test('the projection exposes the filtered reference cohort it scored against',()=>{
  const view=project({account:'account_demo_b'});
  assert.ok(view.referenceObservations.length>0);
  assert.ok(view.referenceObservations.every(r=>r.account_id==='account_demo_b'));
  assert.equal(view.referenceObservations.length,view.globalHealth.reference_sample_size);
});

test('the featured anomaly is derived from the data by a fixed, documented policy',async()=>{
  const view=project({}),spotlight=selectSpotlightAnomaly(view.anomalies);
  assert.ok(spotlight.is_anomaly);
  const top=Math.max(...view.anomalies.map(a=>SEVERITY_RANK[a.severity]));
  assert.equal(SEVERITY_RANK[spotlight.severity],top);
  assert.ok(view.anomalies.every(a=>a===spotlight||compareSpotlight(spotlight,a)<0),'no anomaly ranks above the spotlight');
  // The policy reproduces the case documented for the defense; the interface never names it.
  assert.equal(spotlight.execution_id,'exec_v02_0005709');
  const sources=(await Promise.all(['IntelligenceCenter.jsx','IntelligenceInsights.jsx','IntelligenceParts.jsx'].map(f=>readFile(new URL('../src/views/'+f,import.meta.url),'utf8')))).join('\n');
  assert.doesNotMatch(sources,/exec_v02_|workspace_incident|device_incident|account_demo/);
  const scoped=selectSpotlightAnomaly(project({account:'account_demo_a'}).anomalies);
  assert.equal(scoped.account_id,'account_demo_a');
  assert.equal(selectSpotlightAnomaly(project({status:'success',severity:'none'}).anomalies),null);
  // Fast and slow deviations of the same log distance weigh alike.
  const base={is_anomaly:true,severity:'high',completed_at:'2026-01-01T00:00:00.000Z'};
  assert.equal(compareSpotlight({...base,execution_id:'a',duration_ratio:4},{...base,execution_id:'b',duration_ratio:.25}),'a'.localeCompare('b'));
});

test('the priority workspace is the first scored workspace of the priority queue',()=>{
  const view=project({}),workspace=selectPriorityWorkspace(view.priorityQueue);
  assert.equal(workspace,view.priorityQueue.find(e=>e.entity_type==='workspace'&&e.health_status!=='insufficient_data'));
  assert.equal(workspace.entity_id,'workspace_incident');
  assert.deepEqual(priorityContext(workspace,view),{rank:workspace.priority,queueSize:view.priorityQueue.length,typeRank:1,typeSize:view.workspaces.length});
  assert.equal(priorityContext(view.globalHealth,view),null);
  assert.equal(selectPriorityWorkspace(project({account:'account_demo_a'}).priorityQueue).account_id,'account_demo_a');
  assert.equal(selectPriorityWorkspace(project({account:'account_demo_c'}).priorityQueue),null);
});

test('why flagged reproduces the scored row and the calibrated decision detector',()=>{
  const view=project({}),row=selectSpotlightAnomaly(view.anomalies),x=explainAnomaly(row,result.metadata);
  assert.equal(x.observed,row.duration_seconds);
  assert.equal(x.median,row.reference_median);
  assert.equal(x.p95,row.reference_p95);
  assert.equal(x.ratio,row.duration_ratio);
  assert.ok(close(x.medianChange*100,1653.29,.01));
  assert.ok(close(x.ratio,17.53,.01));
  assert.deepEqual(x.flaggedBy,['IF','MAD','IQR'].filter(d=>row.detectors[d].prediction));
  for(const d of x.detectors) {
    assert.equal(d.score,row.detectors[d.id].score);
    assert.equal(d.threshold,row.detectors[d.id].threshold);
    assert.equal(d.prediction,d.score>d.threshold);
  }
  assert.equal(x.calibratedDetector,result.metadata.model_selection.find(m=>m.group===row.model_id).decision_detector);
  assert.equal(x.projectionDetector,null);
  assert.deepEqual([x.iqr.lower,x.iqr.upper],[row.explanation.iqr_lower_seconds,row.explanation.iqr_upper_seconds]);
  // An explicit detector filter projects the view for comparison; the calibrated decision is still reported.
  const compared=project({detector:'IF'}).anomalies.find(r=>r.execution_id===row.execution_id);
  const y=explainAnomaly(compared,result.metadata);
  assert.equal(y.calibratedDetector,'MAD');
  assert.equal(y.projectionDetector,'IF');
});

test('the duration scale keeps every marker on the track and no two labels overlap',()=>{
  for(const row of project({}).anomalies.slice(0,200)) {
    const {scale}=explainAnomaly(row,result.metadata);
    for(const m of scale.markers)assert.ok(m.at>=0&&m.at<=100);
    assert.ok(scale.band.from<=scale.band.to);
    const rows=new Map();
    for(const m of scale.markers){if(!rows.has(m.row))rows.set(m.row,[]);rows.get(m.row).push(m.at);}
    for(const positions of rows.values())for(let i=1;i<positions.length;i++)assert.ok(positions[i]-positions[i-1]>=24);
  }
  assert.deepEqual(layoutMarkerLabels([{id:'a',at:10},{id:'b',at:12},{id:'c',at:90}]).map(m=>[m.id,m.row]),[['a',0],['b',1],['c',0]]);
});

test('the model comparison reads held-out metrics and the calibration evidence from the contract',()=>{
  const view=project({}),x=modelComparison(view.modelMetrics,result.metadata);
  for(const d of x.detectors)assert.deepEqual(d.metrics,view.modelMetrics.find(m=>m.group==='total'&&m.detector===d.id));
  assert.deepEqual(x.decision,[...new Set(result.metadata.model_selection.map(m=>m.decision_detector))]);
  assert.deepEqual(x.decision,['MAD']);
  assert.deepEqual(x.policies,['CALIBRATION_F1_WITH_FIXED_CANDIDATES']);
  assert.equal(x.usesTest,false);
  for(const c of x.calibration) {
    const selection=result.metadata.model_selection.find(m=>m.group===c.group).selection;
    for(const id of ['IF','MAD','IQR'])assert.equal(c.f1[id],selection.comparison.find(s=>s.detector===id).f1);
  }
  assert.deepEqual(x.evaluationPeriod,result.metadata.evaluation_period);
});

test('comparison mode never alters the decision detector, the model or any Health Score',()=>{
  const before=JSON.stringify({selection:result.metadata.model_selection,detectors:result.detectors,health:result.globalHealth,workspaces:result.workspaces});
  const view=project({}),healthBefore=JSON.stringify(entitiesOf(view).map(e=>[e.key,e.health_score]));
  for(const focus of ['IF','MAD','IQR']) {
    const a=detectorAgreement(view.observations,focus,result.metadata);
    assert.equal(a.total,view.observations.length);
    assert.equal(a.flagged,view.observations.filter(r=>r.detectors[focus].prediction).length);
    assert.equal(a.decisionFlagged,view.anomalies.length);
    assert.equal(a.both+a.focusOnly,a.flagged);
    assert.equal(a.both+a.decisionOnly,a.decisionFlagged);
    assert.deepEqual(a.decision,['MAD']);
  }
  assert.throws(()=>detectorAgreement(view.observations,'XYZ',result.metadata),/INVALID_DETECTOR/);
  assert.equal(JSON.stringify({selection:result.metadata.model_selection,detectors:result.detectors,health:result.globalHealth,workspaces:result.workspaces}),before);
  assert.equal(JSON.stringify(entitiesOf(project({})).map(e=>[e.key,e.health_score])),healthBefore);
});

test('the filter impact summary reports the projection before and after a change',()=>{
  const all=summarizeView(project({})),thirty=summarizeView(project({period:'30'}));
  const impact=Object.fromEntries(filterImpact(all,thirty).map(i=>[i.id,i]));
  assert.deepEqual([impact.executions.from,impact.executions.to],[all.executions,thirty.executions]);
  assert.deepEqual([impact.anomalies.from,impact.anomalies.to],[all.anomalies,thirty.anomalies]);
  assert.deepEqual([impact.health.from,impact.health.to],[all.health,thirty.health]);
  assert.deepEqual([impact.successRate.from,impact.successRate.to],[all.successRate,thirty.successRate]);
  assert.deepEqual([impact.median.from,impact.median.to],[all.median,thirty.median]);
  assert.ok(Object.values(impact).every(i=>i.changed));
  // The documented defense path: 90 → 30 days.
  assert.deepEqual([all.executions,thirty.executions,all.anomalies,thirty.anomalies,all.health,thirty.health],[2885,961,810,274,65.73,64.75]);
  const workspace=summarizeView(project({account:'account_demo_b',workspace:JSON.stringify(['account_demo_b','workspace_incident'])}));
  assert.deepEqual([workspace.executions,workspace.anomalies,workspace.health,workspace.status],[720,708,3.33,'critical']);
  assert.deepEqual([all.median,thirty.median],[10.928,11.181]);
  assert.ok(close(workspace.median,25.32,.005),String(workspace.median));
  assert.ok(filterImpact(all,all).every(i=>!i.changed));
});

test('the previous period lies inside the inference window and uses the same reference',()=>{
  const metadata=result.metadata;
  assert.deepEqual(previousPeriodFilters({period:'30'},metadata),{period:'custom',start:'2026-06-29',end:'2026-07-28'});
  assert.deepEqual(previousPeriodFilters({period:'7',account:'account_demo_b'},metadata),{period:'custom',start:'2026-08-14',end:'2026-08-20',account:'account_demo_b'});
  assert.deepEqual(previousPeriodFilters({period:'today'},metadata),{period:'custom',start:'2026-08-26',end:'2026-08-26'});
  assert.equal(previousPeriodFilters({period:'90'},metadata),null);
  assert.equal(previousPeriodFilters({},metadata),null);
  const current=project({period:'30'}),previousFilters=previousPeriodFilters({period:'30'},metadata),previous=project(previousFilters);
  assert.ok(previous.observations.every(r=>r.completed_at>='2026-06-29T00:00:00.000Z'&&r.completed_at<='2026-07-28T23:59:59.999Z'));
  assert.ok(previous.observations.every(r=>r.completed_at>=metadata.period_start));
  assert.ok(previous.observations.every(r=>!current.observations.some(c=>c.execution_id===r.execution_id)),'windows do not overlap');
  assert.equal(previous.globalHealth.reference_sample_size,current.globalHealth.reference_sample_size);
  const rows=Object.fromEntries(periodComparison(current,previous).map(r=>[r.id,r]));
  assert.equal(rows.health.current,current.globalHealth.health_score);
  assert.equal(rows.health.previous,previous.globalHealth.health_score);
  assert.ok(close(rows.health.delta,current.globalHealth.health_score-previous.globalHealth.health_score,1e-9));
  assert.equal(rows.executions.previous,previous.observations.length);
});

test('the conclusion states only facts taken from the projected view',()=>{
  const view=project({}),c=buildConclusion(view,result.metadata);
  assert.equal(c.first,view.priorityQueue.find(e=>e.health_status!=='insufficient_data'));
  assert.equal(c.queueSize,view.priorityQueue.length);
  assert.equal(c.workspace,selectPriorityWorkspace(view.priorityQueue));
  assert.equal(c.anomaly,selectSpotlightAnomaly(view.anomalies));
  assert.deepEqual(c.decision,['MAD']);
  assert.equal(c.decisionMetrics[0].f1,view.modelMetrics.find(m=>m.group==='total'&&m.detector==='MAD').f1);
  assert.equal(c.evidence.ANOMALY_RATE,c.first.reasons.find(r=>r.code==='ANOMALY_RATE'));
  assert.equal(c.calibrated,true);
  assert.equal(buildConclusion(project({account:'account_demo_c'}),result.metadata).first,null);
});

test('reason signals keep a direction only where observed and reference are comparable',()=>{
  const view=project({}),workspace=selectPriorityWorkspace(view.priorityQueue);
  const signals=reasonSignals(workspace.reasons);
  assert.deepEqual(signals.map(s=>s.code),['ANOMALY_RATE','FAILURE_RATE','CANCELLATION_RATE','DURATION_INCREASE']);
  assert.ok(signals.every(s=>s.direction==='up'));
  assert.deepEqual(reasonSignals([{code:'INSUFFICIENT_OBSERVATIONS',observed:5,reference:3,minimum:20}]),[{code:'INSUFFICIENT_OBSERVATIONS',direction:null}]);
  assert.deepEqual(reasonSignals([{code:'ANOMALY_RATE',observed:.01,reference:.03}]),[{code:'ANOMALY_RATE',direction:'down'}]);
});
