// Startup verification of the tutor home's feature flags with `codex features list`
// (D-002 확정 조건, docs/design/ai-system.md#남은-항목 2). Two lists:
// - REQUIRED_OFF: tool features the bundle turns off; any of them on → tutor disabled.
// - ALLOWED_ON: features observed enabled under the validated bundle (codex-cli 0.155.1) that are
//   not tools the model can call. Any other enabled feature is unknown → tutor disabled, so a
//   Codex update that turns on a new capability cannot silently reach the tutor.

/** Tool features the tutor bundle turns off. */
export const REQUIRED_OFF = [
  'apps',
  'plugins',
  'remote_plugin',
  'plugin_sharing',
  'multi_agent',
  'multi_agent_v2',
  'image_generation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'shell_tool',
  'view_image',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'tool_call_mcp_elicitation',
  'goals',
  'hooks',
  'sleep_tool',
  'code_mode_host',
  'code_mode',
  'memories',
  'standalone_web_search',
  'web_search_request',
  'web_search_cached',
] as const;

/**
 * Enabled under the validated bundle and accepted. `unified_exec` (and its tty variant) cannot be
 * turned off in 0.155.1 even though the bundle sets it false (M1-A F2); no call was observed and
 * it stays behind the other layers: approval auto-deny, read-only sandbox, empty cwd and the
 * tool-item interrupt.
 */
export const ALLOWED_ON = [
  'auth_elicitation',
  'collaboration_modes',
  'compaction_image_budget',
  'content_item_kinds',
  'enable_request_compression',
  'fast_mode',
  'guardian_approval',
  'in_app_chat',
  'in_app_dictation',
  'in_app_local_automation',
  'in_app_updates',
  'item_ids',
  'mentions_v2',
  'personality',
  'resize_all_images',
  'shell_snapshot',
  'sqlite',
  'steer',
  'terminal_resize_reflow',
  'tool_search_always_defer_mcp_tools',
  'tui_app_server',
  'unbounded_connection_retries',
  'unified_exec',
  'unified_exec_tty',
  'unified_exec_zsh_fork',
  'workspace_dependencies',
] as const;

export interface FeatureFlag {
  name: string;
  stage: string;
  enabled: boolean;
}

/** Parses `codex features list` output: `<name> <stage words…> <true|false>` per line. */
export function parseFeatureList(output: string): FeatureFlag[] {
  const flags: FeatureFlag[] = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const name = parts[0] ?? '';
    const last = parts[parts.length - 1];
    if (!/^[a-z0-9_.]+$/.test(name) || (last !== 'true' && last !== 'false')) continue;
    flags.push({ name, stage: parts.slice(1, -1).join(' '), enabled: last === 'true' });
  }
  return flags;
}

/**
 * Problems with the effective flags (empty = verified). Messages are Korean and shown in the
 * `isolation_failed` status.
 */
export function verifyFeatureFlags(flags: readonly FeatureFlag[]): string[] {
  if (flags.length === 0) return ['Codex 기능 플래그 목록을 읽지 못했습니다.'];
  const problems: string[] = [];
  const byName = new Map(flags.map((f) => [f.name, f]));
  for (const name of REQUIRED_OFF) {
    if (byName.get(name)?.enabled) problems.push(`도구 기능 '${name}'이(가) 켜져 있습니다.`);
  }
  const required = new Set<string>(REQUIRED_OFF);
  const allowed = new Set<string>(ALLOWED_ON);
  for (const f of flags) {
    if (f.enabled && !required.has(f.name) && !allowed.has(f.name)) {
      problems.push(`알 수 없는 기능 '${f.name}'(${f.stage})이(가) 켜져 있습니다.`);
    }
  }
  return problems;
}
