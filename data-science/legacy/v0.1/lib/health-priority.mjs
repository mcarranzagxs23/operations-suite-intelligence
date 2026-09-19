import { clamp, describe, median, round, wilsonUpperBound } from './statistics.mjs';

const STATUS_RANK = Object.freeze({ critical: 0, high_risk: 1, monitor: 2, healthy: 3, insufficient_data: 4 });

function toolGroupKey(row) {
  return `${row.tool_id}__${row.action}`;
}

function healthStatus(score, enoughData) {
  if (!enoughData) return 'insufficient_data';
  if (score >= 90) return 'healthy';
  if (score >= 75) return 'monitor';
  if (score >= 60) return 'high_risk';
  return 'critical';
}

function baselineByTool(rows) {
  const baselines = new Map();
  for (const row of rows) {
    const key = toolGroupKey(row);
    if (!baselines.has(key)) baselines.set(key, []);
    baselines.get(key).push(Number(row.duration_seconds));
  }
  return new Map([...baselines.entries()].map(([key, values]) => [key, describe(values)]));
}

function processingHealth(rows, baselines) {
  const groups = new Map();
  for (const row of rows) {
    const key = toolGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Number(row.duration_seconds));
  }
  const weighted = [];
  for (const [key, values] of groups.entries()) {
    const baseline = baselines.get(key);
    const observedMedian = median(values);
    const scale = Math.max(0.001, baseline.p95 - baseline.median);
    const deviation = Math.max(0, (observedMedian - baseline.median) / scale);
    weighted.push({ score: 100 * (1 - clamp(deviation)), weight: values.length });
  }
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight === 0 ? null : weighted.reduce((sum, item) => sum + (item.score * item.weight), 0) / totalWeight;
}

function trendHealth(rows, baselines) {
  if (rows.length < 20) return null;
  const ordered = [...rows].sort((left, right) => left.completed_at.localeCompare(right.completed_at));
  const split = Math.floor(ordered.length / 2);
  const prior = ordered.slice(0, split);
  const recent = ordered.slice(split);
  const anomalyIncrease = Math.max(0,
    recent.filter((row) => row.is_anomaly === 'true').length / recent.length
      - prior.filter((row) => row.is_anomaly === 'true').length / prior.length);

  const durationIncrease = [...new Set(ordered.map(toolGroupKey))].map((key) => {
    const relevantRecent = recent.filter((row) => toolGroupKey(row) === key).map((row) => Number(row.duration_seconds));
    const relevantPrior = prior.filter((row) => toolGroupKey(row) === key).map((row) => Number(row.duration_seconds));
    if (relevantRecent.length === 0 || relevantPrior.length === 0) return 0;
    const baseline = baselines.get(key);
    const scale = Math.max(0.001, baseline.p95 - baseline.median);
    return Math.max(0, (median(relevantRecent) - median(relevantPrior)) / scale);
  });
  const deterioration = Math.max(anomalyIncrease, ...durationIncrease);
  return 100 * (1 - clamp(deterioration));
}

function buildReasons(summary, allRows, entityField) {
  const reasons = [];
  const { rows, components, counts } = summary;
  if (counts.anomalies > 0) reasons.push(`${counts.anomalies} anomalous executions in the selected period.`);
  if (counts.failures > 0 || counts.cancelled > 0) reasons.push(`${counts.failures} failures and ${counts.cancelled} cancellations were recorded.`);
  if (components.processingHealth !== null && components.processingHealth < 90) {
    reasons.push('Median processing duration is above its tool/action baseline.');
  }
  if (components.trendHealth !== null && components.trendHealth < 90) {
    reasons.push('Recent operational behavior degraded versus the prior period.');
  }
  if (entityField === 'workspace_id') {
    const anomalous = rows.filter((row) => row.is_anomaly === 'true');
    for (const field of ['device_id', 'tool_id']) {
      const countsByField = new Map();
      for (const row of anomalous) countsByField.set(row[field], (countsByField.get(row[field]) || 0) + 1);
      const top = [...countsByField.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0];
      if (top) reasons.push(`${top[0]} accounts for ${top[1]} anomalies in this workspace.`);
    }
  }
  return Object.freeze(reasons.length ? reasons : ['No adverse contributor was detected in the selected period.']);
}

