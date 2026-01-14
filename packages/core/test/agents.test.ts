import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAgentsMarkdown } from "../src/agents.js";
import { loadRegistry } from "../src/registry.js";

function resolveRegistryRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../../registry");
}

describe("agents markdown", () => {
  it("includes quality gates and activation rules", async () => {
    const registryRoot = resolveRegistryRoot();
    const registry = await loadRegistry(registryRoot);
    const output = await buildAgentsMarkdown({
      projectName: "demo",
      harnesses: ["codex"],
      skills: registry.skills,
      selectedSkillIds: ["frontend-design", "planner"],
      skillAnswers: {
        "frontend-design": { frontendDir: "/web" }
      },
      registryRoot
    });

    expect(output).toContain("run `typecheck`, `lint`, and `format:check`");
    expect(output).toContain("Use the frontend-design skill when changing files under /web");
  });
});
