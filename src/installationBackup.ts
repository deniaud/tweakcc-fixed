import fs from 'node:fs/promises';

import {
  CLIJS_BACKUP_FILE,
  ensureConfigDir,
  NATIVE_BINARY_BACKUP_FILE,
  updateConfigFile,
} from './config';
import { clearAllAppliedHashes } from './systemPromptHashIndex';
import {
  debug,
  replaceFileBreakingHardLinks,
  doesFileExist,
  fileContainsAnyMarker,
} from './utils';
import { ClaudeCodeInstallationInfo } from './types';

// ASCII markers that only ever appear in a tweakcc- or cc-quote-PATCHED native
// CC bundle, never in a pristine one (`__tweakcc*` = tweakcc's injected globals,
// e.g. the complexity router; `__cc_citations__` = cc-quote). Presence of any
// one means the binary is already patched and must NOT be enshrined as the
// "pristine" backup. Note: not every tweakcc config injects `__tweakcc*`, so
// this is a best-effort detector for the common stack — the build-update
// pipeline's post-apply size assertion is the catch-all backstop.
const PATCH_MARKERS = ['__tweakcc', '__cc_citations__'];

/**
 * Returns true if the file at `path` carries tweakcc/cc-quote patch markers.
 * Callers use this to avoid overwriting a good pristine backup with a patched
 * binary (which would poison `--restore` and silently compound native repacks).
 */
export const isNativeBinaryPatched = async (path: string): Promise<boolean> =>
  fileContainsAnyMarker(path, PATCH_MARKERS);

// Copy a file into place atomically: copy to a sibling temp, then rename onto
// the destination. rename(2) is atomic within a filesystem, so a crash mid-copy
// leaves only a temp file — never a truncated backup that would later be trusted
// and restored as if it were pristine (F-72).
const atomicCopyFile = async (src: string, dest: string): Promise<void> => {
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, dest);
  } catch (error) {
    try {
      await fs.unlink(tmp);
    } catch {
      // best-effort temp cleanup; ignore
    }
    throw error;
  }
};

export const backupClijs = async (ccInstInfo: ClaudeCodeInstallationInfo) => {
  // Only backup cli.js for NPM installs (when cliPath is set)
  if (!ccInstInfo.cliPath) {
    debug('backupClijs: Skipping for native installation (no cliPath)');
    return;
  }

  await ensureConfigDir();
  debug(`Backing up cli.js to ${CLIJS_BACKUP_FILE}`);
  await atomicCopyFile(ccInstInfo.cliPath, CLIJS_BACKUP_FILE);
  await updateConfigFile(config => {
    config.changesApplied = false;
    config.ccVersion = ccInstInfo.version;
  });
};

/**
 * Backs up the native installation binary to the config directory.
 */
export const backupNativeBinary = async (
  ccInstInfo: ClaudeCodeInstallationInfo
) => {
  if (!ccInstInfo.nativeInstallationPath) {
    return;
  }

  // Fail-closed invariant: the pristine backup must never contain a patched
  // binary. If the source already carries our patch markers, refuse — backing
  // it up as "pristine" would make `--restore` return a patched binary, and the
  // next `--apply` would stack patches onto it (an extra repack → runaway
  // bloat, the 705 MB incident). Callers should pre-check with
  // isNativeBinaryPatched to preserve any existing good backup rather than
  // reach this throw.
  if (await isNativeBinaryPatched(ccInstInfo.nativeInstallationPath)) {
    throw new Error(
      `Refusing to back up ${ccInstInfo.nativeInstallationPath} as pristine: ` +
        'it carries tweakcc/cc-quote patch markers. Reinstall stock Claude Code ' +
        '(e.g. `claude update` or a fresh version dir), then retry.'
    );
  }

  await ensureConfigDir();
  debug(`Backing up native binary to ${NATIVE_BINARY_BACKUP_FILE}`);
  await atomicCopyFile(
    ccInstInfo.nativeInstallationPath,
    NATIVE_BINARY_BACKUP_FILE
  );
  await updateConfigFile(config => {
    config.changesApplied = false;
    config.ccVersion = ccInstInfo.version;
  });
};

/**
 * Restores the original cli.js file from the backup.
 * Only applies to NPM installs. For native installs, this is a no-op.
 */
export const restoreClijsFromBackup = async (
  ccInstInfo: ClaudeCodeInstallationInfo
): Promise<boolean> => {
  // Only restore cli.js for NPM installs (when cliPath is set)
  if (!ccInstInfo.cliPath) {
    debug(
      'restoreClijsFromBackup: Skipping for native installation (no cliPath)'
    );
    return false;
  }

  if (!(await doesFileExist(CLIJS_BACKUP_FILE))) {
    debug('restoreClijsFromBackup: No backup file exists, skipping');
    return false;
  }

  debug(`Restoring cli.js from backup to ${ccInstInfo.cliPath}`);

  // Read the backup content
  const backupContent = await fs.readFile(CLIJS_BACKUP_FILE);

  // Replace the file, breaking hard links and preserving permissions
  await replaceFileBreakingHardLinks(
    ccInstInfo.cliPath,
    backupContent,
    'restore'
  );

  // Clear all applied hashes since we're restoring to defaults
  await clearAllAppliedHashes();

  await updateConfigFile(config => {
    config.changesApplied = false;
  });

  return true;
};

/**
 * Restores the native installation binary from backup.
 * This function restores the original native binary and clears changesApplied,
 * so patches can be re-applied from a clean state.
 */
export const restoreNativeBinaryFromBackup = async (
  ccInstInfo: ClaudeCodeInstallationInfo
): Promise<boolean> => {
  if (!ccInstInfo.nativeInstallationPath) {
    debug(
      'restoreNativeBinaryFromBackup: No native installation path, skipping'
    );
    return false;
  }

  if (!(await doesFileExist(NATIVE_BINARY_BACKUP_FILE))) {
    debug('restoreNativeBinaryFromBackup: No backup file exists, skipping');
    return false;
  }

  debug(
    `Restoring native binary from backup to ${ccInstInfo.nativeInstallationPath}`
  );

  // Read the backup content
  const backupContent = await fs.readFile(NATIVE_BINARY_BACKUP_FILE);

  // Replace the file, breaking hard links and preserving permissions
  await replaceFileBreakingHardLinks(
    ccInstInfo.nativeInstallationPath,
    backupContent,
    'restore'
  );

  return true;
};
