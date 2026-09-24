import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Logger, LogComponent } from "../utils/logger";

/**
 * Tunnel names flow into file names, YAML keys and systemd unit names, so only
 * a conservative character set is accepted.
 */
export const TUNNEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

/** File mode for generated files holding the tunnel token (owner read/write only). */
export const ENV_FILE_MODE = 0o600;
/** File mode for generated service/compose files (no secrets). */
export const SERVICE_FILE_MODE = 0o644;

/**
 * @returns an error message when the name is unsafe to use in generated files, else null
 */
export function tunnelNameError(name: string): string | null {
  if (TUNNEL_NAME_PATTERN.test(name)) {
    return null;
  }
  return "Tunnel name must start with a letter or digit and contain only letters, digits, '-' and '_' (max 63 characters)";
}

/**
 * @throws Error when the tunnel name is unsafe to use in generated files
 */
export function assertValidTunnelName(name: string): void {
  const message = tunnelNameError(name);
  if (message) {
    throw new Error(`${message}: "${name}"`);
  }
}

/**
 * Resolves a file name against the workspace root and confirms the result stays inside it.
 * @throws Error when the resolved path escapes the workspace
 */
export function resolveInsideWorkspace(workspaceRoot: string, fileName: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, fileName);
  const relative = path.relative(root, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside the workspace: ${fileName}`);
  }
  return resolved;
}

/**
 * Writes a file with the given mode. `mode` only applies when a file is created,
 * so an existing file is chmod-ed as well.
 */
function writeFileWithMode(filePath: string, content: string, mode: number): void {
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

/**
 * Writes the service/compose file and its token-bearing env file into the workspace.
 * The env file is created with mode 0o600.
 */
export function writeServiceFiles(
  workspaceRoot: string,
  files: {
    serviceFileName: string;
    serviceContent: string;
    envFileName: string;
    envContent: string;
  },
): { servicePath: string; envPath: string } {
  const servicePath = resolveInsideWorkspace(workspaceRoot, files.serviceFileName);
  const envPath = resolveInsideWorkspace(workspaceRoot, files.envFileName);
  writeFileWithMode(servicePath, files.serviceContent, SERVICE_FILE_MODE);
  writeFileWithMode(envPath, files.envContent, ENV_FILE_MODE);
  return { servicePath, envPath };
}

/**
 * @returns the nearest directory at or above `startDir` that contains `.git`, or undefined
 */
export function findGitRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * @returns true if `workspaceRoot/.gitignore` has a line naming exactly this file
 */
export function gitignoreListsFile(workspaceRoot: string, fileName: string): boolean {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return false;
  }
  const lines = fs
    .readFileSync(gitignorePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim());
  return lines.includes(fileName) || lines.includes(`/${fileName}`);
}

/**
 * Asks git whether the file is ignored; falls back to reading the workspace
 * `.gitignore` when git is unavailable.
 */
export function isIgnoredByGit(workspaceRoot: string, filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    cp.execFile(
      "git",
      ["check-ignore", "-q", "--", filePath],
      { cwd: workspaceRoot },
      (error) => {
        if (!error) {
          resolve(true);
          return;
        }
        // Exit status 1 means "not ignored"; anything else (no git, not a repo) falls back
        if ((error as { code?: unknown }).code === 1) {
          resolve(false);
          return;
        }
        resolve(gitignoreListsFile(workspaceRoot, path.basename(filePath)));
      },
    );
  });
}

/**
 * Appends an anchored entry for the file to `workspaceRoot/.gitignore`, creating it if needed.
 */
export function appendGitignoreEntry(workspaceRoot: string, fileName: string): void {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, "utf8")
    : "";
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(
    gitignorePath,
    `${separator}# Tunnelfy: contains a Cloudflare tunnel token\n/${fileName}\n`,
  );
}

/**
 * When the workspace is inside a git repository and the env file is not ignored,
 * warns the user and offers to add it to `.gitignore`.
 */
export async function offerGitignoreEntry(
  workspaceRoot: string,
  envPath: string,
): Promise<void> {
  const logger = Logger.getInstance();
  try {
    if (!findGitRoot(workspaceRoot)) {
      return;
    }
    if (await isIgnoredByGit(workspaceRoot, envPath)) {
      return;
    }
    const envFileName = path.basename(envPath);
    const addButton = "Add to .gitignore";
    const choice = await vscode.window.showWarningMessage(
      `${envFileName} contains your tunnel token and is not ignored by git. Add it to .gitignore so it is never committed?`,
      addButton,
      "Not now",
    );
    if (choice === addButton) {
      appendGitignoreEntry(workspaceRoot, envFileName);
      logger.info(LogComponent.EXTENSION, `Added ${envFileName} to .gitignore`);
    }
  } catch (error) {
    logger.error(
      LogComponent.EXTENSION,
      `Failed to check .gitignore for generated env file: ${error}`,
    );
  }
}
