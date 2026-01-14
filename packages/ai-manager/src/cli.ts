#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import boxen from "boxen";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import prompts from "prompts";
import semver from "semver";
import {
  BackupOptions,
  backupExistingFile,
  buildAgentsMarkdown,
  loadRegistry,
  resolveHarnessDir,
  resolveSkillDir,
  writeJsonFile,
  writeRenderedOutput,
  pathExists,
  readJsonFile,
  SkillManifest,
  HarnessManifest,
  SelectedSkill,
  SelectedHarness,
  ManagerState
} from "@ai-manager/core";

const CURRENT_VERSION = "0.1.0";
const UPDATE_DEFER_DAYS = 7;

const ICONS = {
  ok: chalk.green("OK"),
  warn: chalk.yellow("!"),
  bad: chalk.red("X")
};

const HEADER = boxen(
  `${chalk.bold("ai-manager")} ${chalk.dim(`v${CURRENT_VERSION}`)}\n${chalk.dim(
    "AI harness + skill manager"
  )}`,
  {
    padding: 1,
    margin: { top: 0, bottom: 1, left: 0, right: 0 },
    borderStyle: "round",
    borderColor: "cyan"
  }
);

function resolveRegistryRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../registry");
}

async function detectProjectRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    const gitDir = path.join(current, ".git");
    if (await pathExists(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start);
    }
    current = parent;
  }
}

async function loadUserConfig(): Promise<{ deferredVersion?: string; deferredAt?: string }> {
  const configPath = path.join(os.homedir(), ".config", "ai-manager", "config.json");
  if (!(await pathExists(configPath))) {
    return {};
  }
  return readJsonFile(configPath);
}

async function writeUserConfig(data: { deferredVersion?: string; deferredAt?: string }) {
  const configPath = path.join(os.homedir(), ".config", "ai-manager", "config.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch("https://registry.npmjs.org/ai-manager/latest", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { version?: string };
    return payload.version ?? null;
  } catch {
    return null;
  }
}

async function scanProjectFacts(projectRoot: string): Promise<ManagerState["facts"] | undefined> {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const packageManager = fileNames.includes("pnpm-lock.yaml")
    ? "pnpm"
    : fileNames.includes("yarn.lock")
      ? "yarn"
      : fileNames.includes("package-lock.json")
        ? "npm"
        : fileNames.includes("bun.lockb")
          ? "bun"
          : undefined;
  const tsconfigPaths = fileNames
    .filter((name) => name.startsWith("tsconfig") && name.endsWith(".json"))
    .map((name) => path.join(projectRoot, name));
  const facts: ManagerState["facts"] = {};
  if (packageManager) {
    facts.packageManager = packageManager;
  }
  if (tsconfigPaths.length) {
    facts.tsconfigPaths = tsconfigPaths;
  }
  if (directories.length) {
    facts.directories = directories;
  }
  return Object.keys(facts).length ? facts : undefined;
}

async function maybeShowUpdatePrompt(): Promise<void> {
  const latest = await fetchLatestVersion();
  if (!latest || !semver.valid(latest) || !semver.valid(CURRENT_VERSION)) {
    return;
  }
  if (!semver.gt(latest, CURRENT_VERSION)) {
    return;
  }
  const config = await loadUserConfig();
  if (config.deferredVersion === latest && config.deferredAt) {
    const deferredAt = new Date(config.deferredAt).getTime();
    const tooSoon = Date.now() - deferredAt < UPDATE_DEFER_DAYS * 24 * 60 * 60 * 1000;
    if (tooSoon) {
      return;
    }
  }
  const choice = await prompts({
    type: "select",
    name: "action",
    message: `New version ${latest} available. Install now?`,
    choices: [
      { title: "Install (npm i -g ai-manager@latest)", value: "install" },
      { title: "Later", value: "later" }
    ]
  });
  if (choice.action === "later") {
    await writeUserConfig({ deferredVersion: latest, deferredAt: new Date().toISOString() });
    return;
  }
  if (choice.action === "install") {
    console.log(
      `${chalk.bold("Run:")} npm i -g ai-manager@latest\n${chalk.bold("or:")} pnpm add -g ai-manager@latest\n${chalk.bold(
        "or:"
      )}
      npx ai-manager@latest <command>`
    );
  }
}

