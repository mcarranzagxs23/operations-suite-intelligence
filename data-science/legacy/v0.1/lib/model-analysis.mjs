import { anomalyThreshold, fitIsolationForest } from './isolation-forest.mjs';
import { median, medianAbsoluteDeviation, quantile } from './statistics.mjs';

export const INITIAL_FEATURE_COLUMNS = Object.freeze([
  'log_duration',
]);

export const CANDIDATE_CONTEXT_FEATURE_COLUMNS = Object.freeze([
  'hour_sin',
  'hour_cos',
  'day_sin',
  'day_cos',
  'device_platform',
]);

function valueForFeature(row, feature) {
  if (feature === 'device_platform') return row.device_platform === 'macos' ? 1 : 0;
  return Number(row[feature]);
}

function toFeatures(row, featureColumns) {
  return Object.freeze(featureColumns.map((feature) => valueForFeature(row, feature)));
}

function evaluate(predicted, actual) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (let index = 0; index < predicted.length; index += 1) {
    if (predicted[index] && actual[index]) truePositive += 1;
    else if (predicted[index] && !actual[index]) falsePositive += 1;
    else if (!predicted[index] && actual[index]) falseNegative += 1;
    else trueNegative += 1;
  }
  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  return Object.freeze({
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  });
}

function severity(score, scores) {
  const critical = quantile(scores, 0.99);
  const high = quantile(scores, 0.975);
  const medium = quantile(scores, 0.95);
  if (score >= critical) return 'critical';
  if (score >= high) return 'high';
  if (score >= medium) return 'medium';
  return 'low';
}

function baselineMad(trainRows, evaluationRows) {
  const values = trainRows.map((row) => Number(row.log_duration));
  const midpoint = median(values);
  const mad = medianAbsoluteDeviation(values);
  const lowerQuartile = quantile(values, 0.25);
  const upperQuartile = quantile(values, 0.75);
  const iqr = upperQuartile - lowerQuartile;
  const evaluation = evaluationRows.map((row) => {
    const value = Number(row.log_duration);
    if (mad && mad > 0) {
      const robustZ = Math.abs(0.6745 * (value - midpoint) / mad);
      return robustZ >= 3.5;
    }
    return iqr > 0 && (value < lowerQuartile - (1.5 * iqr) || value > upperQuartile + (1.5 * iqr));
  });
  return Object.freeze({
    medianLogDuration: midpoint,
    mad,
    iqr,
    method: mad && mad > 0 ? 'mad' : 'iqr',
    flags: Object.freeze(evaluation),
  });
}

function groupKey(row) {
  return `${row.tool_id}__${row.action}`;
}

/**
 * Train and evaluate separate models by tool/action. The input stays
 * chronological, so the final period remains unseen during fitting.
 */
export function scoreByTool(rows, {
  trainFraction = 0.7,
  minimumGroupSize = 90,
  seed = 20260901,
  alertFraction = 0.08,
  featureColumns = INITIAL_FEATURE_COLUMNS,
} = {}) {
  if (!Array.isArray(featureColumns) || featureColumns.length === 0) throw new Error('At least one model feature is required.');
  const groups = new Map();
  for (const row of [...rows].sort((left, right) => left.completed_at.localeCompare(right.completed_at))) {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const scoredRows = [];
  const models = [];
  for (const [key, groupRows] of groups.entries()) {
    if (groupRows.length < minimumGroupSize) {
      throw new Error(`Model group ${key} has ${groupRows.length} rows; minimum is ${minimumGroupSize}.`);
    }
    const splitIndex = Math.max(2, Math.floor(groupRows.length * trainFraction));
    const trainRows = groupRows.slice(0, splitIndex);
    const evaluationRows = groupRows.slice(splitIndex);
    const forest = fitIsolationForest(trainRows.map((row) => toFeatures(row, featureColumns)), { seed: seed + models.length, treeCount: 200 });
    const trainScores = trainRows.map((row) => forest.score(toFeatures(row, featureColumns)));
    const threshold = anomalyThreshold(trainScores, alertFraction);
    const evaluationScores = evaluationRows.map((row) => forest.score(toFeatures(row, featureColumns)));
    const predicted = evaluationScores.map((score) => score >= threshold);
    const actual = evaluationRows.map((row) => row.expected_anomaly === 'true');
    const baseline = baselineMad(trainRows, evaluationRows);

    for (let index = 0; index < evaluationRows.length; index += 1) {
      const row = evaluationRows[index];
      scoredRows.push(Object.freeze({
        ...row,
        model_id: key,
        anomaly_score: evaluationScores[index].toFixed(6),
        anomaly_threshold: threshold.toFixed(6),
        is_anomaly: String(predicted[index]),
        severity: severity(evaluationScores[index], trainScores),
        baseline_mad_flag: String(baseline.flags[index]),
      }));
    }

    models.push(Object.freeze({
      modelId: key,
      featureColumns: Object.freeze([...featureColumns]),
      trainRows: trainRows.length,
      evaluationRows: evaluationRows.length,
      threshold,
      metrics: evaluate(predicted, actual),
      madBaseline: Object.freeze({
        medianLogDuration: baseline.medianLogDuration,
        mad: baseline.mad,
        iqr: baseline.iqr,
        method: baseline.method,
        metrics: evaluate(baseline.flags, actual),
      }),
    }));
  }

  return Object.freeze({ rows: Object.freeze(scoredRows), models: Object.freeze(models) });
}
