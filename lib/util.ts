import 'colors';
import { SyncTableEntry, FileStatus } from './syncTable';

/**
 * Escapes regexp special chars
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

/**
 * Trim trailing char
 */
export function chomp(str: string, char: string): string {
  return str.replace(new RegExp(escapeRegExp(char) + '+$'), '');
}

/**
 * Get relative path for display
 */
export function normalizedRelativePath(pathStr: string, root: string): string {
  let relative = pathStr.replace(new RegExp(escapeRegExp(root)), '').replace(/\\/g, '/');

  return relative === '' ? '(root dir)' : relative.substr(1);
}

/**
 * Display logs of dry run mode
 */
export function dryRunLog(displayName: string, stats: SyncTableEntry): void {
  let taskName = '';
  let task = stats.getTask();

  function label(stat: FileStatus): string {
    switch (stat) {
      case 'dir': return 'D'.cyan;
      case 'file': return 'F'.yellow;
      case 'ignore': return 'X'.gray;
      case 'error': return '!'.red;
      default: return ' ';
    }
  }

  if (stats.remote === 'error') {
    taskName = 'denied';
  } else if (task.removeRemote) {
    taskName = 'remove remote';
    if (task.method !== 'noop') {
      taskName += ' and ' + task.method;
    }
  } else if (task.method === 'noop') {
    taskName = 'ignore';
  } else {
    taskName = task.method;
  }

  console.log(`[ ${label(stats.local)} | ${label(stats.remote)} ] ` + displayName);
  console.log(`          -> ${taskName}`.magenta);
  console.log('');
}