async function findManagerState(projectRoot: string): Promise<ManagerState | null> {
  const statePath = path.join(projectRoot, "ai", "ai-manager.json");
  if (!(await pathExists(statePath))) {
    return null;
  }
  return readJsonFile(statePath);
}

function isInited(projectRoot: string): Promise<boolean> {
  const agentsPath = path.join(projectRoot, "ai", "agents.md");
  const statePath = path.join(projectRoot, "ai", "ai-manager.json");
  return Promise.all([pathExists(agentsPath), pathExists(statePath)]).then(
    ([agentsExists, stateExists]) => agentsExists && stateExists
  );
}

function formatStatusRow(label: string, ok: boolean, detail: string): string[] {
  return [ok ? ICONS.ok : ICONS.bad, label, detail];
}

function collectOutputTargets(
  skills: SkillManifest[],
  harnesses: HarnessManifest[],
  skillIds: string[],
  harnessIds: string[]
): Set<string> {
  const targets = new Set<string>();
  for (const skillId of skillIds) {
    const manifest = skills.find((skill) => skill.id === skillId);
    if (!manifest) continue;
    manifest.outputs.forEach((output) => targets.add(output.target));
  }
  for (const harnessId of harnessIds) {
    const manifest = harnesses.find((harness) => harness.id === harnessId);
    if (!manifest) continue;
    manifest.outputs.forEach((output) => targets.add(output.target));
  }
  targets.add("ai/agents.md");
  targets.add("ai/ai-manager.json");
  return targets;
}

async function removeStaleOutputs(
  projectRoot: string,
  staleTargets: Set<string>,
  backup: BackupOptions
): Promise<void> {
  for (const target of staleTargets) {
    const fullPath = path.join(projectRoot, target);
    await backupExistingFile(fullPath, backup);
    await fs.rm(fullPath, { force: true });
  }
}

async function showStatus(projectRoot: string, registryRoot: string): Promise<void> {
  const [inited, state, registry] = await Promise.all([
    isInited(projectRoot),
    findManagerState(projectRoot),
    loadRegistry(registryRoot)
  ]);
  const latest = await fetchLatestVersion();

  console.log(HEADER);

  const table = new Table({
    head: [chalk.dim("Status"), chalk.dim("Item"), chalk.dim("Details")],
    colWidths: [6, 18, 60],
    wordWrap: true
  });

  table.push(formatStatusRow("Init", inited, inited ? "Initialized" : "Not initialized"));
  table.push(
    formatStatusRow(
      "Version",
      true,
      `Current ${CURRENT_VERSION}${latest ? ` | Latest ${latest}` : ""}`
    )
  );
  table.push(
    formatStatusRow(
      "Skills",
      Boolean(state?.skills.length),
      state?.skills.length ? state.skills.map((skill) => skill.id).join(", ") : "None"
    )
  );
  table.push(
    formatStatusRow(
      "Harness",
      Boolean(state?.harnesses.length),
      state?.harnesses.length ? state.harnesses.map((h) => h.id).join(", ") : "None"
    )
  );
  table.push(formatStatusRow("Registry", true, `${registry.skills.length} skills loaded`));

  console.log(table.toString());

  if (!inited) {
    console.log(`${ICONS.warn} ${chalk.yellow("Project not initialized. Run:")} ai-manager init`);
  }
}

function buildBackupOptions(projectRoot: string, enableBackup: boolean): BackupOptions {
  if (!enableBackup) {
    return { enabled: false };
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(projectRoot, "ai", ".backups", timestamp);
  return { enabled: true, backupRoot };
}

async function detectFrontendDefault(projectRoot: string): Promise<string> {
  const candidates = ["/web", "/frontend", "/client"];
  for (const candidate of candidates) {
    const target = path.join(projectRoot, candidate);
    const exists = await fs
      .stat(target)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (exists) {
      return candidate;
    }
  }
  return "/";
}

async function detectBackendDefault(projectRoot: string): Promise<string> {
  const candidates = ["/api", "/backend", "/server"];
  for (const candidate of candidates) {
    const target = path.join(projectRoot, candidate);
    const exists = await fs
      .stat(target)
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (exists) {
      return candidate;
    }
  }
  return "/";
}

async function askSkillQuestions(
  skill: SkillManifest,
  projectRoot: string
): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  for (const question of skill.questions) {
    let defaultValue = question.default ?? "";
    if (skill.id === "frontend-design" && question.id === "frontendDir") {
      defaultValue = await detectFrontendDefault(projectRoot);
    }
    if (skill.id === "backend" && question.id === "backendDir") {
      defaultValue = await detectBackendDefault(projectRoot);
    }
    const response = await prompts({
      type: question.type === "select" ? "select" : "text",
      name: "value",
      message: question.label,
      initial: defaultValue,
      choices: question.options?.map((option) => ({ title: option, value: option })) ?? [],
      validate: (value: string) => {
        if (question.required && !value) {
          return "Required";
        }
        if (question.validation?.pattern) {
          const regex = new RegExp(question.validation.pattern);
          if (!regex.test(value)) {
            return question.validation.message ?? "Invalid value";
          }
        }
        return true;
      }
    });
    if (response.value === undefined) {
      throw new Error("Cancelled");
    }
    answers[question.id] = response.value as string;
  }
  return answers;
}

