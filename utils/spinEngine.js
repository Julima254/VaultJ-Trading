// Base configured distribution (must sum to 100)
const BASE_OUTCOMES = [
  { multiplier: 0,    weight: 50   },
  { multiplier: 0.5,  weight: 25   },
  { multiplier: 1,    weight: 15   },
  { multiplier: 1.5,  weight: 5    },
  { multiplier: 2,    weight: 3    },
  { multiplier: 5,    weight: 1.5  },
  { multiplier: 10,   weight: 0.5  },
];

const MIN_NONZERO_MULTIPLIER = Math.min(
  ...BASE_OUTCOMES.filter(o => o.multiplier > 0).map(o => o.multiplier)
); // 0.5

function round2(num) {
  return Math.round(num * 100) / 100;
}

/**
 * If even the smallest non-zero multiplier's payout would exceed the
 * pool, the spin must be rejected outright before anything happens.
 */
function canPoolSupportStake(stake, poolBalance) {
  const minWinPayout = stake * MIN_NONZERO_MULTIPLIER;
  return minWinPayout <= poolBalance;
}

/**
 * Rule: any outcome whose payout would exceed the remaining pool is
 * removed, and its probability weight is reassigned to the ×0 outcome.
 * Total weight stays 100 — the pool is never asked to cover more than
 * it has.
 */
function buildEligibleOutcomes(stake, poolBalance) {
  let reassignedWeight = 0;
  const eligible = [];

  for (const outcome of BASE_OUTCOMES) {
    const payout = round2(stake * outcome.multiplier);
    if (payout <= poolBalance) {
      eligible.push({ ...outcome, payout });
    } else {
      reassignedWeight += outcome.weight;
    }
  }

  return eligible.map(o =>
    o.multiplier === 0 ? { ...o, weight: o.weight + reassignedWeight } : o
  );
}

function weightedRandomPick(outcomes) {
  const totalWeight = outcomes.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * totalWeight;

  for (const outcome of outcomes) {
    if (r < outcome.weight) return outcome;
    r -= outcome.weight;
  }
  return outcomes[outcomes.length - 1]; // float safety fallback
}

/**
 * Main entry point. Throws POOL_INSUFFICIENT if the stake can't be
 * supported at all by the current pool.
 */
function resolveSpin(stake, poolBalance) {
  if (!canPoolSupportStake(stake, poolBalance)) {
    const err = new Error("Prize pool cannot currently support a spin of this size.");
    err.code = "POOL_INSUFFICIENT";
    throw err;
  }

  const eligibleOutcomes = buildEligibleOutcomes(stake, poolBalance);
  const result = weightedRandomPick(eligibleOutcomes);

  return {
    multiplier: result.multiplier,
    payout: round2(stake * result.multiplier),
    eligibleMultipliers: eligibleOutcomes.map(o => o.multiplier),
  };
}

module.exports = {
  BASE_OUTCOMES,
  MIN_NONZERO_MULTIPLIER,
  canPoolSupportStake,
  buildEligibleOutcomes,
  weightedRandomPick,
  resolveSpin,
  round2,
};