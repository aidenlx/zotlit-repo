import { describe as group, expect, it } from "vitest";

import { EVENTS, STATES } from "./web-api-machine-table.ts";
import { describe, transition, unconsentedOf } from "./web-api-machine.ts";

group("the state machine of the Web API source", () => {
  it("serves after each commit", () => {
    const violations: string[] = [];
    for (const state of STATES)
      for (const event of EVENTS) {
        const { state: next } = transition(state, event);
        const at = `${describe(state)} on ${event._tag}`;
        if (
          event._tag === "committed" &&
          describe(next) !== `serving/ok/${state.activity.kind}`
        )
          violations.push(`${at}: ${describe(next)}`);
      }
    expect(violations).toEqual([]);
  });

  it("clears the consent request when an authorised build starts, and publishes nothing for it", () => {
    const violations: string[] = [];
    for (const state of STATES) {
      const { state: next, commands } = transition(state, {
        _tag: "build-started",
      });
      const at = describe(state);
      if (unconsentedOf(next) !== null) violations.push(`${at}: unconsented`);
      if (
        state.availability.kind === "building" &&
        commands.some((command) => command._tag === "publish")
      )
        violations.push(`${at}: publishes`);
    }
    expect(violations).toEqual([]);
  });
});
