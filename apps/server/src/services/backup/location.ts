import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import {
  BACKUP_KINDS,
  isCloudSyncedPath,
  type BackupLocation,
  type BackupLocationChange,
} from '@proginone/shared';
import { writeConfigValue } from '../../config/file.ts';
import { AppError } from '../../http/errors.ts';
import type { Logger } from '../../observability/logger.ts';
import { toSummary, type BackupService } from './service.ts';

/** Why a requested backup folder was refused (`BACKUP_LOCATION_INVALID.details.reason`). */
export type LocationProblem =
  | 'invalid-characters'
  | 'not-absolute'
  | 'traversal'
  | 'root'
  | 'contains-data'
  | 'symlink'
  | 'not-directory'
  | 'parent-missing'
  | 'not-empty'
  | 'not-writable';

const MESSAGES: Record<LocationProblem, string> = {
  'invalid-characters': '폴더 경로에 쓸 수 없는 문자가 있습니다.',
  'not-absolute': '전체 경로를 입력하세요. 예: /Users/me/Backups 또는 ~/Backups',
  traversal: "경로에 '..'을 쓸 수 없습니다. 전체 경로를 그대로 입력하세요.",
  root: '디스크의 최상위 폴더는 백업 위치로 쓸 수 없습니다.',
  'contains-data': '학습 데이터 폴더나 그 상위 폴더는 백업 위치로 쓸 수 없습니다.',
  symlink: '바로 가기(심볼릭 링크)가 아닌 실제 폴더를 고르세요.',
  'not-directory': '파일이 아닌 폴더를 고르세요.',
  'parent-missing': '상위 폴더가 없습니다. 이미 있는 폴더 안의 새 폴더나 기존 폴더를 고르세요.',
  'not-empty': '비어 있는 폴더나 기존 ProgInOne 백업 폴더를 고르세요.',
  'not-writable': '이 폴더에 백업을 쓸 수 없습니다. 권한과 남은 공간을 확인하세요.',
};

const invalid = (reason: LocationProblem, cause?: unknown) =>
  new AppError('BACKUP_LOCATION_INVALID', 400, MESSAGES[reason], {
    details: { reason },
    ...(cause === undefined ? {} : { cause }),
  });

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex

/** True when `child` is `parent` or inside it. */
const within = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));

/** Entries a backup folder may already hold: the kind subfolders and OS metadata files. */
const ALLOWED_ENTRIES = new Set<string>([...BACKUP_KINDS, '.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface ResolvedDir {
  /** Canonical absolute path (symlinked parents resolved). */
  path: string;
  /** The folder does not exist yet; its parent does. */
  create: boolean;
}

/**
 * Turns an untrusted folder path from the client into a canonical, safe backup folder
 * (docs/design/data-model.md#백업-위치-변경, D-045). Only checks; never writes.
 * - absolute (`~` allowed for the home folder), no control characters, no `..` segments;
 * - the folder itself must not be a symlink; symlinked parents are resolved, so the stored path
 *   is where the files really go;
 * - not a filesystem root, not the data folder or one of its ancestors;
 * - an existing folder must be empty or already a ProgInOne backup folder; a new folder needs an
 *   existing parent (no deep trees from a typo).
 */
export function resolveBackupDir(
  input: string,
  { dataDir, home = homedir() }: { dataDir: string; home?: string },
): ResolvedDir {
  const raw = input.trim();
  if (raw === '' || CONTROL_CHARS.test(raw)) throw invalid('invalid-characters');
  const expanded = raw === '~' ? home : /^~[/\\]/.test(raw) ? join(home, raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) throw invalid('not-absolute');
  if (expanded.split(/[/\\]+/).includes('..')) throw invalid('traversal');
  const normalized = resolve(expanded);

  let path: string;
  let create: boolean;
  const stat = lstatSync(normalized, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink()) throw invalid('symlink');
    if (!stat.isDirectory()) throw invalid('not-directory');
    path = realpathSync(normalized);
    create = false;
  } else {
    const parent = dirname(normalized);
    const parentStat = lstatSync(parent, { throwIfNoEntry: false });
    if (!parentStat) throw invalid('parent-missing');
    // A symlinked parent is fine (macOS /tmp, /var); it is resolved below.
    if (!realStat(parent)?.isDirectory()) throw invalid('not-directory');
    path = join(realpathSync(parent), basename(normalized));
    create = true;
  }

  if (parse(path).root === path) throw invalid('root');
  if (within(real(dataDir), path)) throw invalid('contains-data');
  if (!create && !readdirSync(path).every((name) => ALLOWED_ENTRIES.has(name))) {
    throw invalid('not-empty');
  }
  return { path, create };
}

function realStat(path: string) {
  try {
    return lstatSync(realpathSync(path));
  } catch {
    return undefined;
  }
}

export interface BackupLocationDeps {
  backups: BackupService;
  dataDir: string;
  /** `<dataDir>/backups`. */
  defaultDir: string;
  /** `PROGINONE_BACKUP_DIR` is set: the folder is fixed for this process. */
  fixedByEnv: boolean;
  log: Logger;
  home?: string;
}

/** `GET/PUT /backups/location` (FR-SET-05). The choice is saved as `backupDir` in config.json. */
export class BackupLocationService {
  readonly #d: BackupLocationDeps;

  constructor(deps: BackupLocationDeps) {
    this.#d = deps;
  }

  get(): BackupLocation {
    const { backups, defaultDir, fixedByEnv } = this.#d;
    const path = backups.backupDir;
    const isDefault = real(path) === real(defaultDir);
    return {
      path,
      defaultPath: defaultDir,
      source: fixedByEnv ? 'env' : isDefault ? 'default' : 'config',
      editable: !fixedByEnv,
      cloudSynced: isCloudSyncedPath(path),
    };
  }

  async change(input: string): Promise<BackupLocationChange> {
    const { backups, dataDir, defaultDir, fixedByEnv, log, home } = this.#d;
    if (fixedByEnv) {
      throw new AppError(
        'BACKUP_LOCATION_LOCKED',
        409,
        '백업 위치가 환경 변수 PROGINONE_BACKUP_DIR로 정해져 있어 여기서 바꿀 수 없습니다.',
      );
    }
    const target = resolveBackupDir(input, { dataDir, ...(home ? { home } : {}) });
    const previousPath = backups.backupDir;
    if (target.create) {
      try {
        mkdirSync(target.path, { mode: 0o700 });
      } catch (e) {
        throw invalid('not-writable', e);
      }
    }
    let entry;
    try {
      entry = await backups.relocate(target.path);
    } catch (e) {
      if (target.create) rmSync(target.path, { recursive: true, force: true });
      throw invalid('not-writable', e);
    }
    try {
      const isDefault = real(target.path) === real(defaultDir);
      writeConfigValue(dataDir, 'backupDir', isDefault ? undefined : target.path);
    } catch (e) {
      await backups.useDir(previousPath);
      log.error({ err: e }, 'could not save backupDir to config.json');
      throw new AppError('BACKUP_FAILED', 500, '백업 위치를 설정 파일에 저장하지 못했습니다.', {
        cause: e,
      });
    }
    log.info({ from: previousPath, to: target.path }, 'backup location changed');
    return {
      location: this.get(),
      previousPath,
      backup: toSummary(entry),
    };
  }
}
