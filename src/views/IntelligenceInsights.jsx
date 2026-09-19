import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {DETECTOR_IDS,detectorAgreement,explainAnomaly,explainHealth,modelComparison,priorityContext,selectPriorityWorkspace} from '../intelligence/presentation.js';
import {ChangeTag,HealthBadge,Reasons,SeverityBadge,Timestamp,day,number,percent,seconds,signed} from './IntelligenceParts.jsx';

const FOCUSABLE='button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/**
 * The one dialog every Intelligence detail uses.
 *
 * A native modal, so the page behind it is inert; Tab wraps inside it, Escape
 * and the backdrop close it, and focus returns to whatever opened it. The
 * header — title, data origin and the close button — stays pinned while the
 * body scrolls, so closing is always one visible click away. Spotlight turns
 * it into a large centred panel on a darker backdrop for a projector.
 */
export function InsightDialog({eyebrow,title,subtitle,mode,variant='modal',t,onClose,children}) {
  const dialog=useRef(null),close=useRef(null),titleId=useId();
  const [spotlight,setSpotlight]=useState(false);
  useEffect(()=>{
    const node=dialog.current,origin=document.activeElement;
    node.showModal();
    close.current?.focus();
    return ()=>{
      if(node.open)node.close();
      if(origin instanceof HTMLElement&&origin.isConnected)origin.focus({preventScroll:true});
    };
  },[]);
  const trap=event=>{
    if(event.key!=='Tab')return;
    const items=[...dialog.current.querySelectorAll(FOCUSABLE)].filter(el=>el.getClientRects().length);
    if(!items.length)return;
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  return <dialog ref={dialog} className={'int-dialog int-dialog--'+variant+(spotlight?' is-spotlight':'')} aria-labelledby={titleId}
    onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={trap} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <header className="int-dialog-head">
      <div className="int-dialog-titles">
        <div className="int-dialog-eyebrow">{eyebrow}</div>
        <h2 id={titleId}>{title}</h2>
        {subtitle&&<p className="int-dialog-subtitle">{subtitle}</p>}
      </div>
      <div className="int-dialog-tools">
        <span className="int-chip int-chip--origin">{t(mode==='ACADEMIC_SYNTHETIC'?'intDialogSynthetic':'intDialogControlled')}</span>
        <button type="button" ref={close} className="int-dialog-close" onClick={onClose}>{t('intClose')}</button>
        <button type="button" className="int-spotlight-toggle" aria-pressed={spotlight} onClick={()=>setSpotlight(v=>!v)}><span aria-hidden="true">◎</span> {t(spotlight?'intSpotlightOff':'intSpotlight')}</button>
      </div>
    </header>
    <div className="int-dialog-body">{children}</div>
  </dialog>;
}

/** A 0–100 track split at the published thresholds, with the score marked on it. */
function ThresholdMeter({score,thresholds,t,language}) {
  const bands=[['critical',0,thresholds.high_risk],['high_risk',thresholds.high_risk,thresholds.monitor],['monitor',thresholds.monitor,thresholds.healthy],['healthy',thresholds.healthy,100]];
  const label=t('intMeterLabel',{score:number(score,language),healthy:number(thresholds.healthy,language),monitor:number(thresholds.monitor,language),risk:number(thresholds.high_risk,language)});
  return <div className="int-meter" role="img" aria-label={label}>
    <div className="int-meter-track">
      {bands.map(([status,from,to])=><span key={status} className={'int-meter-band int-band-'+status} style={{left:from+'%',width:(to-from)+'%'}}/>)}
      {score!=null&&<span className="int-meter-marker" style={{left:Math.max(0,Math.min(100,score))+'%'}}/>}
    </div>
    <div className="int-meter-scale" aria-hidden="true">{[0,thresholds.high_risk,thresholds.monitor,thresholds.healthy,100].map(v=><span key={v} style={{left:v+'%'}}>{v}</span>)}</div>
  </div>;
}

/**
 * Health Explorer: why an entity has the score it has. The components and
 * weights come from the result contract, the comparison from the reference
 * rows the score was computed against — the status is never asserted, it is
 * shown as the consequence of those numbers.
 */
export function HealthExplorer({entity,view,policy,mode,t,language,onClose,onOpenEntity,onFilterEntity}) {
  const x=useMemo(()=>explainHealth(entity,policy,view.referenceObservations),[entity,policy,view.referenceObservations]);
  const context=priorityContext(entity,view);
  // Moving to another entity inside the open dialog: the button that did it is gone, so focus goes to the top of the new content.
  const heading=useRef(null),shownKey=useRef(entity.key);
  useEffect(()=>{if(shownKey.current!==entity.key){shownKey.current=entity.key;heading.current?.focus();}},[entity.key]);
  const next=entity.entity_type==='global'?selectPriorityWorkspace(view.priorityQueue):null;
  const n=v=>number(v,language),pct=v=>percent(v,language);
  const value=(kind,v)=>kind==='rate'?pct(v):seconds(v,language);
  const delta=(kind,v)=>signed(v,a=>kind==='rate'?number(a*100,language)+' pp':number(a,language)+' s');
  const title=entity.entity_type==='global'?t('intGlobal'):entity.entity_id;
  return <InsightDialog eyebrow={t('intHealthExplorer')+' · '+t('intType_'+entity.entity_type)} title={title}
    subtitle={entity.entity_type!=='global'&&entity.entity_type!=='account'?entity.account_id:null} mode={mode} variant="drawer" t={t} onClose={onClose}>
    <div className="int-explorer">
      <section className="int-explorer-hero" aria-labelledby="int-q-severity">
        <h3 id="int-q-severity" ref={heading} tabIndex={-1}>{t('intQ_severity')}</h3>
        <div className="int-hero-score"><strong data-explorer-score>{n(x.score)}</strong><HealthBadge entity={entity} t={t}/></div>
        <ThresholdMeter score={x.score} thresholds={x.thresholds} t={t} language={language}/>
        <dl className="int-facts">
          <div><dt>{t('intSample')}</dt><dd>{n(x.sampleSize)}</dd></div>
          <div><dt>{t('intReferenceSample')}</dt><dd>{n(x.referenceSize)}</dd></div>
          <div><dt>{t('intCurrentPeriodLabel')}</dt><dd>{day(entity.period_start)} → {day(entity.period_end)}</dd></div>
          <div><dt>{t('intReferencePeriodLabel')}</dt><dd>{day(entity.reference_start)} → {day(entity.reference_end)}</dd></div>
          {context&&<div className="int-facts-wide"><dt>{t('intRank')}</dt><dd>{t('intRankContext',{rank:context.rank??'—',size:context.queueSize,typeRank:context.typeRank??'—',typeSize:context.typeSize,type:t('intTypePlural_'+entity.entity_type)})}</dd></div>}
        </dl>
        {entity.health_status==='insufficient_data'&&<p className="int-note" role="note">{t('intInsufficient')}</p>}
      </section>
      <section className="int-explorer-components" aria-labelledby="int-components-title">
        <h3 id="int-components-title">{t('intComponents')}</h3>
        <ul className="int-components">{x.components.map(c=><li key={c.id} data-component={c.id}>
          <div className="int-component-head"><strong>{t('intComponent_'+c.id)}</strong><span className="int-component-value">{n(c.value)}</span></div>
          <div className="int-bar" role="meter" aria-label={t('intComponent_'+c.id)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.value??undefined} aria-valuetext={n(c.value)}><span style={{width:(c.value==null?0:Math.max(0,Math.min(100,c.value)))+'%'}}/></div>
          <p className="int-component-meta">{t('intWeight')} {pct(c.weight)} · {t('intContribution')} {n(c.contribution)}</p>
          <p className="int-component-desc">{t('intComponentDesc_'+c.id)}</p>
        </li>)}</ul>
        <div className="int-how">
          <h4>{t('intHowComputed')}</h4>
          <p>{t('intFormula')}</p>
          {x.sum!=null&&<p className="int-formula" data-formula>{x.components.map((c,i)=><span key={c.id}>{i>0&&' + '}{pct(c.weight)} × {n(c.value)}</span>)} = <strong>{n(x.sum)}</strong></p>}
          <ul className="int-thresholds">
            {['healthy','monitor','high_risk'].map(s=><li key={s} className={'int-health int-'+s}>{t('intThreshold_'+s,{value:n(x.thresholds[s])})}</li>)}
            <li className="int-health int-critical">{t('intThreshold_critical',{value:n(x.thresholds.high_risk)})}</li>
          </ul>
          <p className="int-note">{t('intMinimumRuns',{minimum:x.minimumRuns})} {t('intPolicyVersion',{version:x.version})}</p>
          <p className="int-note">{t('intNotManual')}</p>
        </div>
      </section>
      <section className="int-explorer-changed" aria-labelledby="int-q-changed">
        <h3 id="int-q-changed">{t('intQ_changed')}</h3>
        <div className="int-scroll-x"><table className="int-compare">
          <caption className="int-sr">{t('intCurrentVsReference')}</caption>
          <thead><tr><th scope="col">{t('intMetric')}</th><th scope="col" className="int-num">{t('intCurrent')}</th><th scope="col" className="int-num">{t('intReferenceCol')}</th><th scope="col" className="int-num">{t('intDelta')}</th><th scope="col">{t('intAssessment')}</th></tr></thead>
          <tbody>{x.comparison.map(c=><tr key={c.id} data-compare={c.id}><th scope="row">{t('intCompare_'+c.id)}</th><td className="int-num">{value(c.kind,c.current)}</td><td className="int-num">{value(c.kind,c.reference)}</td><td className="int-num">{delta(c.kind,c.delta)}</td><td><ChangeTag change={c.change} t={t}/></td></tr>)}</tbody>
        </table></div>
      </section>
      <section className="int-explorer-wrong" aria-labelledby="int-q-what">
        <h3 id="int-q-what">{t('intQ_what')}</h3>
        <Reasons entity={entity} t={t} language={language}/>
      </section>
      <section className="int-explorer-review" aria-labelledby="int-q-review">
        <h3 id="int-q-review">{t('intQ_review')}</h3>
        <p className="int-action">{t('intAction_'+entity.recommended_action)}</p>
        <p className="int-note">{t('intNoCausality')}</p>
        <div className="int-dialog-actions">
          {next&&<button type="button" className="int-primary" onClick={()=>onOpenEntity(next)}>{t('intPriorityWorkspace')} <span aria-hidden="true">→</span></button>}
          {entity.entity_type!=='global'&&<button type="button" onClick={()=>onFilterEntity(entity)}>{t('intFilterByEntity')}</button>}
        </div>
      </section>
    </div>
  </InsightDialog>;
}

/** A linear duration track: IQR interval, reference median, reference P95 and the observed run. */
function DurationTrack({x,t,language}) {
  const s=v=>seconds(v,language),rows=Math.max(1,...x.scale.markers.map(m=>m.row+1));
  const median=x.scale.markers.find(m=>m.id==='median'),observed=x.scale.markers.find(m=>m.id==='observed');
  const align=at=>at<14?'start':at>86?'end':'center';
  const label=t('intScaleLabel',{median:s(x.median),p95:s(x.p95),observed:s(x.observed),lower:s(x.iqr.lower),upper:s(x.iqr.upper)});
  return <figure className="int-track" role="img" aria-label={label}>
    <div className="int-track-rail" aria-hidden="true">
      {x.scale.band&&<span className="int-track-band" style={{left:x.scale.band.from+'%',width:Math.max(.6,x.scale.band.to-x.scale.band.from)+'%'}}/>}
      {median&&observed&&<span className="int-track-span" style={{left:Math.min(median.at,observed.at)+'%',width:Math.abs(observed.at-median.at)+'%'}}/>}
      {x.scale.markers.map(m=><span key={m.id} className={'int-track-marker is-'+m.id} style={{left:m.at+'%'}}/>)}
    </div>
    <div className="int-track-labels" aria-hidden="true" style={{height:rows*1.7+'em'}}>
      {x.scale.markers.map(m=><span key={m.id} className={'int-track-label is-'+m.id+' is-'+align(m.at)} style={{left:m.at+'%',top:m.row*1.7+'em'}}>{t('intMarker_'+m.id)} {s(m.value)}</span>)}
    </div>
    <figcaption aria-hidden="true"><span className="int-legend-band"/> {t('intIqrBand')} {s(x.iqr.lower)} – {s(x.iqr.upper)} · 0 – {s(x.scale.max)}</figcaption>
  </figure>;
}

/**
 * Why flagged: the observed duration against its reference, and what each
 * detector said about it. Scores, thresholds and the decision detector are
 * read from the scored row and the model selection metadata.
 */
export function WhyFlagged({row,metadata,mode,t,language,onClose}) {
  const x=useMemo(()=>explainAnomaly(row,metadata),[row,metadata]);
  const n=v=>number(v,language),s=v=>seconds(v,language);
  const change=v=>signed(v*100,a=>number(a,language)+'%');
  return <InsightDialog eyebrow={t('intWhy')} title={row.execution_id} subtitle={row.account_id+' / '+row.workspace_id+' / '+row.device_id} mode={mode} t={t} onClose={onClose}>
    <div className="int-why">
      <p className="int-why-context">
        <span>{row.tool_id} · {row.action} · v{row.tool_version}</span>
        <span><Timestamp value={row.completed_at}/> UTC</span>
        <span>{t('intStatus')}: {t('intOutcome_'+row.status)}</span>
        <SeverityBadge severity={row.severity} t={t}/>
      </p>
      <section className="int-why-stats" aria-label={t('intComparisonReference')}>
        <div className="int-stat is-observed"><span>{t('intObservedShort')}</span><strong data-why="observed">{s(x.observed)}</strong></div>
        <div className="int-stat"><span>{t('intMedianShort')}</span><strong data-why="median">{s(x.median)}</strong></div>
        <div className="int-stat"><span>{t('intP95Short')}</span><strong data-why="p95">{s(x.p95)}</strong></div>
        <div className="int-stat is-deviation"><span>{t('intRatioShort')}</span><strong data-why="ratio">{n(x.ratio)}×</strong><small>{change(x.medianChange)}</small></div>
      </section>
      <p className="int-sentence">{t(x.direction==='slower'?'intSentenceSlow':'intSentenceFast',{ratio:n(x.ratio),percent:number(Math.abs(x.medianChange)*100,language)+'%'})}</p>
      <DurationTrack x={x} t={t} language={language}/>
      <section aria-labelledby="int-why-compare">
        <h3 id="int-why-compare">{t('intComparisonReference')}</h3>
        <div className="int-scroll-x"><table className="int-compare">
          <thead><tr><th scope="col">{t('intReferenceCol')}</th><th scope="col" className="int-num">{t('intChartValue')}</th><th scope="col" className="int-num">{t('intRatioCol')}</th><th scope="col" className="int-num">{t('intDifferenceCol')}</th></tr></thead>
          <tbody>
            <tr><th scope="row">{t('intMedianShort')}</th><td className="int-num">{s(x.median)}</td><td className="int-num">{n(x.ratio)}×</td><td className="int-num">{signed(x.medianDifference,a=>number(a,language)+' s')} ({change(x.medianChange)})</td></tr>
            <tr><th scope="row">{t('intP95Short')}</th><td className="int-num">{s(x.p95)}</td><td className="int-num">{n(x.p95Ratio)}×</td><td className="int-num">{signed(x.p95Difference,a=>number(a,language)+' s')} ({change(x.p95Change)})</td></tr>
          </tbody>
        </table></div>
      </section>
      <section aria-labelledby="int-why-detectors">
        <h3 id="int-why-detectors">{t('intDetectedBy')}</h3>
        <ul className="int-detector-cards">{x.detectors.map(d=>{
          const scale=Math.max(d.score,d.threshold*2)||1;
          return <li key={d.id} className={'int-detector-card'+(d.prediction?' is-flagged':'')+(d.decision?' is-decision':'')} data-detector={d.id}>
            <div className="int-detector-head"><strong>{d.id}</strong>{d.decision&&<span className="int-chip">{t('intDecisionBadge')}</span>}</div>
            <p className="int-detector-family">{t('intFamily_'+d.id)}</p>
            <p className="int-detector-verdict"><span aria-hidden="true">{d.prediction?'✓':'○'}</span> {t(d.prediction?'intFlagged':'intNotFlagged')}</p>
            <div className="int-scorebar" role="img" aria-label={t('intScoreVsThreshold',{score:n(d.score),threshold:n(d.threshold)})}>
              <span className="int-scorebar-fill" style={{width:Math.min(100,d.score/scale*100)+'%'}}/>
              <span className="int-scorebar-threshold" style={{left:Math.min(100,d.threshold/scale*100)+'%'}}/>
            </div>
            <dl><div><dt>{t('intScore')}</dt><dd>{n(d.score)}</dd></div><div><dt>{t('intThreshold')}</dt><dd>{n(d.threshold)}</dd></div><div><dt>{t('intSeverity')}</dt><dd>{t('intSeverity_'+d.severity)}</dd></div></dl>
          </li>;
        })}</ul>
        <p>{t('intCalibratedDecision',{detector:x.calibratedDetector??'—',group:x.group})}</p>
        {x.projectionDetector&&<p className="int-note int-note--warn">{t('intComparisonProjection',{detector:x.projectionDetector})}</p>}
        <p>{t('intIqrRange')}: {n(x.iqr.lower)} – {n(x.iqr.upper)}</p>
      </section>
      <section aria-labelledby="int-why-review">
        <h3 id="int-why-review">{t('intQ_review')}</h3>
        <p className="int-action">{t('intAction_'+row.recommended_action)}</p>
        <p className="int-note">{t('intNoCausality')}</p>
      </section>
    </div>
  </InsightDialog>;
}

/** Precision, recall and F1 of each detector on the held-out test, as labelled bars. */
function MetricBars({detectors,focus,t,language}) {
  return <div className="int-metric-bars" role="group" aria-label={t('intMetricChart')}>
    {[['precision','intPrecision'],['recall','intRecall'],['f1','intF1']].map(([metric,label])=><div key={metric} className="int-metric-group">
      <span className="int-metric-name">{t(label)}</span>
      {detectors.map(d=>{const v=d.metrics?.[metric];return <div key={d.id} className={'int-metric-row is-'+d.id+(focus===d.id?' is-focus':'')}>
        <span className="int-metric-id">{d.id}</span>
        <span className="int-metric-track"><span style={{width:(v==null?0:v*100)+'%'}}/></span>
        <span className="int-metric-value">{number(v,language)}</span>
      </div>;})}
    </div>)}
  </div>;
}

/**
 * Model Comparison Lab. The decision detector and the metrics are read from
 * the result contract; the focus selector is a lens for comparison and never
 * changes the decision detector, the model or any Health Score.
 */
export function ModelLab({view,metadata,t,language,focus,onFocus,onSpotlight,idPrefix='int-lab',children}) {
  const x=useMemo(()=>modelComparison(view.modelMetrics,metadata),[view.modelMetrics,metadata]);
  const agreement=useMemo(()=>detectorAgreement(view.observations,focus,metadata),[view.observations,focus,metadata]);
  const n=v=>number(v,language),pct=v=>percent(v,language);
  const decision=x.decision.join(' / ')||'—',isDecision=x.decision.includes(focus);
  return <div className="int-lab">
    <div className="int-section-head">
      <div><div className="eyebrow">{t('intModels')}</div><h2 id={idPrefix+'-title'} tabIndex={-1}>{t('intModelLab')}</h2></div>
      {onSpotlight&&<button type="button" className="int-spotlight-toggle" onClick={onSpotlight}><span aria-hidden="true">◎</span> {t('intSpotlight')}</button>}
    </div>
    <div className="int-decision-banner">
      <div><span className="int-decision-label">{t('intDecisionUsed')}</span><strong data-decision-detector>{decision}</strong></div>
      <ul>
        <li><span aria-hidden="true">✓</span> {t(x.policies.includes('CALIBRATION_F1_WITH_FIXED_CANDIDATES')?'intSelectedByCalibration':'intSelectionFallback')}</li>
        <li><span aria-hidden="true">{x.usesTest?'!':'✓'}</span> {x.usesTest?t('intTestUsed'):t('intTestReserved',{start:day(x.evaluationPeriod?.start),end:day(x.evaluationPeriod?.end)})}</li>
      </ul>
    </div>
    <fieldset className="int-focus">
      <legend>{t('intFocusDetector')} <span className="int-chip int-chip--warn">{t('intComparisonOnly')}</span></legend>
      {DETECTOR_IDS.map(id=><label key={id} className={focus===id?'is-selected':''}><input type="radio" name={idPrefix+'-focus'} value={id} checked={focus===id} onChange={()=>onFocus(id)}/> {id}</label>)}
      <p className="int-note">{t('intComparisonOnlyNote')}</p>
    </fieldset>
    <ul className="int-model-cards">{x.detectors.map(d=><li key={d.id} className={'int-model-card is-'+d.id+(focus===d.id?' is-focus':'')+(d.decision?' is-decision':'')} data-model={d.id}>
      <div className="int-model-card-head"><strong>{t('intDetectorName_'+d.id)}</strong><span className="int-model-code">{d.id}</span>{d.decision&&<span className="int-chip">{t('intDecisionBadge')}</span>}{focus===d.id&&<span className="int-chip int-chip--focus">{t('intInFocus')}</span>}</div>
      <p className="int-detector-family">{t('intFamily_'+d.id)}</p>
      <p className="int-model-edu">{t('intEducation_'+d.id)}</p>
      <dl className="int-model-metrics">{[['precision','intPrecision'],['recall','intRecall'],['f1','intF1']].map(([k,label])=><div key={k}><dt>{t(label)}</dt><dd>{n(d.metrics?.[k])}</dd></div>)}</dl>
      <dl className="int-confusion" aria-label={t('intConfusion')}>{['TP','FP','TN','FN'].map(k=><div key={k}><dt title={t('int'+k)}>{k}</dt><dd>{n(d.metrics?.[k])}</dd></div>)}</dl>
    </li>)}</ul>
    <MetricBars detectors={x.detectors} focus={focus} t={t} language={language}/>
    <div className="int-agreement" aria-live="polite" data-agreement={focus}>
      <p><strong>{t('intWouldFlag',{detector:focus,count:n(agreement.flagged),total:n(agreement.total),percent:pct(agreement.total?agreement.flagged/agreement.total:null)})}</strong></p>
      <p>{isDecision?t('intIsDecision',{detector:focus}):t('intAgreement',{detector:focus,decision,both:n(agreement.both),focusOnly:n(agreement.focusOnly),decisionOnly:n(agreement.decisionOnly)})}</p>
    </div>
    <h3>{t('intCalibrationF1')}</h3>
    <div className="int-scroll-x"><table className="int-compare">
      <thead><tr><th scope="col">{t('intGroup')}</th>{DETECTOR_IDS.map(id=><th key={id} scope="col" className="int-num">{id}</th>)}<th scope="col">{t('intDecisionUsed')}</th></tr></thead>
      <tbody>{x.calibration.map(c=><tr key={c.group}><th scope="row">{c.group}</th>{DETECTOR_IDS.map(id=><td key={id} className={'int-num'+(id===c.decision?' is-best':'')}>{n(c.f1[id])}</td>)}<td>{c.decision}</td></tr>)}</tbody>
    </table></div>
    {children}
    <div className="int-lab-notes">
      <p>{t('intML')}: Isolation Forest. {t('intBaseline')}: MAD / IQR.</p>
      <p>{t('intBenchmarkNote')}</p>
      <p>{t('intMetricPeriod',metadata.evaluation_period)}</p>
      <p>{t('intNoProbability')}</p>
    </div>
  </div>;
}

/** The lab again, inside a dialog, for a projector. */
export function ModelLabSpotlight({mode,t,onClose,...props}) {
  return <InsightDialog eyebrow={t('intModels')} title={t('intModelLab')} mode={mode} t={t} onClose={onClose}>
    <ModelLab {...props} t={t} idPrefix="int-lab-dialog"/>
  </InsightDialog>;
}
