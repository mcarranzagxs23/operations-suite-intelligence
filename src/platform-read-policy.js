/**
 * Decide whether a failed Firestore read is an expected authorization result.
 *
 * Rules intentionally deny some broad queries for scoped roles. That case is
 * rendered as an empty collection. Connectivity, configuration, index, and
 * service failures are not silently converted into "no data"; callers must
 * surface a safe technical state instead.
 */
export function isExpectedReadDenial(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return code === 'permission-denied' || code.endsWith('/permission-denied');
}

export async function readScopedData(loader, fallback = []) {
  try {
    return await loader();
  } catch (error) {
    if (isExpectedReadDenial(error)) return fallback;
    throw error;
  }
}
