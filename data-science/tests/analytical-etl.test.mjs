import test from 'node:test';
import assert from 'node:assert/strict';
import {generateSyntheticTelemetry} from '../lib/synthetic-telemetry.mjs';
import {validateRawRecord,transformRecords,runEtlFromCsv} from '../lib/dataset-etl.mjs';
const sample=generateSyntheticTelemetry({eventCount:90})[0];
for(const [name,values] of Object.entries({date:{completed_at:'2026-02-30T10:00:00.000Z'},semver:{tool_version:'v1'},source:{source:'unknown'},optional:{host_version:'x'.repeat(33)},id:{workspace_id:'bad id'},duration:{duration_ms:'-1'},received:{received_at:'2020-01-01T00:00:00.000Z'}}))
test('analytical ETL rejects invalid '+name,()=>assert.equal(validateRawRecord({...sample,...values}).valid,false));
test('controlled unknown label remains null',()=>{
const r=transformRecords([{...sample,data_origin:'REAL_CONTROLLED',expected_anomaly:null,synthetic_pattern:'',host_version:null}]);
assert.equal(r.report.accepted_count,1);assert.equal(r.transformed[0].expected_anomaly,null);
});
test('identical duplicates are idempotent; conflicts quarantine every participant',()=>{
assert.equal(transformRecords([sample,{...sample}]).report.deduplicated_count,1);
const r=transformRecords([sample,{...sample,duration_ms:'123'}]);assert.equal(r.report.conflict_count,1);assert.equal(r.report.accepted_count,0);assert.equal(r.report.rejected_count,2);
});
test('account identity prevents workspace device and execution collisions',()=>{
const r=transformRecords([sample,{...sample,account_id:'account_other'}]);assert.equal(r.report.accepted_count,2);assert.equal(r.report.workspace_count,2);assert.equal(r.report.device_count,2);
});
test('malformed CSV returns observable quality evidence',()=>assert.equal(runEtlFromCsv('a,a\n1,2').report.parse_error,'CSV contains duplicate headers.'));
