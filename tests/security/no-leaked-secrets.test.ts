import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fails the build if anything that looks like a real credential is committed.
 * The scanner lives in scripts/scan-secrets.mjs so CI and developers run the same code.
 */
describe("no leaked secrets", () => {
  it("scan-secrets finds nothing in the repository", () => {
    const root = resolve(process.cwd());
    const output = execFileSync(process.execPath, [resolve(root, "scripts/scan-secrets.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    expect(output).toContain("0 finding(s)");
  });
});
