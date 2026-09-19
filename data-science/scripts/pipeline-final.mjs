import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {generateScenarios,DATASET_VERSION,RAW_COLUMNS} from '../lib/synthetic-scenarios.mjs';
import {transformRecords,ANALYTIC_COLUMNS} from '../lib/dataset-etl.mjs';
import {fromCsv,toCsv} from '../lib/csv.mjs';
import {loadDetectorArtifact,evaluateDetector} from '../lib/model-analysis.mjs';
import {buildEda} from '../lib/eda.mjs';
const out='data-science/artifacts/v0.2';await mkdir(out,{recursive:true});
const read=async n=>JSON.parse(await readFile(out+'/'+n,'utf8'));
const write=async(n,v)=>writeFile(out+'/'+n,JSON.stringify(v,null,n==='scored.json'?0:2)+'\n');
const command=process.argv[2];
if(command==='generate')await writeFile(out+'/dataset.csv',toCsv(generateScenarios(),RAW_COLUMNS)+'\n');
else if(command==='etl'){
  const raw=fromCsv(await readFile(out+'/dataset.csv','utf8'));
  const etl=transformRecords(raw,{datasetVersion:DATASET_VERSION,generatedAt:raw.map(r=>r.received_at).sort().at(-1)});
  await write('quality.json',etl.report);if(etl.rejected.length)throw new Error('DATA_QUALITY_REJECTED');
  await writeFile(out+'/processed.csv',toCsv(etl.transformed,ANALYTIC_COLUMNS)+'\n');
}else if(command==='score'){
  const artifact=await read('model.json'),model=loadDetectorArtifact(artifact);
  const raw=fromCsv(await readFile(out+'/dataset.csv','utf8'));
  const etl=transformRecords(raw,{datasetVersion:DATASET_VERSION,generatedAt:raw.map(r=>r.received_at).sort().at(-1)});
  if(etl.rejected.length)throw new Error('DATA_QUALITY_REJECTED');
  await write('scored.json',etl.transformed.map(r=>model.score(r)));
}else if(command==='evaluate'){
  const artifact=await read('model.json'),scored=await read('scored.json');
  const rows=scored.filter(r=>r.completed_at>=artifact.periods.test.start&&r.completed_at<=artifact.periods.test.end),metrics=[];
  for(const group of [...artifact.models.map(m=>m.group),'total'])for(const d of ['IF','MAD','IQR'])metrics.push({...evaluateDetector(group==='total'?rows:rows.filter(r=>r.model_id===group),d),group});
  await write('metrics.json',metrics);console.log(JSON.stringify(metrics.filter(r=>r.group==='total')));
}else if(command==='eda'){
  const scored=await read('scored.json'),metrics=await read('metrics.json');await write('eda.json',buildEda(scored,{scored,metrics}));
}else throw new Error('UNKNOWN_PIPELINE_STAGE');
console.log(command+' complete');
