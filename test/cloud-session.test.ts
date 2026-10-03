import { describe, it, expect } from "vitest";
import {
  LocalCloudSessionProvider,
  type CloudSession,
} from "../src/runtime/cloud-session.js";

describe("LocalCloudSession (the testable CloudSession backend)", () => {
  it("provisions a session with an id and an absolute root", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      expect(typeof session.id).toBe("string");
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.root).toMatch(/vext-session-/);
    } finally {
      await session.dispose();
    }
  });

  it("writeFile then exec sees the file; readFile round-trips", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      await session.writeFile("nested/dir/hello.txt", "hi there");
      const cat = await session.exec("cat nested/dir/hello.txt");
      expect(cat.exitCode).toBe(0);
      expect(cat.stdout.trim()).toBe("hi there");
      expect(await session.readFile("nested/dir/hello.txt")).toBe("hi there");
    } finally {
      await session.dispose();
    }
  });

  it("returns a non-zero exit code instead of throwing", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      const r = await session.exec("exit 3");
      expect(r.exitCode).toBe(3);
    } finally {
      await session.dispose();
    }
  });

  it("exec runs inside the session root (commands cannot see the host cwd by default)", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      const pwd = await session.exec("pwd");
      // macOS resolves /var -> /private/var; compare the trailing session dir.
      expect(pwd.stdout.trim().endsWith(session.root.split("/").pop()!)).toBe(true);
    } finally {
      await session.dispose();
    }
  });

  it("rejects a path that escapes the session root (../) for read and write", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      await expect(session.writeFile("../escape.txt", "no")).rejects.toThrow(/escapes session root/);
      await expect(session.readFile("../../etc/passwd")).rejects.toThrow(/escapes session root/);
    } finally {
      await session.dispose();
    }
  });

  it("allows a filename that merely starts with '..' (not a real escape)", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      await session.writeFile("..dotfile", "ok");
      expect(await session.readFile("..dotfile")).toBe("ok");
    } finally {
      await session.dispose();
    }
  });

  it("dispose removes the workspace and makes the session unusable; dispose is idempotent", async () => {
    const session: CloudSession = await new LocalCloudSessionProvider().provision();
    await session.writeFile("a.txt", "x");
    await session.dispose();
    await session.dispose(); // idempotent — must not throw
    await expect(session.exec("echo hi")).rejects.toThrow(/disposed/);
    await expect(session.readFile("a.txt")).rejects.toThrow(/disposed/);
  });

  it("does not pass JUWEL_TOKEN or other secret env names into the child", async () => {
    const keys = ["JUWEL_TOKEN", "SOME_API_KEY", "DB_SECRET"] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.JUWEL_TOKEN = "should-not-leak";
    process.env.SOME_API_KEY = "should-not-leak";
    process.env.DB_SECRET = "should-not-leak";
    const session = await new LocalCloudSessionProvider().provision();
    try {
      for (const key of keys) {
        const result = await session.exec(`printenv ${key}`);
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain("should-not-leak");
      }
    } finally {
      await session.dispose();
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });

  it("passes caller env and still provides PATH", async () => {
    const session = await new LocalCloudSessionProvider().provision();
    try {
      const flag = await session.exec('printf %s "$SESSION_MODE"', {
        env: { SESSION_MODE: "from-caller" },
      });
      expect(flag.exitCode).toBe(0);
      expect(flag.stdout).toBe("from-caller");
      const pathEnv = await session.exec('printf %s "$PATH"');
      expect(pathEnv.exitCode).toBe(0);
      expect(pathEnv.stdout.length).toBeGreaterThan(0);
    } finally {
      await session.dispose();
    }
  });

  it("two provisioned sessions are isolated (different roots)", async () => {
    const a = await new LocalCloudSessionProvider().provision();
    const b = await new LocalCloudSessionProvider().provision();
    try {
      expect(a.root).not.toBe(b.root);
      await a.writeFile("only-in-a.txt", "1");
      const bSees = await b.exec("test -f only-in-a.txt; echo $?");
      expect(bSees.stdout.trim()).toBe("1"); // not found in b
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
});
