import { quantile } from './statistics.mjs';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function harmonic(value) {
  let total = 0;
  for (let index = 1; index <= value; index += 1) total += 1 / index;
  return total;
}

export function averagePathLength(sampleSize) {
  if (sampleSize <= 1) return 0;
  if (sampleSize === 2) return 1;
  return (2 * harmonic(sampleSize - 1)) - (2 * (sampleSize - 1) / sampleSize);
}

function sampleWithoutReplacement(rows, size, random) {
  const indexes = rows.map((_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [indexes[index], indexes[next]] = [indexes[next], indexes[index]];
  }
  return indexes.slice(0, size).map((index) => rows[index]);
}

function candidateFeatures(rows) {
  const width = rows[0]?.length || 0;
  const candidates = [];
  for (let feature = 0; feature < width; feature += 1) {
    const values = rows.map((row) => row[feature]);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum) {
      candidates.push(Object.freeze({ feature, minimum, maximum }));
    }
  }
  return candidates;
}

function buildTree(rows, depth, maxDepth, random) {
  if (depth >= maxDepth || rows.length <= 1) return Object.freeze({ type: 'external', size: rows.length });
  const candidates = candidateFeatures(rows);
  if (candidates.length === 0) return Object.freeze({ type: 'external', size: rows.length });

  const candidate = candidates[Math.floor(random() * candidates.length)];
  const split = candidate.minimum + random() * (candidate.maximum - candidate.minimum);
  const left = [];
  const right = [];
  for (const row of rows) {
    if (row[candidate.feature] < split) left.push(row);
    else right.push(row);
  }
  if (left.length === 0 || right.length === 0) return Object.freeze({ type: 'external', size: rows.length });

  return Object.freeze({
    type: 'branch',
    feature: candidate.feature,
    split,
    left: buildTree(left, depth + 1, maxDepth, random),
    right: buildTree(right, depth + 1, maxDepth, random),
  });
}

function pathLength(tree, row, depth = 0) {
  if (tree.type === 'external') return depth + averagePathLength(tree.size);
  return row[tree.feature] < tree.split
    ? pathLength(tree.left, row, depth + 1)
    : pathLength(tree.right, row, depth + 1);
}

function assertMatrix(rows) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('Isolation Forest requires at least two feature rows.');
  const width = rows[0]?.length;
  if (!Number.isInteger(width) || width === 0) throw new Error('Feature rows must contain at least one value.');
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== width || row.some((value) => !Number.isFinite(value))) {
      throw new Error('Feature rows must have the same finite numeric values.');
    }
  }
}

/**
 * A deterministic Isolation Forest reference implementation for the academic
 * pipeline. It is isolated from product code and has no service dependency.
 */
export function fitIsolationForest(rows, {
  treeCount = 100,
  sampleSize = 256,
  seed = 20260901,
} = {}) {
  assertMatrix(rows);
  if (!Number.isInteger(treeCount) || treeCount < 10) throw new Error('treeCount must be at least 10.');
  const effectiveSampleSize = Math.min(sampleSize, rows.length);
  if (!Number.isInteger(effectiveSampleSize) || effectiveSampleSize < 2) throw new Error('sampleSize must be at least two.');

  const random = seededRandom(seed);
  const maxDepth = Math.ceil(Math.log2(effectiveSampleSize));
  const forest = [];
  for (let index = 0; index < treeCount; index += 1) {
    const sample = sampleWithoutReplacement(rows, effectiveSampleSize, random);
    forest.push(buildTree(sample, 0, maxDepth, random));
  }

  return Object.freeze({
    treeCount,
    sampleSize: effectiveSampleSize,
    featureCount: rows[0].length,
    score(row) {
      if (!Array.isArray(row) || row.length !== this.featureCount || row.some((value) => !Number.isFinite(value))) {
        throw new Error('Score row does not match the fitted feature shape.');
      }
      const averageLength = forest.reduce((sum, tree) => sum + pathLength(tree, row), 0) / forest.length;
      const normalizer = averagePathLength(effectiveSampleSize);
      return normalizer === 0 ? 0 : 2 ** (-averageLength / normalizer);
    },
  });
}

export function anomalyThreshold(scores, alertFraction = 0.08) {
  if (!Number.isFinite(alertFraction) || alertFraction <= 0 || alertFraction >= 1) {
    throw new Error('alertFraction must be between zero and one.');
  }
  return quantile(scores, 1 - alertFraction);
}
