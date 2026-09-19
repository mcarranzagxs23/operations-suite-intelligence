import {describe,countBy} from './statistics.mjs';
const series=(rows,field)=>Object.entries(countBy(rows,r=>r[field])).map(([label,value])=>({label,value}));
export function buildEda(rows,{scored=[],metrics=[]}={}) {
  const tools=[...new Set(rows.map(r=>r.tool_id))].sort();
  const charts=[
    {id:'status',kind:'bar',title:'status',points:series(rows,'status')},
    {id:'tools',kind:'bar',title:'tools',points:series(rows,'tool_id')}
  ];
  const toolSummaries=tools.map(tool=>{
    const subset=rows.filter(r=>r.tool_id===tool),values=subset.map(r=>r.duration_seconds),summary=describe(values),bins=12,width=(summary.max-summary.min)/bins||1;
    const histogram=Array.from({length:bins},(_,i)=>({label:(summary.min+i*width).toFixed(1),value:0}));
    for(const value of values)histogram[Math.min(bins-1,Math.floor((value-summary.min)/width))].value++;
    charts.push({id:'histogram-'+tool,kind:'bar',title:'histogram',group:tool,points:histogram});
    charts.push({id:'boxplot-'+tool,kind:'boxplot',title:'boxplot',group:tool,summary});
    return {tool,...summary};
  });
  charts.push({id:'median-p95',kind:'bar',title:'medianP95',points:toolSummaries.flatMap(s=>[{label:s.tool+' median',value:s.median},{label:s.tool+' P95',value:s.p95}])});
  const days=[...new Set(rows.map(r=>r.completed_at.slice(0,10)))].sort();
  charts.push({id:'executions',kind:'line',title:'executions',points:days.map(day=>({label:day,value:rows.filter(r=>r.completed_at.startsWith(day)).length}))});
  charts.push({id:'outcomes',kind:'multiline',title:'outcomes',series:['success','failure','cancelled'].map(status=>({name:status,points:days.map(day=>({label:day,value:rows.filter(r=>r.completed_at.startsWith(day)&&r.status===status).length}))}))});
  const labelled=rows.filter(r=>typeof r.expected_anomaly==='boolean');
  charts.push({id:'normal-anomaly',kind:'bar',title:'normalAnomaly',points:[false,true].map(label=>({label:String(label),value:describe(labelled.filter(r=>r.expected_anomaly===label).map(r=>r.duration_seconds)).median??0}))});
  if(scored.length) {
    const sdays=[...new Set(scored.map(r=>r.completed_at.slice(0,10)))].sort();
    charts.push({id:'anomalies',kind:'line',title:'anomalies',points:sdays.map(day=>({label:day,value:scored.filter(r=>r.completed_at.startsWith(day)&&r.is_anomaly).length}))});
    for(const field of ['tool_id','workspace_id']) {
      const key=r=>field==='workspace_id'?r.account_id+'/'+r.workspace_id:r.tool_id;
      charts.push({id:'anomaly-rate-'+field,kind:'bar',title:'anomalyRate',points:[...new Set(scored.map(key))].sort().map(label=>{const group=scored.filter(r=>key(r)===label);return {label,value:100*group.filter(r=>r.is_anomaly).length/group.length};})});
    }
  }
  if(metrics.length) {
    charts.push({id:'detector-comparison',kind:'bar',title:'detectorComparison',points:metrics.filter(m=>m.group==='total').map(m=>({label:m.detector,value:m.f1}))});
    for(const m of metrics) {
      charts.push({id:'confusion-'+m.detector+'-'+m.group,kind:'confusion',title:'confusion',group:m.detector+' / '+m.group,values:[m.TN,m.FP,m.FN,m.TP],evaluation_status:m.status});
      charts.push({id:'metrics-'+m.detector+'-'+m.group,kind:'bar',title:'metrics',group:m.detector+' / '+m.group,points:['precision','recall','f1'].map(k=>({label:k,value:m[k]}))});
    }
  }
  return {rows:rows.length,origins:countBy(rows,r=>r.data_origin),statuses:countBy(rows,r=>r.status),tools:toolSummaries,charts};
}
