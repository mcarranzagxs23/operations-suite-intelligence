import {readFile,writeFile} from 'node:fs/promises';
import {buildResult} from '../lib/result-builder.mjs';
const out='data-science/artifacts/v0.2';
const read=async name=>JSON.parse(await readFile(out+'/'+name,'utf8'));
const [scored,artifact,dataQuality,manifest]=await Promise.all(['scored.json','model.json','quality.json','manifest.json'].map(read));
const result=buildResult({scored,artifact,dataQuality,computedAt:manifest.computed_at});
await writeFile(out+'/intelligence-result.json',JSON.stringify(result)+'\n');
console.log(JSON.stringify({schema:result.schema_version,observations:result.observations.length,health:result.globalHealth.health_status,decision:result.detectors.map(d=>d.decision_detector)}));