async function selectSkills(skills: SkillManifest[]): Promise<string[]> {
  const response = await prompts({
    type: "multiselect",
    name: "values",
    message: "Select skills",
    choices: skills.map((skill) => ({
      title: `${skill.name} (${skill.id})`,
      description: skill.description,
      value: skill.id
    }))
  });
  return (response.values as string[]) ?? [];
}

async function selectHarnesses(harnesses: HarnessManifest[]): Promise<string[]> {
  const response = await prompts({
    type: "multiselect",
    name: "values",
    message: "Select harnesses",
    choices: harnesses.map((harness) => ({
      title: `${harness.name} (${harness.id})`,
      value: harness.id
    }))
  });
  return (response.values as string[]) ?? [];
}

async function renderAll(
  projectRoot: string,
  registryRoot: string,
  skills: SkillManifest[],
  harnesses: HarnessManifest[],
  selectedSkills: SelectedSkill[],
  selectedHarnesses: SelectedHarness[],
  backup: BackupOptions
): Promise<string[]> {
  const created: string[] = [];

  const skillAnswerMap = Object.fromEntries(
    selectedSkills.map((skill) => [skill.id, skill.answers])
  );

  const agentsContents = await buildAgentsMarkdown({
    projectName: path.basename(projectRoot),
    harnesses: selectedHarnesses.map((h) => h.id),
    skills,
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    skillAnswers: skillAnswerMap,
    registryRoot
  });

  const agentsPath = path.join(projectRoot, "ai", "agents.md");
  await writeRenderedOutput(
    projectRoot,
    { target: "ai/agents.md", template: "templates/agents.generated.md.hbs" },
    registryRoot,
    { content: agentsContents },
    backup
  );
  created.push(agentsPath);

  for (const selected of selectedSkills) {
    const manifest = skills.find((skill) => skill.id === selected.id);
    if (!manifest) continue;
    const templateRoot = resolveSkillDir(registryRoot, manifest.id);
    for (const output of manifest.outputs) {
      const targetPath = await writeRenderedOutput(
        projectRoot,
        output,
        templateRoot,
        {
          skill: manifest,
          answers: selected.answers
        },
        backup
      );
      created.push(targetPath);
    }
  }

  for (const selected of selectedHarnesses) {
    const manifest = harnesses.find((harness) => harness.id === selected.id);
    if (!manifest) continue;
    const templateRoot = resolveHarnessDir(registryRoot, manifest.id);
    for (const output of manifest.outputs) {
      const targetPath = await writeRenderedOutput(
        projectRoot,
        output,
        templateRoot,
        {
          harness: manifest
        },
        backup
      );
      created.push(targetPath);
    }
  }

  return created;
}

async function writeState(
  projectRoot: string,
  state: ManagerState,
  backup: BackupOptions
): Promise<string> {
  const statePath = path.join(projectRoot, "ai", "ai-manager.json");
  await writeJsonFile(statePath, state, backup);
  return statePath;
}

