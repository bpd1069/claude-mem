/**
 * Federation Constants
 *
 * Geometric constraints for federated vector database queries.
 * Based on tetrahedron model: local node + 3 remote nodes maximum.
 *
 * Rationale:
 * - Tetrahedron is the minimal stable 3D structure (4 vertices, 6 edges)
 * - Golden ratio provides natural priority decay
 * - Constraints prevent runaway queries and enforce security boundaries
 */

/**
 * Golden ratio (φ) - used for priority decay
 * φ = (1 + √5) / 2 ≈ 1.618033988749895
 */
export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Inverse golden ratio (1/φ) ≈ 0.618033988749895
 * Also equals φ - 1 due to golden ratio properties
 */
export const PHI_INVERSE = 1 / PHI;

/**
 * Maximum remote vector databases (tetrahedron constraint)
 * Local + 3 remotes = 4 vertices
 */
export const MAX_FEDERATION_REMOTES = 3;

/**
 * Priority weights using golden ratio decay
 * Index 0 = local (always 1.0)
 * Index 1-3 = remotes with φ^-n decay
 */
export const FEDERATION_PRIORITY_WEIGHTS = Object.freeze({
  local: 1.0,
  remote1: Math.pow(PHI_INVERSE, 1),  // ≈ 0.618
  remote2: Math.pow(PHI_INVERSE, 2),  // ≈ 0.382
  remote3: Math.pow(PHI_INVERSE, 3),  // ≈ 0.236
});

/**
 * Get priority weight for a given position
 * @param position 0 = local, 1-3 = remotes
 * @returns Priority weight (1.0 for local, golden ratio decay for remotes)
 */
export function getPriorityWeight(position: number): number {
  if (position < 0) return 0;
  if (position === 0) return 1.0;
  if (position > MAX_FEDERATION_REMOTES) return 0;
  return Math.pow(PHI_INVERSE, position);
}

/**
 * Calculate weighted score for federated results
 * @param localScore Score from local database
 * @param remoteScores Array of scores from remote databases (max 3)
 * @returns Combined weighted score
 */
export function calculateFederatedScore(
  localScore: number,
  remoteScores: number[]
): number {
  let total = localScore * FEDERATION_PRIORITY_WEIGHTS.local;
  const weights = [
    FEDERATION_PRIORITY_WEIGHTS.remote1,
    FEDERATION_PRIORITY_WEIGHTS.remote2,
    FEDERATION_PRIORITY_WEIGHTS.remote3,
  ];

  for (let i = 0; i < Math.min(remoteScores.length, MAX_FEDERATION_REMOTES); i++) {
    total += remoteScores[i] * weights[i];
  }

  return total;
}

/**
 * Priority decay strategies
 */
export type PriorityDecayStrategy = 'golden' | 'exponential' | 'linear';

/**
 * Get priority weight using specified decay strategy
 * @param position 0 = local, 1-3 = remotes
 * @param strategy Decay strategy to use
 * @returns Priority weight
 */
export function getPriorityWeightByStrategy(
  position: number,
  strategy: PriorityDecayStrategy
): number {
  if (position < 0 || position > MAX_FEDERATION_REMOTES) return 0;
  if (position === 0) return 1.0;

  switch (strategy) {
    case 'golden':
      return Math.pow(PHI_INVERSE, position);
    case 'exponential':
      return Math.pow(0.5, position);  // 0.5, 0.25, 0.125
    case 'linear':
      return 1 - (position * 0.25);    // 0.75, 0.5, 0.25
    default:
      return Math.pow(PHI_INVERSE, position);
  }
}

/**
 * Tetrahedron edge count formula: n(n-1)/2 where n = vertices
 * For n=4: 4(3)/2 = 6 edges
 */
export const TETRAHEDRON_EDGES = (4 * 3) / 2;

/**
 * Validate federation configuration
 * @param remoteCount Number of configured remotes
 * @returns Validation result with error message if invalid
 */
export function validateFederationConfig(remoteCount: number): {
  valid: boolean;
  error?: string;
} {
  if (remoteCount < 0) {
    return { valid: false, error: 'Remote count cannot be negative' };
  }
  if (remoteCount > MAX_FEDERATION_REMOTES) {
    return {
      valid: false,
      error: `Maximum ${MAX_FEDERATION_REMOTES} remote databases allowed (tetrahedron constraint)`,
    };
  }
  return { valid: true };
}
