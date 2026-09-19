import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {generateScenarios,DATASET_VERSION,SCENARIO_SEED,RAW_COLUMNS} from '../lib/synthetic-scenarios.mjs';
import {transformRecords,ANALYTIC_COLUMNS} from '../lib/dataset-etl.mjs';
import {toCsv} from '../lib/csv.mjs';
import {trainDetectors,loadDetectorArtifact} from '../lib/model-analysis.mjs';
import {buildEda} from '../lib/eda.mjs';
export async function trainFinal() {
  const raw=generateScenarios(),computedAt=raw.map(r=>r.received_at).sort().at(-1);
  const etl=transformRecords(raw,{datasetVersion:DATASET_VERSION,generatedAt:computedAt});
  const out='data-science/artifacts/v0.2';await mkdir(out,{recursive:true});
  await writeFile(out+'/quality.json',JSON.stringify(etl.report,null,2)+'\n');
  if(etl.rejected.length)throw new Error('DATA_QUALITY_REJECTED: inspect '+out+'/quality.json');
  const result=trainDetectors(etl.transformed,{datasetVersion:DATASET_VERSION});
  const eda=buildEda(etl.transformed,{scored:result.scored,metrics:result.metrics});
  const artifacts={'dataset.csv':toCsv(raw,RAW_COLUMNS),'processed.csv':toCsv(etl.transformed,ANALYTIC_COLUMNS),'model.json':JSON.stringify(result.artifact),'scored.json':JSON.stringify(result.scored),'metrics.json':JSON.stringify(result.metrics,null,2),'eda.json':JSON.stringify(eda,null,2),'manifest.json':JSON.stringify({schema_version:'2.0.0',dataset_version:DATASET_VERSION,seed:SCENARIO_SEED,computed_at:computedAt,rows:raw.length,periods:result.split.ranges},null,2)};
  for(const [name,value] of Object.entries(artifacts))await writeFile(out+'/'+name,value+'\n');
  const saved=JSON.parse(await readFile(out+'/model.json','utf8')),restored=loadDetectorArtifact(saved);
  if(JSON.stringify(restored.score(etl.transformed.at(-1)))!==JSON.stringify(result.scored.at(-1)))throw new Error('MODEL_ROUNDTRIP_FAILED');
  console.log(JSON.stringify({rows:raw.length,quality:etl.report.accepted_count,periods:result.split.ranges,decision:result.artifact.models.map(m=>({group:m.group,detector:m.decision_detector})),testMetrics:result.metrics.filter(m=>m.group==='total')},null,2));
  return {raw,etl,result,eda,computedAt,out};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/train-final.mjs'))await trainFinal();
