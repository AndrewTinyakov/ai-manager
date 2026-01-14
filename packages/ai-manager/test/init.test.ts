import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAgentsMarkdown,
  loadRegistry,
  resolveHarnessDir,
  resolveSkillDir,
  writeRenderedOutput,
  pathExists
} from "@ai-manager/core";

function resolveRegistryRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../../registry");
}

describe("init rendering", () => {
  it("creates expected files", async () => {
    const registryRoot = resolveRegistryRoot();
    const registry = await loadRegistry(registryRoot);
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-manager-"));

    const selectedSkills = ["frontend-design", "planner"];
    const selectedHarnesses = ["cursor", "codex", "opencode", "claude-code"];

    const agentsContents = await buildAgentsMarkdown({
      projectName: "fixture",
      harnesses: selectedHarnesses,
      skills: registry.skills,
      selectedSkillIds: selectedSkills,
      skillAnswers: { "frontend-design": { frontendDir: "/web" } },
      registryRoot
    });

    await writeRenderedOutput(
      projectRoot,
      { target: "ai/agents.md", template: "templates/agents.generated.md.hbs" },
      registryRoot,
      { content: agentsContents },
      { enabled: false }
    );

    for (const skillId of selectedSkills) {
      const manifest = registry.skills.find((skill) => skill.id === skillId);
      if (!manifest) continue;
      for (const output of manifest.outputs) {
        await writeRenderedOutput(
          projectRoot,
          output,
          resolveSkillDir(registryRoot, manifest.id),
          {
            skill: manifest,
            answers: skillId === "frontend-design" ? { frontendDir: "/web" } : {}
          },
          { enabled: false }
        );
      }
    }

    for (const harnessId of selectedHarnesses) {
      const manifest = registry.harnesses.find((harness) => harness.id === harnessId);
      if (!manifest) continue;
      for (const output of manifest.outputs) {
        await writeRenderedOutput(
          projectRoot,
          output,
          resolveHarnessDir(registryRoot, manifest.id),
          { harness: manifest },
          { enabled: false }
        );
      }
    }

    await expect(pathExists(path.join(projectRoot, "ai", "agents.md"))).resolves.toBe(true);
    await expect(
      pathExists(path.join(projectRoot, "ai", "skills", "frontend-design-skill.md"))
    ).resolves.toBe(true);
    await expect(
      pathExists(path.join(projectRoot, "ai", "skills", "planner-skill.md"))
    ).resolves.toBe(true);
    await expect(
      pathExists(path.join(projectRoot, ".cursor", "rules", "ai-manager.mdc"))
    ).resolves.toBe(true);
    await expect(pathExists(path.join(projectRoot, "AGENTS.md"))).resolves.toBe(true);
    await expect(pathExists(path.join(projectRoot, "CLAUDE.md"))).resolves.toBe(true);
  });
});
