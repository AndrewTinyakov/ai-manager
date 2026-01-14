import path from "node:path";
import { renderTemplateFile } from "./renderer.js";
import { SkillManifest } from "./types.js";

export type AgentsAssemblyInput = {
  projectName: string;
  harnesses: string[];
  skills: SkillManifest[];
  selectedSkillIds: string[];
  skillAnswers: Record<string, Record<string, string>>;
  registryRoot: string;
};

function buildSkillIndexTable(skills: SkillManifest[]): string {
  if (skills.length === 0) {
    return "No skills selected.";
  }
  const rows = skills.map((skill) => `| ${skill.id} | ${skill.name} | ${skill.description} |`);
  return ["| Id | Name | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

export async function buildAgentsMarkdown(input: AgentsAssemblyInput): Promise<string> {
  const selectedSkills = input.skills.filter((skill) => input.selectedSkillIds.includes(skill.id));
  const plannerSkill = selectedSkills.find((skill) => skill.id === "planner");
  const guideSkills = selectedSkills.filter((skill) => skill.id !== "planner");

  const snippets = await Promise.all(
    guideSkills.map(async (skill) => {
      const templatePath = path.join(
        input.registryRoot,
        "skills",
        skill.id,
        skill.agentsSnippetTemplate
      );
      const context = {
        skill,
        answers: input.skillAnswers[skill.id] ?? {}
      };
      return renderTemplateFile(templatePath, context);
    })
  );

  const activationRules = await Promise.all(
    selectedSkills
      .filter((skill) => skill.activationRulesTemplate)
      .map(async (skill) => {
        const templatePath = path.join(
          input.registryRoot,
          "skills",
          skill.id,
          skill.activationRulesTemplate ?? ""
        );
        const context = {
          skill,
          answers: input.skillAnswers[skill.id] ?? {}
        };
        return renderTemplateFile(templatePath, context);
      })
  );

  let planSection = "";
  if (plannerSkill) {
    const templatePath = path.join(
      input.registryRoot,
      "skills",
      plannerSkill.id,
      plannerSkill.agentsSnippetTemplate
    );
    planSection = await renderTemplateFile(templatePath, { skill: plannerSkill, answers: {} });
  }

  const baseTemplatePath = path.join(input.registryRoot, "templates", "agents.base.md.hbs");
  const templateContext = {
    projectName: input.projectName,
    harnessNotes: input.harnesses.length
      ? input.harnesses.map((harness) => `- ${harness}`).join("\n")
      : "- None",
    planSection,
    skillIndexTable: buildSkillIndexTable(selectedSkills),
    skillGuides: snippets.join("\n\n"),
    activationRules: activationRules.join("\n\n")
  };

  return renderTemplateFile(baseTemplatePath, templateContext);
}
