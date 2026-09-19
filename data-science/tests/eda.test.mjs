import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEda} from '../lib/eda.mjs';
test('EDA visual values follow input instead of historical constants',()=>{
const row={tool_id:'clean-vector-pro',duration_seconds:3,completed_at:'2026-01-01T00:00:00.000Z',status:'success',expected_anomaly:false,data_origin:'SYNTHETIC'};
const a=buildEda([row]),b=buildEda([row,{...row,status:'failure',duration_seconds:9}]);
assert.equal(a.tools[0].median,3);assert.equal(b.tools[0].median,6);
assert.equal(b.charts.find(c=>c.id==='status').points.find(p=>p.label==='failure').value,1);
assert.equal(b.charts.find(c=>c.id==='executions').points[0].value,2);
assert.deepEqual(buildEda([]).tools,[]);
});
