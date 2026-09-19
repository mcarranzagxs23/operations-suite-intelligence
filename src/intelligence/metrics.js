export function evaluateDetector(rows,detector,{k=10}={}) {
  const labelled=rows.filter(r=>typeof r.expected_anomaly==='boolean');
  const base={detector,evaluation_rows:rows.length,labelled_count:labelled.length,unknown_count:rows.length-labelled.length};
  if(!labelled.length)return {...base,status:'NOT EVALUABLE',TP:null,FP:null,TN:null,FN:null,precision:null,recall:null,f1:null,precision_at_k:null,k:0};
  let TP=0,FP=0,TN=0,FN=0;
  for(const row of labelled){const p=row.detectors[detector].prediction,a=row.expected_anomaly;if(p&&a)TP++;else if(p)FP++;else if(a)FN++;else TN++;}
  const effectiveK=Math.min(k,labelled.length);
  const top=[...labelled].sort((a,b)=>b.detectors[detector].score-a.detectors[detector].score||a.execution_id.localeCompare(b.execution_id)).slice(0,effectiveK);
  return {...base,status:'EVALUATED',TP,FP,TN,FN,precision:TP+FP?TP/(TP+FP):null,recall:TP+FN?TP/(TP+FN):null,f1:2*TP+FP+FN?2*TP/(2*TP+FP+FN):null,precision_at_k:effectiveK?top.filter(r=>r.expected_anomaly).length/effectiveK:null,k:effectiveK};
}
