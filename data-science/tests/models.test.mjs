import test from 'node:test';
import assert from 'node:assert/strict';
import {generateScenarios} from '../lib/synthetic-scenarios.mjs';
import {transformRecords} from '../lib/dataset-etl.mjs';
import {trainDetectors,loadDetectorArtifact,evaluateDetector,temporalSplit} from '../lib/model-analysis.mjs';
import {fitIsolationForest,loadIsolationForest} from '../lib/isolation-forest.mjs';
const rows=transformRecords(generateScenarios()).transformed;
const trained=trainDetectors(rows);
test('global calendar partitions are strictly ordered and disjoint',()=>{
const s=trained.split;assert.equal(s.ranges.train.end<'2026-05-01',true);
assert.ok(s.ranges.train.end<s.ranges.calibration.start);assert.ok(s.ranges.calibration.end<s.ranges.test.start);assert.ok(s.ranges.test.end<s.ranges.inference.start);
const ids=[...s.train,...s.calibration,...s.test,...s.inference].map(r=>r.execution_id);assert.equal(new Set(ids).size,rows.length);
assert.throws(()=>temporalSplit(rows.map(r=>({...r,completed_at:rows[0].completed_at}))),/COVERAGE/);
});
test('saved forest restores identical scores and rejects corrupt metadata',()=>{
const loaded=loadDetectorArtifact(JSON.parse(JSON.stringify(trained.artifact)));
assert.deepEqual(loaded.score(rows.at(-1)),trained.scored.at(-1));
assert.throws(()=>loadDetectorArtifact({...trained.artifact,model_version:'unknown'}),/ARTIFACT/);
assert.throws(()=>loadIsolationForest({}),/ARTIFACT/);
});
test('test outcomes never choose thresholds or decision detector',()=>{
const altered=rows.map(r=>r.completed_at>=trained.split.ranges.test.start?{...r,duration_ms:r.duration_ms*2,log_duration:Math.log1p(r.duration_ms*2),duration_seconds:r.duration_seconds*2,expected_anomaly:!r.expected_anomaly}:r);
assert.deepEqual(trainDetectors(altered).artifact.models,trained.artifact.models);
});
test('all three detectors report independently; normal severity is none',()=>{
for(const r of trained.scored)for(const d of ['IF','MAD','IQR']){assert.equal(Number.isFinite(r.detectors[d].score),true);if(!r.detectors[d].prediction)assert.equal(r.detectors[d].severity,'none');}
assert.equal(trained.metrics.length,9);
assert.ok(trained.metrics.every(m=>m.TP+m.FP+m.TN+m.FN===m.labelled_count));
});
test('unknown labels are NOT EVALUABLE rather than perfect or zero metrics',()=>{
const m=evaluateDetector(trained.scored.slice(0,10).map(r=>({...r,expected_anomaly:null})),'IF');
assert.equal(m.status,'NOT EVALUABLE');assert.equal(m.f1,null);assert.equal(m.TP,null);assert.equal(m.precision_at_k,null);
});
test('Isolation Forest isolates extremes and validates every fitting parameter',()=>{
const input=Array.from({length:200},(_,i)=>[Math.sin(i)*.1]);
const forest=fitIsolationForest(input,{seed:42});
assert.ok(forest.score([8])>forest.score([0]));
for(const options of [{seed:-1},{sampleSize:1},{sampleSize:1.2},{treeCount:0},{treeCount:2001}])assert.throws(()=>fitIsolationForest(input,options));
});
test('constant-duration reference does not flag every tied score',()=>{
const constant=rows.map(r=>({...r,log_duration:Math.log1p(4000),duration_ms:4000,duration_seconds:4,expected_anomaly:false}));
const t=trainDetectors(constant);
assert.ok(t.scored.every(r=>!r.detectors.IF.prediction&&!r.detectors.MAD.prediction&&!r.detectors.IQR.prediction));
});
