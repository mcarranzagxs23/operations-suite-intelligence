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
  treeCount = 200,
  sampleSize = 256,
  seed = 20260901,
} = {}) {
  assertMatrix(rows);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid seed.');
  if (!Number.isInteger(treeCount) || treeCount < 10 || treeCount > 1000) throw new Error('treeCount must be between 10 and 1000.');
  if (!Number.isInteger(sampleSize) || sampleSize < 2 || sampleSize > 4096) throw new Error('Invalid sampleSize.');
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
    artifact: { schemaVersion: 2, treeCount, sampleSize: effectiveSampleSize, featureCount: rows[0].length, seed, maxDepth, forest },
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

/** Restore the actual fitted trees; inference never retrains on the new event. */
export function loadIsolationForest(artifact) {
  if (!artifact || artifact.schemaVersion !== 2 || !Number.isInteger(artifact.featureCount) || artifact.featureCount < 1
    || !Number.isInteger(artifact.sampleSize) || artifact.sampleSize < 2 || artifact.sampleSize > 4096
    || !Array.isArray(artifact.forest) || artifact.forest.length !== artifact.treeCount || artifact.treeCount < 10 || artifact.treeCount > 1000) throw new Error('INVALID_FOREST_ARTIFACT');
  let nodes = 0;
  const validate = (tree, depth = 0) => {
    if (!tree || depth > 12 || ++nodes > 2_000_000) throw new Error('INVALID_TREE');
    if (tree.type === 'external') {
      if (!Number.isInteger(tree.size) || tree.size < 0 || tree.size > artifact.sampleSize) throw new Error('INVALID_LEAF');
    } else if (tree.type === 'branch' && Number.isInteger(tree.feature) && tree.feature >= 0 && tree.feature < artifact.featureCount && Number.isFinite(tree.split)) {
      validate(tree.left, depth + 1); validate(tree.right, depth + 1);
    } else throw new Error('INVALID_TREE');
  };
  artifact.forest.forEach(tree => validate(tree));
  return { score(row) {
    if (!Array.isArray(row) || row.length !== artifact.featureCount || row.some(value => !Number.isFinite(value))) throw new Error('INVALID_SCORE_FEATURES');
    return 2 ** (-(artifact.forest.reduce((sum, tree) => sum + pathLength(tree, row), 0) / artifact.treeCount) / averagePathLength(artifact.sampleSize));
  } };
}

export function anomalyThreshold(scores, alertFraction = 0.08) {
  if (!Number.isFinite(alertFraction) || alertFraction <= 0 || alertFraction >= 1) {
    throw new Error('alertFraction must be between zero and one.');
  }
  return quantile(scores, 1 - alertFraction);
}
