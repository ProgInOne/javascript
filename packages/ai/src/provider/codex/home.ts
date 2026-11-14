import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The tutor-only CODEX_HOME (D-002, docs/design/ai-system.md#격리-설정-스레드-시작-옵션). The user's
// own Codex settings, MCP servers, skills and login are never shared; login happens in this home
// through `account/login/start`.

/**
 * `config.toml` of the tutor home: the exact feature-flag bundle validated in M1-A
 * (poc/codex-tutor/tutor-config.example.toml). `approval_policy = "untrusted"` is not accepted in
 * the file (0.155.1 exits), so the file says `on-request` and `thread/start` overrides it.
 */
export const TUTOR_CONFIG_TOML = `# Managed by ProgInOne. Rewritten on every start; do not edit.
approval_policy = "on-request"
sandbox_mode = "read-only"
web_search = "disabled"

# ProgInOne tutor: no tools of any kind. Official feature flags only.
[features]
apps = false
plugins = false
remote_plugin = false
plugin_sharing = false
multi_agent = false
image_generation = false
browser_use = false
browser_use_external = false
browser_use_full_cdp_access = false
computer_use = false
in_app_browser = false
shell_tool = false
unified_exec = false
view_image = false
skill_search = false
skill_mcp_dependency_install = false
tool_suggest = false
tool_call_mcp_elicitation = false
goals = false
hooks = false
sleep_tool = false
code_mode_host = false
`;

export interface TutorDirs {
  /** `<dataDir>/codex-home` */
  home: string;
  /** `<dataDir>/codex-workspace`: empty working directory of every thread. */
  workspace: string;
}

export interface PrepareResult {
  /** `config.toml` was missing or differed and was rewritten. */
  configRewritten: boolean;
  /** The workspace had files and was emptied. */
  workspaceCleared: boolean;
}

/**
 * Creates the tutor home with the expected `config.toml` (rewriting it when it differs) and an
 * empty workspace directory. Runs before every Codex start.
 */
export function prepareTutorDirs(dirs: TutorDirs): PrepareResult {
  mkdirSync(dirs.home, { recursive: true, mode: 0o700 });
  const configPath = join(dirs.home, 'config.toml');
  const current = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  const configRewritten = current !== TUTOR_CONFIG_TOML;
  if (configRewritten) writeFileSync(configPath, TUTOR_CONFIG_TOML, { mode: 0o600 });

  let workspaceCleared = false;
  if (existsSync(dirs.workspace) && readdirSync(dirs.workspace).length > 0) {
    rmSync(dirs.workspace, { recursive: true, force: true });
    workspaceCleared = true;
  }
  mkdirSync(dirs.workspace, { recursive: true });
  return { configRewritten, workspaceCleared };
}
