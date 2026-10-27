import { InvalidTransitionError } from "./errors";

/**
 * Typed, documented state machine. Every business entity with a lifecycle
 * (event, order, payment, ticket, membership, …) declares its transition graph here
 * and performs status changes ONLY through `transition()`.
 *
 * Generic PATCH endpoints must never write a status column directly.
 */
export interface TransitionContext {
  /** Who triggers the transition (user id, "system", "webhook:stripe", …). */
  actor: string;
  /** Why — recorded in the audit log for sensitive transitions. */
  reason?: string;
  now?: Date;
}

export type Guard<S extends string, Ctx> = (from: S, to: S, ctx: Ctx & TransitionContext) => true | string;

export interface StateMachineDefinition<S extends string, Ctx = Record<never, never>> {
  readonly entity: string;
  readonly initial: S;
  /** Allowed transitions: from → set of reachable states. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  /** Optional guards evaluated for a specific edge. Returning a string denies with that reason. */
  readonly guards?: Partial<Record<`${S}->${S}`, Guard<S, Ctx>>>;
  /** Terminal states: no outgoing transitions. Documented explicitly for the transition graph. */
  readonly terminal?: readonly S[];
}

export interface TransitionResult<S extends string> {
  readonly from: S;
  readonly to: S;
  readonly at: Date;
  readonly actor: string;
  readonly reason: string | undefined;
}

export class StateMachine<S extends string, Ctx = Record<never, never>> {
  constructor(private readonly def: StateMachineDefinition<S, Ctx>) {
    for (const t of def.terminal ?? []) {
      if ((def.transitions[t] ?? []).length > 0) {
        throw new Error(`${def.entity}: terminal state "${t}" declares outgoing transitions.`);
      }
    }
  }

  get entity(): string {
    return this.def.entity;
  }

  get initial(): S {
    return this.def.initial;
  }

  get states(): readonly S[] {
    return Object.keys(this.def.transitions) as S[];
  }

  canTransition(from: S, to: S): boolean {
    return (this.def.transitions[from] ?? []).includes(to);
  }

  /** Reasons a transition would be denied (graph + guards). Empty array means allowed. */
  denialReasons(from: S, to: S, ctx: Ctx & TransitionContext): string[] {
    if (!this.canTransition(from, to)) {
      return [`Transition non définie : ${from} → ${to}`];
    }
    const guard = this.def.guards?.[`${from}->${to}` as `${S}->${S}`];
    if (!guard) return [];
    const verdict = guard(from, to, ctx);
    return verdict === true ? [] : [verdict];
  }

  /** Perform a transition or throw InvalidTransitionError. */
  transition(from: S, to: S, ctx: Ctx & TransitionContext): TransitionResult<S> {
    const reasons = this.denialReasons(from, to, ctx);
    if (reasons.length > 0) {
      throw new InvalidTransitionError(this.def.entity, from, to);
    }
    return {
      from,
      to,
      at: ctx.now ?? new Date(),
      actor: ctx.actor,
      reason: ctx.reason,
    };
  }

  /** Mermaid state diagram of the graph — used to generate documentation. */
  toMermaid(): string {
    const lines = ["stateDiagram-v2", `    [*] --> ${this.def.initial}`];
    for (const from of this.states) {
      for (const to of this.def.transitions[from] ?? []) {
        lines.push(`    ${from} --> ${to}`);
      }
    }
    for (const t of this.def.terminal ?? []) {
      lines.push(`    ${t} --> [*]`);
    }
    return lines.join("\n");
  }
}
