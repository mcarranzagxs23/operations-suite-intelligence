export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (probability < 0 || probability > 1) throw new Error('Quantile probability must be between zero and one.');
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function median(values) {
  return quantile(values, 0.5);
}

export function medianAbsoluteDeviation(values) {
  const midpoint = median(values);
  if (midpoint === null) return null;
  return median(values.map((value) => Math.abs(value - midpoint)));
}

export function describe(values) {
  if (!Array.isArray(values) || values.length === 0) return Object.freeze({ count: 0 });
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Object.freeze({
    count: values.length,
    mean: average,
    median: median(values),
    p05: quantile(values, 0.05),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
    p95: quantile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
    standardDeviation: Math.sqrt(variance),
    mad: medianAbsoluteDeviation(values),
  });
}

export function countBy(rows, selector) {
  const counts = new Map();
  for (const row of rows) {
    const key = selector(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))));
}

export function round(value, decimals = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Upper Wilson confidence bound for a binomial rate. */
export function wilsonUpperBound(events, total, z = 1.96) {
  if (!Number.isFinite(events) || !Number.isFinite(total) || total <= 0) return null;
  const rate = clamp(events / total);
  const denominator = 1 + (z ** 2 / total);
  const centre = rate + (z ** 2 / (2 * total));
  const spread = z * Math.sqrt((rate * (1 - rate) / total) + (z ** 2 / (4 * total ** 2)));
  return clamp((centre + spread) / denominator);
}
