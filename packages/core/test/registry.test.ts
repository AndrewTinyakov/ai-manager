import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRegistry } from "../src/registry.js";

function resolveRegistryRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../../registry");
}

describe("registry", () => {
  it("loads built-in skills and harnesses", async () => {
    const registry = await loadRegistry(resolveRegistryRoot());
    const skillIds = registry.skills.map((skill) => skill.id);
    const harnessIds = registry.harnesses.map((harness) => harness.id);

    expect(skillIds).toContain("frontend-design");
    expect(skillIds).toContain("planner");
    expect(skillIds).toContain("code-review");
    expect(skillIds).toContain("backend");
    expect(skillIds).toContain("tester");
    expect(harnessIds).toContain("cursor");
    expect(harnessIds).toContain("codex");
    expect(harnessIds).toContain("opencode");
    expect(harnessIds).toContain("claude-code");
  });
});
