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
    } else if (!this.remote || this.local === 'file' || this.local === 'dir' && this.remote === 'file') {
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
  private registry: {[filename: string]: SyncTableEntry} = {};

  get(filename: string, side: 'local' | 'remote'): FileStatus;
  get(filename: string): SyncTableEntry;
  get(filename?: string, side?: 'local' | 'remote') {
    if (!this.registry[filename]) {
      this.registry[filename] = new SyncTableEntry();
    }

    if (side) {
      return this.registry[filename][side];
    } else {
      return this.registry[filename];
    }
  }

  getAll(): {[filename: string]: SyncTableEntry} {
    return this.registry;
  }

  set(filename: string, side: 'local' | 'remote', stat: FileStatus): void;
  set(filename: string, entry: SyncTableEntry): void;
  set(filename: string, sideOrEntry: 'local' | 'remote' | SyncTableEntry, stat?: FileStatus) {
    if (!this.registry[filename]) {
      this.registry[filename] = new SyncTableEntry();
    }

    if (typeof sideOrEntry === 'object') {
      this.registry[filename] = sideOrEntry;
    } else {
      this.registry[filename][sideOrEntry] = stat;
    }
  }

  forEach(fn: (stat: SyncTableEntry, filename: string) => void) {
    for (let n in this.registry) {
      fn(this.registry[n], n);
    }
  }

  files(): string[] {
    return Object.keys(this.registry);
  }
}
