import { describe, it, expect } from "vitest";
import { Session } from "../src/index.js";

describe("Session", () => {
  it("generates an id when none given", () => {
    const s = new Session();
    expect(s.id).toBeTruthy();
    expect(typeof s.id).toBe("string");
  });

  it("respects an explicit id + tenant_id + initial_state", () => {
    const s = new Session({
      id: "sess_test",
      tenant_id: "tenant_a",
      initial_state: { key: "value" },
    });
    expect(s.id).toBe("sess_test");
    expect(s.tenant_id).toBe("tenant_a");
    expect(s.state.get("key")).toBe("value");
  });

  it("appends + filters events by type", () => {
    const s = new Session();
    s.append({ type: "user_input", content: "hi", ts: 1 });
    s.append({ type: "agent_output", agent: "a", content: "yo", ts: 2 });
    s.append({ type: "user_input", content: "again", ts: 3 });

    expect(s.getEvents()).toHaveLength(3);

    const inputs = s.getEventsOfType("user_input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].content).toBe("hi");
  });

  it("round-trips through JSON", () => {
    const s = new Session({ id: "sess_x", initial_state: { foo: "bar" } });
    s.append({ type: "user_input", content: "ping", ts: 100 });
    s.append({ type: "agent_output", agent: "a", content: "pong", ts: 101 });

    const json = s.toJSON();
    const restored = Session.fromJSON(json);
    expect(restored.id).toBe("sess_x");
    expect(restored.state.get("foo")).toBe("bar");
    expect(restored.getEvents()).toHaveLength(2);
    expect(restored.getEvents()[1]).toMatchObject({ content: "pong" });
  });
});