async function runInit(projectRoot: string, registryRoot: string, enableBackup: boolean) {
  const spinner = ora({ text: "Loading registry", color: "cyan" }).start();
  const registry = await loadRegistry(registryRoot);
  spinner.succeed("Registry loaded");

  const factsSpinner = ora({ text: "Scanning project", color: "cyan" }).start();
  const facts = await scanProjectFacts(projectRoot);
  factsSpinner.succeed("Project scanned");

  const selectedSkillIds = await selectSkills(registry.skills);
  const selectedSkills: SelectedSkill[] = [];
  for (const skillId of selectedSkillIds) {
    const skill = registry.skills.find((item) => item.id === skillId);
    if (!skill) continue;
    const answers = await askSkillQuestions(skill, projectRoot);
    selectedSkills.push({ id: skill.id, version: skill.version, answers });
  }
  const selectedHarnessIds = await selectHarnesses(registry.harnesses);

  const backup = buildBackupOptions(projectRoot, enableBackup);

  const renderSpinner = ora({ text: "Rendering files", color: "cyan" }).start();
  const createdFiles = await renderAll(
    projectRoot,
    registryRoot,
    registry.skills,
    registry.harnesses,
    selectedSkills,
    selectedHarnessIds.map((id) => ({
      id,
      version: registry.harnesses.find((harness) => harness.id === id)?.version ?? "unknown"
    })),
    backup
  );
  renderSpinner.succeed("Files generated");

  const now = new Date().toISOString();
  const state: ManagerState = {
    version: CURRENT_VERSION,
    createdAt: now,
    updatedAt: now,
    projectRoot,
    ...(facts ? { facts } : {}),
    skills: selectedSkills,
    harnesses: selectedHarnessIds.map((id) => ({
      id,
      version: registry.harnesses.find((harness) => harness.id === id)?.version ?? "unknown"
    }))
  };

  const statePath = await writeState(projectRoot, state, backup);

  const summary = new Table({
    head: [chalk.dim("Created / overwritten")],
    colWidths: [90],
    wordWrap: true
  });

  summary.push(...createdFiles.map((file) => [path.relative(projectRoot, file)]));
  summary.push([path.relative(projectRoot, statePath)]);

  console.log(summary.toString());
  console.log(`${ICONS.ok} ${chalk.green("Init complete.")} Try: ai-manager status`);
}

async function runSkillsAddRemove(
  projectRoot: string,
  registryRoot: string,
  action: "add" | "remove",
  enableBackup: boolean
) {
  const state = await findManagerState(projectRoot);
  if (!state) {
    console.log(`${ICONS.bad} ${chalk.red("Not initialized. Run ai-manager init.")}`);
    return;
  }
  const registry = await loadRegistry(registryRoot);
  const currentSkillIds = new Set(state.skills.map((skill) => skill.id));
  const choices = registry.skills.filter((skill) =>
    action === "add" ? !currentSkillIds.has(skill.id) : currentSkillIds.has(skill.id)
  );
  if (!choices.length) {
    console.log(`${ICONS.warn} ${chalk.yellow("No skills available.")}`);
    return;
  }
  const selected = await prompts({
    type: "multiselect",
    name: "values",
    message: action === "add" ? "Add skills" : "Remove skills",
    choices: choices.map((skill) => ({
      title: `${skill.name} (${skill.id})`,
      value: skill.id,
      description: skill.description
    }))
  });
  const selectedIds = (selected.values as string[]) ?? [];
  if (!selectedIds.length) {
    return;
  }
  let updatedSkills = state.skills.slice();
  const previousTargets = collectOutputTargets(
    registry.skills,
    registry.harnesses,
    state.skills.map((skill) => skill.id),
    state.harnesses.map((harness) => harness.id)
  );
  if (action === "add") {
    for (const skillId of selectedIds) {
      const manifest = registry.skills.find((skill) => skill.id === skillId);
      if (!manifest) continue;
      const answers = await askSkillQuestions(manifest, projectRoot);
      updatedSkills.push({ id: manifest.id, version: manifest.version, answers });
    }
  } else {
    updatedSkills = updatedSkills.filter((skill) => !selectedIds.includes(skill.id));
  }
  const backup = buildBackupOptions(projectRoot, enableBackup);
  if (action === "remove") {
    const nextTargets = collectOutputTargets(
      registry.skills,
      registry.harnesses,
      updatedSkills.map((skill) => skill.id),
      state.harnesses.map((harness) => harness.id)
    );
    const staleTargets = new Set(
      Array.from(previousTargets).filter((target) => !nextTargets.has(target))
    );
    await removeStaleOutputs(projectRoot, staleTargets, backup);
  }
  const createdFiles = await renderAll(
    projectRoot,
    registryRoot,
    registry.skills,
    registry.harnesses,
    updatedSkills,
    state.harnesses,
    backup
  );
  const now = new Date().toISOString();
  const nextState: ManagerState = {
    ...state,
    updatedAt: now,
    skills: updatedSkills
  };
  await writeState(projectRoot, nextState, backup);
  console.log(`${ICONS.ok} ${chalk.green("Skills updated.")}`);
  console.log(createdFiles.map((file) => `- ${path.relative(projectRoot, file)}`).join("\n"));
}

