import { describe, expect, it } from "vitest";
import { taskInputSchema, taskUpdateSchema } from "./schemas";

describe("tasks · schemas", () => {
  it("creation: optional references accept uuid, empty string, null or absence", () => {
    const id = "6f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(taskInputSchema.parse({ title: "x" })).toMatchObject({
      priority: "normal",
      status: "todo",
      dueAt: null,
      assigneeMemberId: null,
      eventId: null,
      description: null,
    });
    expect(
      taskInputSchema.parse({ title: "x", assigneeMemberId: id, eventId: "", dueAt: "2027-06-12T10:00" }),
    ).toMatchObject({
      assigneeMemberId: id,
      eventId: null,
    });
    expect(taskInputSchema.parse({ title: "x", dueAt: "2027-06-12T10:00" }).dueAt).toBeInstanceOf(Date);
    expect(taskInputSchema.safeParse({ title: "x", assigneeMemberId: "nope" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("update: unmentioned fields stay undefined (never reset by a default)", () => {
    const out = taskUpdateSchema.parse({ priority: "low", version: 3 });
    expect(out).toEqual({ priority: "low", version: 3 });
    expect("description" in out).toBe(false);
    expect(taskUpdateSchema.parse({ description: "" }).description).toBeNull();
    expect(taskUpdateSchema.parse({ assigneeMemberId: "" }).assigneeMemberId).toBe("");
  });
});
