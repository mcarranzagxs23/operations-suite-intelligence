import {useEffect,useRef,useState} from 'react';
import {reasonSignals} from '../intelligence/presentation.js';

/* Shared building blocks of the Intelligence views: formatting, status
   badges and motion. Every status is carried by a word and a symbol as well
   as a colour, so nothing depends on colour alone. */

export const number=(v,language,digits=2)=>v==null||!Number.isFinite(v)?'—':new Intl.NumberFormat(language,{maximumFractionDigits:digits}).format(v);
export const percent=(v,language)=>v==null||!Number.isFinite(v)?'—':number(v*100,language)+'%';
export const seconds=(v,language)=>v==null||!Number.isFinite(v)?'—':number(v,language)+' s';
export const signed=(v,format)=>v==null||!Number.isFinite(v)?'—':(v>0?'+':v<0?'−':'±')+format(Math.abs(v));
export const utc=iso=>iso.slice(0,10)+' '+iso.slice(11,19);
export const day=iso=>iso?iso.slice(0,10):'—';
export const prefersReducedMotion=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const HEALTH_ICON={healthy:'✓',monitor:'◐',high_risk:'▲',critical:'✕',insufficient_data:'?'};
const SEVERITY_ICON={none:'—',low:'•',medium:'◆',high:'▲',critical:'✕'};
const CHANGE_ICON={worse:'▲',better:'✓',same:'='};

export function HealthBadge({entity,t}) {
  return <span className={'int-health int-'+entity.health_status}><span aria-hidden="true">{HEALTH_ICON[entity.health_status]}</span> {t('intState_'+entity.health_status)}</span>;
}
export function SeverityBadge({severity,t}) {
  return <span className={'int-sev int-sev-'+severity}><span aria-hidden="true">{SEVERITY_ICON[severity]}</span> {t('intSeverity_'+severity)}</span>;
}
export function ChangeTag({change,t}) {
  return change?<span className={'int-change is-'+change}><span aria-hidden="true">{CHANGE_ICON[change]}</span> {t('intChange_'+change)}</span>:'—';
}
/** One line per identifier; the full value stays in the title and in the accessible text. */
export function Id({value}) {
  return value==null?'—':<span className="int-id" title={value}>{value}</span>;
}
export function Timestamp({value}) {
  return value?<time dateTime={value} title={value}>{utc(value)}</time>:'—';
}
/** Reason codes as short signals, each with its direction against the reference in words and an arrow. */
export function Signals({entity,t}) {
  return <span className="int-signals">{reasonSignals(entity.reasons).map(s=><span key={s.code} className="int-signal" data-direction={s.direction||undefined}>
    {t('intSignal_'+s.code)}
    {s.direction&&<><span aria-hidden="true">{s.direction==='up'?'↑':s.direction==='down'?'↓':'='}</span><span className="int-sr"> {t('intDirection_'+s.direction)}</span></>}
  </span>)}</span>;
}
export function Reasons({entity,t,language}) {
  return <ul className="int-reasons">{entity.reasons.map((r,i)=><li key={i}>{t('intReason_'+r.code,{...r,observed:r.code.endsWith('_RATE')?percent(r.observed,language):number(r.observed,language),reference:r.code.endsWith('_RATE')?percent(r.reference,language):number(r.reference,language),p95:number(r.p95,language)})}</li>)}</ul>;
}

/**
 * A number that counts from its previous value to the new one when a filter
 * changes. Short (420 ms), eased, never on first render, and skipped entirely
 * for a reader who asked for reduced motion. The final frame is always the
 * exact value, so what remains on screen is the projected figure itself.
 */
export function useAnimatedNumber(value,{duration=420,integer=false}={}) {
  const [shown,setShown]=useState(value),current=useRef(value);
  useEffect(()=>{
    const from=current.current;
    if(!Number.isFinite(from)||!Number.isFinite(value)||from===value||prefersReducedMotion()) {current.current=value;setShown(value);return undefined;}
    let frame=0,start=null;
    const step=()=>{
      // The clock starts when the first frame actually runs, so work that holds
      // the main thread right after a filter change cannot swallow the count.
      // Not the frame's own timestamp: that can date from before such work.
      const now=performance.now();
      start??=now;
      const k=Math.min(1,(now-start)/duration),next=k>=1?value:from+(value-from)*(1-(1-k)**3);
      current.current=next;
      setShown(integer&&k<1?Math.round(next):next);
      if(k<1)frame=requestAnimationFrame(step);
    };
    frame=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(frame);
  },[value,duration,integer]);
  return shown;
}

/** True for a short moment after `value` changes, never on first render; drives a highlight. */
export function useChangePulse(value,duration=900) {
  const [on,setOn]=useState(false),first=useRef(true);
  useEffect(()=>{
    if(first.current){first.current=false;return undefined;}
    setOn(true);
    const timer=setTimeout(()=>setOn(false),duration);
    return ()=>clearTimeout(timer);
  },[value,duration]);
  return on;
}