async function runHarnessesAddRemove(
  projectRoot: string,
  registryRoot: string,
  action: "add" | "remove",
  enableBackup: boolean
) {
  const state = await findManagerState(projectRoot);
  if (!state) {
    console.log(`${ICONS.bad} ${chalk.red("Not initialized. Run ai-manager init.")}`);
    return;
  }
  const registry = await loadRegistry(registryRoot);
  const currentHarnessIds = new Set(state.harnesses.map((harness) => harness.id));
  const choices = registry.harnesses.filter((harness) =>
    action === "add" ? !currentHarnessIds.has(harness.id) : currentHarnessIds.has(harness.id)
  );
  if (!choices.length) {
    console.log(`${ICONS.warn} ${chalk.yellow("No harnesses available.")}`);
    return;
  }
  const selected = await prompts({
    type: "multiselect",
    name: "values",
    message: action === "add" ? "Add harnesses" : "Remove harnesses",
    choices: choices.map((harness) => ({
      title: `${harness.name} (${harness.id})`,
      value: harness.id
    }))
  });
  const selectedIds = (selected.values as string[]) ?? [];
  if (!selectedIds.length) {
    return;
  }
  let updatedHarnesses = state.harnesses.slice();
  const previousTargets = collectOutputTargets(
    registry.skills,
    registry.harnesses,
    state.skills.map((skill) => skill.id),
    state.harnesses.map((harness) => harness.id)
  );
  if (action === "add") {
    updatedHarnesses = updatedHarnesses.concat(
      selectedIds.map((id) => ({
        id,
        version: registry.harnesses.find((harness) => harness.id === id)?.version ?? "unknown"
      }))
    );
  } else {
    updatedHarnesses = updatedHarnesses.filter((harness) => !selectedIds.includes(harness.id));
  }
  const backup = buildBackupOptions(projectRoot, enableBackup);
  if (action === "remove") {
    const nextTargets = collectOutputTargets(
      registry.skills,
      registry.harnesses,
      state.skills.map((skill) => skill.id),
      updatedHarnesses.map((harness) => harness.id)
    );
    const staleTargets = new Set(
      Array.from(previousTargets).filter((target) => !nextTargets.has(target))
    );
    await removeStaleOutputs(projectRoot, staleTargets, backup);
  }
  const createdFiles = await renderAll(
    projectRoot,
    registryRoot,
    registry.skills,
    registry.harnesses,
    state.skills,
    updatedHarnesses,
    backup
  );
  const now = new Date().toISOString();
  const nextState: ManagerState = {
    ...state,
    updatedAt: now,
    harnesses: updatedHarnesses
  };
  await writeState(projectRoot, nextState, backup);
  console.log(`${ICONS.ok} ${chalk.green("Harnesses updated.")}`);
  console.log(createdFiles.map((file) => `- ${path.relative(projectRoot, file)}`).join("\n"));
}

