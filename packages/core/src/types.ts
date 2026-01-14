import { z } from "zod";

export const QuestionTypeSchema = z.enum(["input", "select", "path"]);

export const QuestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: QuestionTypeSchema,
  required: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  validation: z
    .object({
      pattern: z.string().optional(),
      message: z.string().optional()
    })
    .optional()
});

export const OutputTemplateSchema = z.object({
  target: z.string(),
  template: z.string()
});

export const SkillManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  questions: z.array(QuestionSchema).default([]),
  outputs: z.array(OutputTemplateSchema).default([]),
  agentsSnippetTemplate: z.string(),
  activationRulesTemplate: z.string().optional()
});

export const HarnessManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  outputs: z.array(OutputTemplateSchema).default([])
});

export type Question = z.infer<typeof QuestionSchema>;
export type OutputTemplate = z.infer<typeof OutputTemplateSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type HarnessManifest = z.infer<typeof HarnessManifestSchema>;

export type SkillAnswerMap = Record<string, string>;

export type SelectedSkill = {
  id: string;
  version: string;
  answers: SkillAnswerMap;
};

export type SelectedHarness = {
  id: string;
  version: string;
};

export type ManagerState = {
  version: string;
  createdAt: string;
  updatedAt: string;
  projectRoot: string;
  facts?: {
    packageManager?: string;
    tsconfigPaths?: string[];
    directories?: string[];
  };
  skills: SelectedSkill[];
  harnesses: SelectedHarness[];
};
