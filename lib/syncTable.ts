import * as minimatch from 'minimatch';
import chalk from 'chalk';
import * as path from 'path';
import { SftpSyncOptions } from './config';

export type FileStatus = 'file' | 'dir' | 'excluded' | 'error';
export type TaskType = 'upload' | 'sync' | 'noop';

export interface SyncTask {
  method: TaskType;
  removeRemote: boolean;
  hasError: boolean;
  skip: boolean;
}

export class SyncTableEntry {
  path: string;
  localStat: FileStatus = null;
  remoteStat: FileStatus = null;
  localTimestamp: number = null;
  remoteTimestamp: number = null;
  task: SyncTask;

  constructor(
    private table: SyncTable,
    public name: string
  ) {
    this.path = path.posix.join(table.relativePath || '.', name);
  }

  /**
   * Get a task for this entry
   */
  getTask(): SyncTask {
    if (this.task) {
      return this.task;
    }

    let task: SyncTask = {method: undefined, removeRemote: false, hasError: false, skip: false};
    let options = this.table.options;

    if (this.localStat === 'error' || this.remoteStat === 'error') {
      task.hasError = true;
    }

    if (this.remoteStat !== null && !task.hasError && this.localStat !== this.remoteStat && options.removeExtraFiles) {
      task.removeRemote = true;
    }

    if (this.localStat === 'excluded' && options.excludeMode === 'ignore') {
      task.removeRemote = false;
    }

    if (this.localStat === 'excluded' || task.hasError) {
      task.method = 'noop';
    } else if (this.localStat === 'file') {
      if (!options.forceUpload && this.localTimestamp <= this.remoteTimestamp) {
        task.skip = true;
        task.method = 'noop';
      } else {
        task.method = 'upload';
      }
    } else if (this.localStat === 'dir') {
      task.method = 'sync';
    } else {
      task.method = 'noop';
    }

    return this.task = task;
  }

  /**
   * Output live run mode log
   */
  liveRunLog(): void {
    let task = this.getTask();
    let displayName = this.path;

    if (task.removeRemote) {
      if (this.remoteStat === 'dir') {
        console.log(chalk.red(' remote dir removed : ') + displayName);
      } else {
        console.log(chalk.red('remote file removed : ') + displayName);
      }
    } else if (task.hasError) {
      console.log(chalk.bgRed(`              error : ${displayName}`));
    } else if (task.skip) {
      console.log(chalk.gray('            skipped : ') + displayName);
    } else if (task.method === 'noop') {
      console.log(chalk.gray('            ignored : ') + displayName);
    }

    if (task.method === 'sync') {
      console.log(chalk.cyan('     sync completed : ') + displayName);
    } else if (task.method === 'upload') {
      console.log(chalk.yellow('      file uploaded : ') + displayName);
    }
  }

  /**
   * Output dry run mode log
   */
  dryRunLog(): void {
    let taskName = '';
    let task = this.getTask();

    function label(stat: FileStatus): string {
      switch (stat) {
        case 'dir': return chalk.cyan('D');
        case 'file': return chalk.yellow('F');
        case 'excluded': return chalk.gray('X');
        case 'error': return chalk.red('!');
        default: return ' ';
      }
    }

    if (this.remoteStat === 'error') {
      taskName = 'denied';
    } else if (task.removeRemote) {
      taskName = 'remove remote';
      if (task.method !== 'noop') {
        taskName += ' and ' + task.method;
      }
    } else if (task.skip) {
      taskName = 'skip';
    } else if (task.method === 'noop') {
      taskName = 'ignore';
    } else {
      taskName = task.method;
    }

    console.log(`[ ${label(this.localStat)} | ${label(this.remoteStat)} ] ${this.path}`);
    console.log(chalk.magenta(`          -> ${taskName}`));
    console.log('');
  }

  /**
   * Check if the path matches the exclude patterns
   */
  detectExclusion() {
    let pathForMatch = this.path;
    let patterns = this.table.options.exclude;

    if (this.localStat === 'dir') {
      pathForMatch += path.posix.sep;
    }

    if (patterns.some(pattern => minimatch(pathForMatch, pattern))) {
      this.localStat = 'excluded';
    }
  }
}

export class SyncTable {
  private registry: SyncTableEntry[] = [];

  constructor(
    public relativePath: string,
    public options: SftpSyncOptions
  ) {}

  get(filename: string): SyncTableEntry {
    return this.registry.find(e => e.name === filename);
  }

  get all(): SyncTableEntry[] {
    return this.registry;
  }

  set(filename: string, stats: Object): SyncTableEntry {
    let entry = this.get(filename);
    let isNew = false;

    if (!entry) {
      entry = new SyncTableEntry(this, filename);
      isNew = true;
    }

    Object.assign(entry, stats);

    if (isNew) {
      this.registry.push(entry);
    }

    return entry;
  }

  has(filename: string): boolean {
    return this.registry.some(e => e.name === filename);
  }

  forEach(fn: (stat: SyncTableEntry) => void): SyncTable {
    this.registry.forEach(fn);
    return this;
  }
}
