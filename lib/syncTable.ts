export type FileStatus = 'file' | 'dir' | 'ignore' | 'error';
export type TaskType = 'upload' | 'sync' | 'noop';

export interface SyncTask {
  method: TaskType;
  removeRemote: boolean;
}

export class SyncTableEntry {
  local: FileStatus = null;
  remote: FileStatus = null;
  task: SyncTask;

  constructor(public name: string) {}

  getTask(): SyncTask {
    if (this.task) {
      return this.task;
    }

    let task: SyncTask = {method: undefined, removeRemote: false};

    if ((this.remote !== null && this.remote !== 'error') &&
      (!this.local || this.local === 'ignore' || this.local !== this.remote)) {
      task.removeRemote = true;
    }

    if (this.local === 'ignore' || this.remote === 'error') {
      task.method = 'noop';
    } else if (this.local === 'file') {
      task.method = 'upload';
    } else if (this.local === 'dir') {
      task.method = 'sync';
    } else {
      task.method = 'noop';
    }

    return this.task = task;
  }
}

export class SyncTable {
  private registry: SyncTableEntry[] = [];

  constructor(
    public localPath: string,
    public remotePath: string
  ) {}

  get(filename: string, side: 'local' | 'remote'): FileStatus;
  get(filename: string): SyncTableEntry;
  get(filename?: string, side?: 'local' | 'remote') {
    let entry: SyncTableEntry = this.registry.find(e => e.name === filename);

    if (!entry) {
      return null;
    }

    return side ? entry[side] : entry;
  }

  get all(): SyncTableEntry[] {
    return this.registry;
  }

  set(filename: string, side: 'local' | 'remote', stat: FileStatus): void;
  set(filename: string, entry: SyncTableEntry): void;
  set(filename: string, sideOrEntry: 'local' | 'remote' | SyncTableEntry, stat?: FileStatus) {
    let entry = this.get(filename);

    if (!entry) {
      this.registry.push(new SyncTableEntry(filename));
      entry = this.get(filename);
    }

    if (typeof sideOrEntry === 'object') {
      entry.local = sideOrEntry.local;
      entry.remote = sideOrEntry.remote;
    } else {
      entry[sideOrEntry] = stat;
    }
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
