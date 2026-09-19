import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Layout guarantees for the projector: measured in a real browser by
// scripts/verify-intelligence-defense.mjs, and pinned here so a later style
// change cannot quietly bring the defects back.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const shellStyles = read('../src/styles.css');
const styles = read('../src/views/intelligence.css');
const dashboard = read('../src/views/IntelligenceCenter.jsx');
const insights = read('../src/views/IntelligenceInsights.jsx');
const parts = read('../src/views/IntelligenceParts.jsx');
const view = `${dashboard}\n${insights}\n${parts}`;
const app = read('../src/App.jsx');

/** The body of the first `selector { … }` rule, optionally inside a given @media block. */
function ruleBody(source, selector, media) {
  let scope = source;
  if (media) {
    const start = source.indexOf(`${media} {`);
    assert.notEqual(start, -1, `missing ${media}`);
    let depth = 0, end = start;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    scope = source.slice(start, end);
  }
  const at = scope.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `missing rule ${selector}`);
  return scope.slice(at, scope.indexOf('}', at));
}

test('the fixed sidebar scrolls on its own when the viewport is shorter than its content', () => {
  const wide = ruleBody(shellStyles, '.sidebar', '@media (min-width: 821px)');
  assert.match(wide, /overflow-y: auto;/);
  assert.match(wide, /overscroll-behavior: contain;/);
  assert.match(ruleBody(shellStyles, '.sidebar > *', '@media (min-width: 821px)'), /flex-shrink: 0;/);
  // The rail is sized by the viewport, never by a subtracted magic height.
  assert.doesNotMatch(shellStyles, /\.sidebar[^{]*\{[^}]*height:\s*calc\(100/);
  // Short screens tighten the rail instead of hiding destinations.
  assert.match(ruleBody(shellStyles, '.nav-item', '@media (min-width: 821px) and (max-height: 880px)'), /padding-top: 8px;/);
  // The compact horizontal bar keeps its own overflow rule.
  assert.match(shellStyles, /\.sidebar \{ overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain;/);
});

test('identifiers stay on one line and are never broken per character', () => {
  assert.doesNotMatch(styles, /break-all|overflow-wrap:\s*anywhere|word-break/);
  const id = ruleBody(styles, '.int-id');
  assert.match(id, /white-space: nowrap;/);
  assert.match(id, /text-overflow: ellipsis;/);
  assert.match(ruleBody(styles, '.intelligence-center .int-link'), /white-space: nowrap;/);
  // A truncated identifier keeps its full value available.
  assert.match(view, /className="int-id" title=\{value\}/);
});

test('wide tables scroll inside their own frame instead of crushing their columns', () => {
  const frame = ruleBody(styles, '.int-table-wrap');
  assert.match(frame, /overflow: auto;/);
  // Contains absolutely positioned screen-reader text, which otherwise widened the page.
  assert.match(frame, /position: relative;/);
  assert.match(ruleBody(styles, '.int-table-wrap > table'), /width: max-content; min-width: 100%;/);
  assert.match(ruleBody(styles, '.int-table-wrap td'), /white-space: nowrap;/);
  assert.match(ruleBody(styles, '.intelligence-center td.int-num, .intelligence-center th.int-num'), /font-variant-numeric: tabular-nums;/);
  // The frame is reachable by keyboard so a wide table can be scrolled without a mouse.
  assert.match(view, /className="int-table-wrap" tabIndex=\{0\} role="region" aria-label=\{title\}/);
});

test('table headers stay visible while the table frame scrolls', () => {
  const header = ruleBody(styles, '.int-table-wrap thead th');
  assert.match(header, /position: sticky; top: 0;/);
  assert.match(header, /background:/);
});

test('explanation paragraphs live in the detail views, not inside table rows', () => {
  // A reasons list rendered in a column is what produced rows hundreds of pixels tall.
  assert.doesNotMatch(view, /col\([^\n]*<Reasons/);
  assert.match(view, /<Signals entity=\{r\} t=\{t\}\/>/);
  // The priority queue keeps its explanation behind a Details button that opens the explorer.
  assert.match(dashboard, /id="int-priority"[\s\S]*?col\('intWhy',r=>r\.recommended_action,r=><button type="button" onClick=\{\(\)=>setExplorer\(r\)\}/);
});

test('chart data tables fit their panel instead of inheriting the shell 760px minimum', () => {
  assert.match(shellStyles, /table\{width:100%;border-collapse:collapse;min-width:760px\}/);
  assert.match(ruleBody(styles, '.intelligence-center table'), /min-width: 0;/);
  assert.match(ruleBody(styles, '.intelligence-center .int-table-wrap > table'), /width: max-content; min-width: 100%;/);
});

test('defense mode keeps the data origin on screen and states the local service honestly', () => {
  // The shell only changes while Intelligence is the current view, and resets when leaving it.
  assert.match(app, /const defenseActive = defenseMode && view === 'intelligence';/);
  assert.match(app, /if \(view !== 'intelligence'\) setDefenseMode\(false\);/);
  assert.match(app, /className=\{defenseActive \? 'app-shell defense-mode' : 'app-shell'\}/);
  // The dock always carries the academic/controlled badge and is portalled so it stays fixed to the screen.
  assert.match(dashboard, /createPortal\(<nav className="int-dock"/);
  assert.match(dashboard, /t\(mode==='ACADEMIC_SYNTHETIC'\?'intAcademic':'intControlled'\)\}<\/span>\s*<ol className="int-dock-steps">/);
  assert.match(dashboard, /t\('intService_'\+intelligenceServiceMode\)/);
  assert.match(dashboard, /t\('intBridgeNotRequired'\)/);
  // The bridge status stays visible; only its connect action steps aside.
  assert.match(styles, /\.app-shell\.defense-mode \.topbar \.sync-button \{ display: none; \}/);
  assert.doesNotMatch(styles, /defense-mode[^{]*\.status[^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /defense-mode[^{]*sample-banner[^{]*\{[^}]*display:\s*none/);
});

test('every guided step scrolls to a section that exists', () => {
  const targets = [...dashboard.matchAll(/\{id:'(\w+)',target:'([\w-]+)'\}/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(targets.map(([id]) => id), ['overview', 'health', 'anomaly', 'priority', 'models', 'conclusion']);
  for (const [, target] of targets) assert.match(dashboard, new RegExp(`id="${target}"`), target);
  assert.match(dashboard, /aria-current=\{active===s\.id\?'step':undefined\}/);
});

test('detail dialogs are modal, close on Escape, trap Tab and return focus to their trigger', () => {
  assert.match(insights, /node\.showModal\(\);/);
  assert.match(insights, /onCancel=\{e=>\{e\.preventDefault\(\);onClose\(\);\}\}/);
  assert.match(insights, /if\(event\.key!=='Tab'\)return;/);
  assert.match(insights, /origin\.focus\(\{preventScroll:true\}\)/);
  assert.match(insights, /aria-labelledby=\{titleId\}/);
  // The close button lives in the pinned header, so it stays visible however far the body scrolls.
  assert.match(ruleBody(styles, '.int-dialog-head'), /position: sticky; top: 0;/);
  assert.match(insights, /aria-pressed=\{spotlight\}/);
});

test('motion is short and yields to a reduced-motion preference', () => {
  assert.match(parts, /export function useAnimatedNumber\(value,\{duration=420/);
  assert.match(parts, /\|\|prefersReducedMotion\(\)\) \{current\.current=value;setShown\(value\);/);
  assert.match(dashboard, /behavior:prefersReducedMotion\(\)\?'auto':'smooth'/);
  // The shell's blanket rule neutralises every CSS transition and animation declared here.
  assert.match(shellStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:\.01ms !important/);
  // The count-up clock is read when a frame runs, not from the frame's timestamp,
  // which can predate the filter change's own work and skip the count entirely.
  assert.match(parts, /const step=\(\)=>\{[\s\S]*?const now=performance\.now\(\);\s*start\?\?=now;/);
});

test('a filter change renders once, and its impact summary never resizes on a timer', () => {
  // The "before" is taken in the change handler itself, not in an effect that re-renders every table.
  assert.match(dashboard, /const changeFilters=next=>\{closeDetails\(\);setImpactBase\(summary\);setImpactOpen\(true\);setFilters\(next\);\};/);
  assert.doesNotMatch(dashboard, /setImpact\(/);
  // Shrinking by itself would move the page under the presenter, even mid-scroll to a section.
  assert.doesNotMatch(dashboard, /setTimeout\([\s\S]{0,40}setImpactOpen/);
});

test('a trend point read before a period change is revalidated, and a render fault stays inside Intelligence', () => {
  // 90 days have 13 weekly points and 7 days have one: a stale index used to crash the whole console.
  assert.ok(dashboard.includes('const active=indexes.includes(hovered)?hovered:null;'));
  assert.ok(dashboard.includes('static getDerivedStateFromError(error){return {error};}'));
  assert.ok(dashboard.includes('<IntelligenceBoundary t={t}><IntelligenceDashboard '));
});

test('the detector lens is labelled comparison-only and is not wired to any filter', () => {
  assert.match(insights, /t\('intComparisonOnly'\)/);
  assert.match(insights, /<input type="radio" name=\{idPrefix\+'-focus'\}/);
  assert.match(dashboard, /onFocus=\{setFocus\}/);
  assert.doesNotMatch(dashboard, /setFocus\([^)]*\)[^;]*setFilters|setFilters\([^)]*focus/);
});
