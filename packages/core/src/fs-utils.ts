import fs from "node:fs/promises";
import path from "node:path";

export type BackupOptions = {
  enabled: boolean;
  backupRoot?: string;
};

function resolveBackupPath(targetPath: string, backupRoot: string): string {
  const parsed = path.parse(targetPath);
  const relative = path.isAbsolute(targetPath) ? targetPath.slice(parsed.root.length) : targetPath;
  return path.join(backupRoot, relative);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeFileAlways(
  targetPath: string,
  contents: string,
  backup: BackupOptions
): Promise<void> {
  const exists = await pathExists(targetPath);
  if (exists && backup.enabled && backup.backupRoot) {
    const backupPath = resolveBackupPath(targetPath, backup.backupRoot);
    await ensureDir(path.dirname(backupPath));
    const existing = await fs.readFile(targetPath);
    await fs.writeFile(backupPath, existing);
  }
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, contents, "utf8");
}

export async function backupExistingFile(targetPath: string, backup: BackupOptions): Promise<void> {
  if (!backup.enabled || !backup.backupRoot) {
    return;
  }
  const exists = await pathExists(targetPath);
  if (!exists) {
    return;
  }
  const backupPath = resolveBackupPath(targetPath, backup.backupRoot);
  await ensureDir(path.dirname(backupPath));
  const existing = await fs.readFile(targetPath);
  await fs.writeFile(backupPath, existing);
}

export async function writeJsonFile(
  targetPath: string,
  data: unknown,
  backup: BackupOptions
): Promise<void> {
  const contents = JSON.stringify(data, null, 2) + "\n";
  await writeFileAlways(targetPath, contents, backup);
}

export async function listDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
