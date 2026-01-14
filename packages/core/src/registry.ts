import path from "node:path";
import { z } from "zod";
import {
  HarnessManifest,
  HarnessManifestSchema,
  SkillManifest,
  SkillManifestSchema
} from "./types.js";
import { listDirectories, readJsonFile } from "./fs-utils.js";

export type Registry = {
  skills: SkillManifest[];
  harnesses: HarnessManifest[];
};

export async function loadSkills(registryRoot: string): Promise<SkillManifest[]> {
  const skillsRoot = path.join(registryRoot, "skills");
  const skillDirs = await listDirectories(skillsRoot);
  const manifests = await Promise.all(
    skillDirs.map(async (dir) => {
      const manifestPath = path.join(skillsRoot, dir, "skill.json");
      const data = await readJsonFile<unknown>(manifestPath);
      return SkillManifestSchema.parse(data);
    })
  );
  return manifests.sort((a: SkillManifest, b: SkillManifest) => a.id.localeCompare(b.id));
}

export async function loadHarnesses(registryRoot: string): Promise<HarnessManifest[]> {
  const harnessRoot = path.join(registryRoot, "harnesses");
  const harnessDirs = await listDirectories(harnessRoot);
  const manifests = await Promise.all(
    harnessDirs.map(async (dir) => {
      const manifestPath = path.join(harnessRoot, dir, "harness.json");
      const data = await readJsonFile<unknown>(manifestPath);
      return HarnessManifestSchema.parse(data);
    })
  );
  return manifests.sort((a: HarnessManifest, b: HarnessManifest) => a.id.localeCompare(b.id));
}

export async function loadRegistry(registryRoot: string): Promise<Registry> {
  const [skills, harnesses] = await Promise.all([
    loadSkills(registryRoot),
    loadHarnesses(registryRoot)
  ]);
  assertValidRegistryIds(skills, harnesses);
  return { skills, harnesses };
}

export function resolveSkillDir(registryRoot: string, skillId: string): string {
  return path.join(registryRoot, "skills", skillId);
}

export function resolveHarnessDir(registryRoot: string, harnessId: string): string {
  return path.join(registryRoot, "harnesses", harnessId);
}

export function assertValidRegistryIds(
  skills: SkillManifest[],
  harnesses: HarnessManifest[]
): void {
  const skillIds = new Set(skills.map((skill) => skill.id));
  const harnessIds = new Set(harnesses.map((harness) => harness.id));
  if (skillIds.size !== skills.length) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["skills"],
        message: "Duplicate skill ids"
      }
    ]);
  }
  if (harnessIds.size !== harnesses.length) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ["harnesses"],
        message: "Duplicate harness ids"
      }
    ]);
  }
}
