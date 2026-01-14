import fs from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import { BackupOptions, writeFileAlways } from "./fs-utils.js";
import { OutputTemplate } from "./types.js";

export type TemplateContext = Record<string, unknown>;

export async function renderTemplateFile(
  templatePath: string,
  context: TemplateContext
): Promise<string> {
  const raw = await fs.readFile(templatePath, "utf8");
  const compiled = Handlebars.compile(raw, { noEscape: true });
  return compiled(context);
}

export async function writeRenderedOutput(
  projectRoot: string,
  output: OutputTemplate,
  templateRoot: string,
  context: TemplateContext,
  backup: BackupOptions
): Promise<string> {
  const templatePath = path.join(templateRoot, output.template);
  const targetPath = path.join(projectRoot, output.target);
  const contents = await renderTemplateFile(templatePath, context);
  await writeFileAlways(targetPath, contents, backup);
  return targetPath;
}
