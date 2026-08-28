export const RateLimitPolicies = {
  // Baseline API limits - generous for normal SPA usage
  baseline: { limit: 100, ttl: 60000 },

  // Auth endpoints (login) - strict to prevent brute force
  auth: { limit: 5, ttl: 900000 }, // 5 attempts per 15 mins

  // Expensive actions (sync, oauth connect) - prevents abuse of external APIs/queues
  expensive: { limit: 10, ttl: 60000 },
};
