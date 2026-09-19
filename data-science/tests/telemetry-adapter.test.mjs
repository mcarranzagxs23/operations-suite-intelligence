import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptTelemetry,extractTelemetry,reconcileDaily} from '../lib/telemetry-adapter.mjs';
import {generateScenarios} from '../lib/synthetic-scenarios.mjs';
import {transformRecords} from '../lib/dataset-etl.mjs';
const raw=generateScenarios()[0];
const event={executionId:raw.execution_id,accountId:raw.account_id,workspaceId:raw.workspace_id,deviceId:raw.device_id,actorUid:raw.actor_uid,toolId:raw.tool_id,toolVersion:raw.tool_version,action:raw.action,status:raw.status,errorCode:raw.error_code,durationMs:+raw.duration_ms,startedAt:raw.started_at,completedAt:raw.completed_at,receivedAt:{toDate:()=>new Date(raw.received_at)},source:raw.source,hostVersion:null,suiteVersion:null,unwantedPayload:'must not cross'};
test('telemetry adapter maps timestamps and unknown labels using a closed projection',()=>{
const r=adaptTelemetry({events:[event],accountId:raw.account_id,devices:[{id:raw.device_id,accountId:raw.account_id,workspaceId:raw.workspace_id,platform:raw.device_platform}]});
assert.equal(r.report.accepted_count,1);assert.equal(r.transformed[0].expected_anomaly,null);assert.equal('unwantedPayload' in r.transformed[0],false);
assert.throws(()=>adaptTelemetry({events:[event],accountId:'account_other'}),/SCOPE/);
});
test('paginated extraction denies non admins, preserves range and exposes limits',async()=>{
const options={principal:{super_admin:true},accountId:raw.account_id,start:'2026-03-01T00:00:00.000Z',end:'2026-03-01T23:59:59.999Z',pageSize:1,maxEvents:2};
await assert.rejects(extractTelemetry({...options,principal:{super_admin:false}}),/DENIED/);
let calls=0;const r=await extractTelemetry({...options,readPage:async()=>({rows:[{...event,executionId:'exec_'+(++calls)}],nextCursor:String(calls)})});
assert.equal(r.events.length,2);assert.equal(r.coverage.complete,false);assert.equal(calls,2);
});
test('reconciliation reports mismatch and incomplete coverage without writes',()=>{
const rows=transformRecords([raw]).transformed;
assert.equal(reconcileDaily(rows,[]).status,'MISMATCH');
assert.equal(reconcileDaily(rows,[],{complete:false}).status,'INCOMPLETE_COVERAGE');
assert.equal(reconcileDaily(rows,[],{available:false}).status,'UNAVAILABLE');
});
test('v0.2 is deterministic, strict and exercises cross-account workspace identity',()=>{
const a=generateScenarios(),b=generateScenarios();assert.deepEqual(a,b);
const r=transformRecords(a);assert.equal(r.report.rejected_count,0);assert.equal(r.report.workspace_count,5);
assert.equal(new Set(a.map(x=>x.completed_at.slice(0,10))).size,180);
});
