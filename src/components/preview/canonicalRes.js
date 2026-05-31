/**
 * Canonical render height (1080-base) for each aspect ratio. This MUST stay
 * in sync with `RESOLUTION_MAP.high` × `resolveResolution()` on the backend
 * (server/core/types.ts) so:
 *
 *   - Preview's font scale (containerH / videoHeight) maps 1:1 with
 *     libass's PlayResY output.
 *   - fontSize=N appears at the same proportional size across high/2k/4k
 *     and across all aspect ratios.
 *
 * If you add a new aspect ratio, also extend RESOLUTION_MAP on the backend
 * and `ASPECT_RATIOS` in projectStore.
 */
export const CANONICAL_HEIGHT = {
  '9:16': 1920,
  '16:9': 1080,
  '1:1':  1080,
  '4:5':  1350,
  '3:4':  1440,
  '4:3':  1080,
}

export function getCanonicalHeight(aspectRatio) {
  return CANONICAL_HEIGHT[aspectRatio ?? '9:16'] ?? 1920
}
