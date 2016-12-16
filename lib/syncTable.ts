import * as minimatch from 'minimatch';
import * as path from 'path';
import * as util from './util';

export type FileStatus = 'file' | 'dir' | 'ignore' | 'error';
export type TaskType = 'upload' | 'sync' | 'noop';

export interface SyncTask {
  method: TaskType;
  removeRemote: boolean;
  hasError: boolean;
}

export class SyncTableEntry {
  localPath: string;
  remotePath: string;
  localStat: FileStatus = null;
  remoteStat: FileStatus = null;
  task: SyncTask;

  constructor(
    private table: SyncTable,
    public name: string
  ) {
    this.localPath = table.localPath + path.sep + name;
    this.remotePath = table.remotePath + '/' + name;
  }

  /**
   * Get a task for this entry
   */
  getTask(): SyncTask {
    if (this.task) {
      return this.task;
    }

    let task: SyncTask = {method: undefined, removeRemote: false, hasError: false};

    if (this.localStat === 'error' || this.remoteStat === 'error') {
      task.hasError = true;
    }

    if (this.remoteStat !== null && !task.hasError &&
      (!this.localStat || this.localStat === 'ignore' || this.localStat !== this.remoteStat)) {
      task.removeRemote = true;
    }

    if (this.localStat === 'ignore' || task.hasError) {
      task.method = 'noop';
    } else if (this.localStat === 'file') {
      task.method = 'upload';
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
    let displayName = this.getRelativePath();

    if (task.removeRemote) {
      if (this.remoteStat === 'dir') {
        console.log(' remote dir removed : '.red + displayName);
      } else {
        console.log('remote file removed : '.red + displayName);
      }
    } else if (task.hasError) {
      console.log(`              error : ${displayName}`.bgRed);
    } else if (task.method === 'noop') {
      console.log('            ignored : '.gray + displayName);
    }

    if (task.method === 'sync') {
      console.log('     sync completed : '.cyan + displayName);
    } else if (task.method === 'upload') {
      console.log('      file uploaded : '.yellow + displayName);
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
        case 'dir': return 'D'.cyan;
        case 'file': return 'F'.yellow;
        case 'ignore': return 'X'.gray;
        case 'error': return '!'.red;
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
    } else if (task.method === 'noop') {
      taskName = 'ignore';
    } else {
      taskName = task.method;
    }

    console.log(`[ ${label(this.localStat)} | ${label(this.remoteStat)} ] ${this.getRelativePath()}`);
    console.log(`          -> ${taskName}`.magenta);
    console.log('');
  }

  /**
   * Check if the path matches the exclude patterns
   */
  detectExclusion(patterns: string[]) {
    let pathForMatch = this.getRelativePath();

    if (this.localStat === 'dir') {
      pathForMatch += '/';
    }

    if (patterns.some(pattern => minimatch(pathForMatch, pattern))) {
      this.localStat = 'ignore';
    }
  }

  /**
   * Get a path string relative to project root
   */
  getRelativePath(): string {
    return this.remotePath.replace(new RegExp(util.escapeRegExp(this.table.remoteRoot)), '').substr(1);
  }
}

export class SyncTable {
  private registry: SyncTableEntry[] = [];

  constructor(
    public localPath: string,
    public remotePath: string,
    public localRoot?: string,
    public remoteRoot?: string
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

  forEach(fn: (stat: SyncTableEntry, filename: string) => void) {
    for (let name in this.registry) {
      fn(this.registry[name], name);
    }
  }
}
