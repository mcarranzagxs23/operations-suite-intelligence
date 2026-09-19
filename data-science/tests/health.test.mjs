import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScenarios} from '../lib/synthetic-scenarios.mjs';
import {transformRecords} from '../lib/dataset-etl.mjs';
import {trainDetectors} from '../lib/model-analysis.mjs';
import {buildHealthViews,priorityCompare,summarizeEntity} from '../lib/health-priority.mjs';
const t=trainDetectors(transformRecords(generateScenarios()).transformed);
const rows=t.scored.filter(r=>r.completed_at>=t.split.ranges.inference.start),reference=t.scored.filter(r=>r.completed_at<=t.split.ranges.train.end);
const metadata={period_start:t.split.ranges.inference.start,period_end:t.split.ranges.inference.end,reference_start:t.split.ranges.train.start,reference_end:t.split.ranges.train.end,dataset_version:'0.2.0',model_version:'2.0.0',detector:'CALIBRATED',computed_at:t.split.ranges.inference.end};
const health=buildHealthViews(rows,reference,metadata);
test('health separates identical workspace ids across accounts',()=>{
const shared=health.workspaces.filter(w=>w.entity_id==='workspace_shared');assert.equal(shared.length,2);assert.notEqual(shared[0].key,shared[1].key);
assert.equal(health.accounts.length,3);
});
test('reference must precede evaluation and small samples never show precise health',()=>{
const sparse=health.workspaces.find(w=>w.entity_id==='workspace_sparse');assert.equal(sparse.health_status,'insufficient_data');assert.equal(sparse.health_score,null);assert.equal(sparse.health_components.processing,null);
const self=summarizeEntity('global','global',rows,rows,metadata);assert.equal(self.health_score,null);
});
test('increased failures lower trend with unchanged duration',()=>{
const normal=rows.slice(0,40).map(r=>({...r,status:'success',is_anomaly:false,duration_seconds:4,tool_id:'clean-vector-pro',action:'CLEAN ART',tool_version:'3.6.1'}));
const past=normal.map(r=>({...r,completed_at:'2026-01-01T10:00:00.000Z'}));
const healthy=summarizeEntity('global','global',normal,past,metadata);
const failed=summarizeEntity('global','global',normal.map(r=>({...r,status:'failure'})),past,metadata);
assert.equal(healthy.health_components.trend,100);assert.equal(failed.health_components.trend,0);
assert.ok(failed.reasons.some(r=>r.code==='FAILURE_RATE'));
});
test('priority ties are deterministic and account-scoped',()=>{
const source=health.workspaces[0],a={...source,key:'a'},b={...source,key:'b'};
assert.ok(priorityCompare(a,b)<0);assert.deepEqual([...health.priorityQueue].sort(priorityCompare).map(r=>r.key),health.priorityQueue.map(r=>r.key));
});
test('why flagged reports evidence and recommendations without causal guesses',()=>{
for(const entity of health.priorityQueue){assert.ok(entity.reasons.length);assert.ok(entity.recommended_action);assert.ok(!JSON.stringify(entity.reasons).match(/CPU|RAM|network/));}
const alert=rows.find(r=>r.is_anomaly);assert.equal(alert.explanation.observed_seconds,alert.duration_seconds);assert.equal(alert.explanation.ratio,alert.duration_ratio);assert.ok(alert.explanation.detected_by.length);
});
test('synthetic behavioral scenarios naturally cover all health states',()=>{
assert.deepEqual([...new Set(health.workspaces.map(w=>w.health_status))].sort(),['critical','healthy','high_risk','insufficient_data','monitor']);
});
console.log('Workspace health:',health.workspaces.map(w=>({account:w.account_id,id:w.entity_id,score:w.health_score,status:w.health_status})));