function summarizeGroup(entityId, rows, baselines, entityField, allRows, minimumRuns) {
  const totalRuns = rows.length;
  const successful = rows.filter((row) => row.status === 'success').length;
  const failures = rows.filter((row) => row.status === 'failure').length;
  const cancelled = rows.filter((row) => row.status === 'cancelled').length;
  const anomalies = rows.filter((row) => row.is_anomaly === 'true').length;
  const outcomeHealth = totalRuns ? 100 * successful / totalRuns : null;
  const anomalyUpperBound = wilsonUpperBound(anomalies, totalRuns);
  const anomalyHealth = anomalyUpperBound === null ? null : 100 * (1 - anomalyUpperBound);
  const components = Object.freeze({
    outcomeHealth,
    anomalyHealth,
    processingHealth: processingHealth(rows, baselines),
    trendHealth: trendHealth(rows, baselines),
  });
  const validComponents = Object.values(components).filter((value) => value !== null && Number.isFinite(value));
  const score = validComponents.length
    ? validComponents.reduce((sum, value) => sum + value, 0) / validComponents.length
    : 0;
  const enoughData = totalRuns >= minimumRuns;
  const summary = {
    entityId,
    entityType: entityField.replace('_id', ''),
    totalRuns,
    healthScore: round(score, 2),
    healthStatus: healthStatus(score, enoughData),
    components: Object.freeze(Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value, 2)]))),
    counts: Object.freeze({ successful, failures, cancelled, anomalies, highSeverityAnomalies: rows.filter((row) => row.severity === 'high' || row.severity === 'critical').length }),
    latestAnomalyAt: rows.filter((row) => row.is_anomaly === 'true').map((row) => row.completed_at).sort().at(-1) || null,
    rows: Object.freeze(rows),
  };
  return Object.freeze({ ...summary, reasons: buildReasons(summary, allRows, entityField) });
}

function priorityOrder(left, right) {
  const leftTrendHealth = left.components.trendHealth ?? 100;
  const rightTrendHealth = right.components.trendHealth ?? 100;
  return STATUS_RANK[left.healthStatus] - STATUS_RANK[right.healthStatus]
    || left.healthScore - right.healthScore
    || right.counts.highSeverityAnomalies - left.counts.highSeverityAnomalies
    || leftTrendHealth - rightTrendHealth
    || right.counts.failures - left.counts.failures
    || String(right.latestAnomalyAt || '').localeCompare(String(left.latestAnomalyAt || ''))
    || left.entityId.localeCompare(right.entityId);
}

function stripRows(summary) {
  const { rows, ...safe } = summary;
  return Object.freeze(safe);
}

/** Build deterministic health and priority views from already-scored events. */
export function buildIntelligenceSummary(scoredRows, { minimumRuns = 20 } = {}) {
  if (!Array.isArray(scoredRows) || scoredRows.length === 0) throw new Error('Scored rows are required for intelligence summaries.');
  const baselines = baselineByTool(scoredRows);
  const by = (field) => {
    const groups = new Map();
    for (const row of scoredRows) {
      if (!groups.has(row[field])) groups.set(row[field], []);
      groups.get(row[field]).push(row);
    }
    return [...groups.entries()]
      .map(([entityId, rows]) => summarizeGroup(entityId, rows, baselines, field, scoredRows, minimumRuns))
      .sort(priorityOrder)
      .map((summary, index) => Object.freeze({ ...stripRows(summary), priorityRank: index + 1 }));
  };

  const global = summarizeGroup('global', scoredRows, baselines, 'global_id', scoredRows, minimumRuns);
  return Object.freeze({
    methodology: Object.freeze({
      healthAggregation: 'unweighted mean of available components',
      anomalyAdjustment: '95% Wilson upper bound',
      priorityOrder: 'health status, health score, high severity anomalies, degradation, failures, recency, id',
      minimumRuns,
    }),
    global: stripRows(global),
    workspaces: Object.freeze(by('workspace_id')),
    devices: Object.freeze(by('device_id')),
    tools: Object.freeze(by('tool_id')),
  });
}
