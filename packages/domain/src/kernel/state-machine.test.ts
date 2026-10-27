import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "./errors";
import { StateMachine } from "./state-machine";

type DemoState = "draft" | "published" | "cancelled";

const demo = new StateMachine<DemoState, { hasRequiredFields: boolean }>({
  entity: "demo",
  initial: "draft",
  transitions: {
    draft: ["published"],
    published: ["cancelled"],
    cancelled: [],
  },
  guards: {
    "draft->published": (_from, _to, ctx) => ctx.hasRequiredFields || "Champs obligatoires manquants.",
  },
  terminal: ["cancelled"],
});

describe("StateMachine", () => {
  it("allows a defined transition when guards pass", () => {
    const result = demo.transition("draft", "published", { actor: "user:1", hasRequiredFields: true });
    expect(result.to).toBe("published");
    expect(result.actor).toBe("user:1");
  });

  it("denies an undefined transition", () => {
    expect(() => demo.transition("cancelled", "draft", { actor: "user:1", hasRequiredFields: true })).toThrow(
      InvalidTransitionError,
    );
  });

  it("denies a transition when a guard fails and explains why", () => {
    expect(demo.denialReasons("draft", "published", { actor: "u", hasRequiredFields: false })).toEqual([
      "Champs obligatoires manquants.",
    ]);
  });

  it("refuses terminal states with outgoing edges", () => {
    expect(
      () =>
        new StateMachine<DemoState>({
          entity: "broken",
          initial: "draft",
          transitions: { draft: ["published"], published: [], cancelled: ["draft"] },
          terminal: ["cancelled"],
        }),
    ).toThrow();
  });

  it("renders a Mermaid diagram", () => {
    expect(demo.toMermaid()).toContain("draft --> published");
    expect(demo.toMermaid()).toContain("cancelled --> [*]");
  });
});
