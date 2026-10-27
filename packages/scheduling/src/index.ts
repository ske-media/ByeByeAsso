import { z } from "zod";

/**
 * Scheduling solver contract (Phase 6). Declared now so the database design (Phase 5)
 * and the worker (Phase 0) can target a stable interface.
 *
 * The solver is a pure function of an immutable input snapshot. It returns a DRAFT:
 * a human reviews and publishes. Hard constraints are never traded for soft scores.
 */

const isoInstant = z.string().datetime({ offset: true });

export const schedulingInputSchema = z.object({
  snapshotVersion: z.literal(1),
  eventId: z.string().uuid(),
  config: z.object({
    maxConsecutiveMinutes: z.number().int().positive(),
    minRestMinutes: z.number().int().nonnegative(),
    weights: z.object({
      coverage: z.number().nonnegative(),
      rolePreference: z.number().nonnegative(),
      timePreference: z.number().nonnegative(),
      socialPreference: z.number().nonnegative(),
      fairness: z.number().nonnegative(),
      experience: z.number().nonnegative(),
    }),
  }),
  shifts: z.array(
    z.object({
      id: z.string().uuid(),
      positionId: z.string().uuid(),
      start: isoInstant,
      end: isoInstant,
      required: z.number().int().positive(),
      maximum: z.number().int().positive(),
      requiredSkillIds: z.array(z.string().uuid()),
    }),
  ),
  volunteers: z.array(
    z.object({
      id: z.string().uuid(),
      availability: z.array(z.object({ start: isoInstant, end: isoInstant })),
      verifiedSkillIds: z.array(z.string().uuid()),
      rankedPositionIds: z.array(z.string().uuid()),
      preferredVolunteerIds: z.array(z.string().uuid()),
      existingCommitments: z.array(z.object({ start: isoInstant, end: isoInstant })),
    }),
  ),
  lockedAssignments: z.array(z.object({ shiftId: z.string().uuid(), volunteerId: z.string().uuid() })),
});

export type SchedulingInput = z.infer<typeof schedulingInputSchema>;

export const schedulingOutputSchema = z.object({
  algorithmVersion: z.string(),
  solverStatus: z.enum(["optimal", "feasible", "infeasible", "timeout", "error"]),
  qualityReduced: z.boolean(),
  score: z.number(),
  durationMs: z.number().int().nonnegative(),
  assignments: z.array(z.object({ shiftId: z.string().uuid(), volunteerId: z.string().uuid(), locked: z.boolean() })),
  unfilled: z.array(z.object({ shiftId: z.string().uuid(), missing: z.number().int().positive() })),
  diagnostics: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      shiftId: z.string().uuid().optional(),
      volunteerId: z.string().uuid().optional(),
    }),
  ),
});

export type SchedulingOutput = z.infer<typeof schedulingOutputSchema>;

export interface SchedulingSolverPort {
  readonly name: string;
  solve(input: SchedulingInput, options: { timeoutMs: number }): Promise<SchedulingOutput>;
}
