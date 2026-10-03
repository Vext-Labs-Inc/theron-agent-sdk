import { describe, it, expect } from "vitest";
import {
  LOCAL_TOOL_NAMES,
  LOCAL_TOOL_PARAMETERS,
  MUTATING_LOCAL_TOOLS,
  buildLocalToolSchemas,
} from "../src/tools/local-contract.js";

describe("LOCAL_TOOL_NAMES", () => {
  it("contains exactly the 7 expected tool names in registry order", () => {
    expect(LOCAL_TOOL_NAMES).toEqual([
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "LS",
    ]);
  });
});

describe("LOCAL_TOOL_PARAMETERS", () => {
  it("has an entry for every name in LOCAL_TOOL_NAMES", () => {
    for (const name of LOCAL_TOOL_NAMES) {
      expect(LOCAL_TOOL_PARAMETERS).toHaveProperty(name);
    }
  });

  it("each parameters object has type 'object' and a properties object", () => {
    for (const name of LOCAL_TOOL_NAMES) {
      const params = LOCAL_TOOL_PARAMETERS[name];
      expect(params.type).toBe("object");
      expect(typeof params.properties).toBe("object");
      expect(params.properties).not.toBeNull();
    }
  });

  it("Write requires file_path and content", () => {
    const required = LOCAL_TOOL_PARAMETERS["Write"].required as string[];
    expect(required).toContain("file_path");
    expect(required).toContain("content");
  });

  it("Edit requires file_path, old_string, and new_string", () => {
    const required = LOCAL_TOOL_PARAMETERS["Edit"].required as string[];
    expect(required).toContain("file_path");
    expect(required).toContain("old_string");
    expect(required).toContain("new_string");
  });

  it("Bash requires command", () => {
    const required = LOCAL_TOOL_PARAMETERS["Bash"].required as string[];
    expect(required).toContain("command");
  });
});

describe("MUTATING_LOCAL_TOOLS", () => {
  it("is exactly {Write, Edit, Bash}", () => {
    expect(MUTATING_LOCAL_TOOLS.size).toBe(3);
    expect(MUTATING_LOCAL_TOOLS.has("Write")).toBe(true);
    expect(MUTATING_LOCAL_TOOLS.has("Edit")).toBe(true);
    expect(MUTATING_LOCAL_TOOLS.has("Bash")).toBe(true);
  });

  it("is a subset of LOCAL_TOOL_NAMES", () => {
    const names = new Set(LOCAL_TOOL_NAMES);
    for (const tool of MUTATING_LOCAL_TOOLS) {
      expect(names.has(tool)).toBe(true);
    }
  });
});

describe("buildLocalToolSchemas", () => {
  it("returns exactly 7 defs", () => {
    const defs = buildLocalToolSchemas({});
    expect(defs).toHaveLength(7);
  });

  it("each def has type 'function'", () => {
    const defs = buildLocalToolSchemas({});
    for (const def of defs) {
      expect(def.type).toBe("function");
    }
  });

  it("uses the supplied description for Read", () => {
    const defs = buildLocalToolSchemas({ Read: "r desc" });
    const readDef = defs.find((d) => d.function.name === "Read");
    expect(readDef?.function.description).toBe("r desc");
  });

  it("defaults to empty string for a tool with no supplied description", () => {
    const defs = buildLocalToolSchemas({ Read: "r desc" });
    // Write was not supplied — should default to ""
    const writeDef = defs.find((d) => d.function.name === "Write");
    expect(writeDef?.function.description).toBe("");
  });

  it("Read def has parameters deep-equal to LOCAL_TOOL_PARAMETERS.Read", () => {
    const defs = buildLocalToolSchemas({ Read: "r desc" });
    const readDef = defs.find((d) => d.function.name === "Read");
    expect(readDef?.function.parameters).toEqual(LOCAL_TOOL_PARAMETERS["Read"]);
  });

  it("output defs are in LOCAL_TOOL_NAMES order", () => {
    const defs = buildLocalToolSchemas({});
    const names = defs.map((d) => d.function.name);
    expect(names).toEqual([...LOCAL_TOOL_NAMES]);
  });
});
