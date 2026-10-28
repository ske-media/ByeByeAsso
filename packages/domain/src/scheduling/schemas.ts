import { optionalTextSchema, textSchema, uuidSchema } from "@kroov/validation";
import { z } from "zod";

export const createVersionSchema = z.object({
  basedOnVersionId: uuidSchema.optional(),
  notes: optionalTextSchema(1000),
});
export type CreateVersionInput = z.input<typeof createVersionSchema>;

export const weightsSchema = z
  .object({
    preference: z.coerce.number().min(0).max(100),
    timeFit: z.coerce.number().min(0).max(100),
    buddy: z.coerce.number().min(0).max(100),
    fairness: z.coerce.number().min(0).max(100),
    optionalSkill: z.coerce.number().min(0).max(100),
  })
  .partial();

export const generateSchema = z.object({
  /** Partial regeneration: only these shifts (locked and out-of-scope assignments are kept). */
  shiftIds: z.array(uuidSchema).max(300).optional(),
  weights: weightsSchema.optional(),
});
export type GenerateInput = z.input<typeof generateSchema>;

export const assignSchema = z.object({
  shiftId: uuidSchema,
  applicationId: uuidSchema,
  lock: z.boolean().optional(),
});
export type AssignInput = z.input<typeof assignSchema>;

export const publishSchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  acknowledgeUnfilled: z.boolean().optional(),
  notes: optionalTextSchema(1000),
});
export type PublishInput = z.input<typeof publishSchema>;

export const reportUnavailableSchema = z.object({ message: optionalTextSchema(1000) });

export const resolveRequestSchema = z.object({ resolution: textSchema(1000).pipe(z.string().min(3)) });

export const attendanceSchema = z.object({
  status: z.enum(["present", "absent", "late", "excused"]),
  note: optionalTextSchema(500),
});
export type AttendanceInput = z.input<typeof attendanceSchema>;