async function runDoctor(projectRoot: string): Promise<void> {
  const state = await findManagerState(projectRoot);
  console.log(HEADER);
  if (!state) {
    console.log(`${ICONS.bad} ${chalk.red("Not initialized.")}`);
    return;
  }
  const registry = await loadRegistry(resolveRegistryRoot());
  const rows: string[][] = [];
  rows.push(
    formatStatusRow(
      "Agents",
      await pathExists(path.join(projectRoot, "ai", "agents.md")),
      "/ai/agents.md"
    )
  );
  rows.push(
    formatStatusRow(
      "State",
      await pathExists(path.join(projectRoot, "ai", "ai-manager.json")),
      "/ai/ai-manager.json"
    )
  );
  for (const skill of state.skills) {
    const skillPath = path.join(projectRoot, "ai", "skills", `${skill.id}-skill.md`);
    rows.push(
      formatStatusRow(
        `Skill ${skill.id}`,
        await pathExists(skillPath),
        path.relative(projectRoot, skillPath)
      )
    );
  }
  for (const harness of state.harnesses) {
    const manifest = registry.harnesses.find((item) => item.id === harness.id);
    if (!manifest) {
      rows.push(formatStatusRow(`Harness ${harness.id}`, false, "Missing in registry"));
      continue;
    }
    for (const output of manifest.outputs) {
      const outputPath = path.join(projectRoot, output.target);
      rows.push(
        formatStatusRow(
          `Harness ${harness.id}`,
          await pathExists(outputPath),
          path.relative(projectRoot, outputPath)
        )
      );
    }
  }
  const table = new Table({
    head: [chalk.dim("Status"), chalk.dim("Item"), chalk.dim("Details")],
    colWidths: [6, 22, 60],
    wordWrap: true
  });
  table.push(...rows);
  console.log(table.toString());
}

const program = new Command();

program
  .name("ai-manager")
  .description("AI manager CLI")
  .version(CURRENT_VERSION, "-v, --version", "Display version");

program
  .command("status", { isDefault: true })
  .description("Show status")
  .action(async () => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await showStatus(projectRoot, resolveRegistryRoot());
  });

program
  .command("init")
  .description("Initialize ai-manager for this project")
  .option("--backup", "Create backups in /ai/.backups")
  .action(async (options: { backup?: boolean }) => {
    const projectRoot = await detectProjectRoot(process.cwd());
    const alreadyInited = await isInited(projectRoot);
    if (alreadyInited) {
      console.log(`${ICONS.warn} ${chalk.yellow("Already initialized.")}`);
      return;
    }
    await runInit(projectRoot, resolveRegistryRoot(), Boolean(options.backup));
  });

const skills = program.command("skills").description("Manage skills");

skills
  .command("list")
  .description("List available skills")
  .action(async () => {
    const registry = await loadRegistry(resolveRegistryRoot());
    console.log(HEADER);
    const table = new Table({
      head: [chalk.dim("Id"), chalk.dim("Name"), chalk.dim("Description")],
      colWidths: [18, 22, 60],
      wordWrap: true
    });
    registry.skills.forEach((skill) => {
      table.push([skill.id, skill.name, skill.description]);
    });
    console.log(table.toString());
  });

skills
  .command("add")
  .description("Add skills")
  .option("--backup", "Create backups in /ai/.backups")
  .action(async (options: { backup?: boolean }) => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await runSkillsAddRemove(projectRoot, resolveRegistryRoot(), "add", Boolean(options.backup));
  });

skills
  .command("remove")
  .description("Remove skills")
  .option("--backup", "Create backups in /ai/.backups")
  .action(async (options: { backup?: boolean }) => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await runSkillsAddRemove(projectRoot, resolveRegistryRoot(), "remove", Boolean(options.backup));
  });

const harnesses = program.command("harnesses").description("Manage harnesses");

harnesses
  .command("list")
  .description("List available harnesses")
  .action(async () => {
    const registry = await loadRegistry(resolveRegistryRoot());
    console.log(HEADER);
    const table = new Table({
      head: [chalk.dim("Id"), chalk.dim("Name")],
      colWidths: [18, 30],
      wordWrap: true
    });
    registry.harnesses.forEach((harness) => {
      table.push([harness.id, harness.name]);
    });
    console.log(table.toString());
  });

harnesses
  .command("add")
  .description("Add harnesses")
  .option("--backup", "Create backups in /ai/.backups")
  .action(async (options: { backup?: boolean }) => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await runHarnessesAddRemove(projectRoot, resolveRegistryRoot(), "add", Boolean(options.backup));
  });

harnesses
  .command("remove")
  .description("Remove harnesses")
  .option("--backup", "Create backups in /ai/.backups")
  .action(async (options: { backup?: boolean }) => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await runHarnessesAddRemove(
      projectRoot,
      resolveRegistryRoot(),
      "remove",
      Boolean(options.backup)
    );
  });

program
  .command("doctor")
  .description("Validate ai-manager setup")
  .action(async () => {
    const projectRoot = await detectProjectRoot(process.cwd());
    await runDoctor(projectRoot);
  });

program.hook("preAction", async () => {
  await maybeShowUpdatePrompt();
});

await program.parseAsync();
