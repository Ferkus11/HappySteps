/** Plan limits — configuration stub for SPEC §10. Not enforced yet. */
export const PLAN_LIMITS: Record<string, { children: number; staff: number }> = {
  trial: { children: 200, staff: 50 },
  basic: { children: 150, staff: 40 },
  pro: { children: 500, staff: 150 },
};
export const ENFORCE_PLAN_LIMITS = false;
