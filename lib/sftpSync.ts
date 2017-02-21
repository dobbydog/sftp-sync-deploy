import 'colors';
import { Client, SFTP_STATUS_CODE } from 'ssh2';
import { FileEntry } from 'ssh2-streams';
import * as Bluebird from 'bluebird';
import * as path from 'path';
import * as util from './util';
import { AsyncSFTPWrapper } from './asyncSftpWrapper';
import { fsAsync } from './asyncFs';
import { SyncTable, SyncTableEntry, FileStatus } from './syncTable';
import { SftpSyncConfig, SftpSyncOptions } from './config';

/**
 * Creates a new SftpDeploy instance
 * @class
 */
export class SftpSync {
  /**
   * Config object
   */
  config: SftpSyncConfig;

  /**
   * Options object
   */
  options: SftpSyncOptions;

  /**
   * SSH2 Client
   */
  client: Client;

  /**
   * Promisified SFTP stream
   */
  sftpAsync: AsyncSFTPWrapper;

  /**
   * Local directory root
   */
  localRoot: string;

  /**
   * Remote directory root
   */
  remoteRoot: string;

  /**
   * Whether a SSH2 connection has been made or not
   */
  private connected: boolean = false;

  /**
   * Constructor
   */
  constructor(config: SftpSyncConfig, options: SftpSyncOptions) {
    this.config = config;

    this.options = Object.assign({
      dryRun: false,
      exclude: []
    }, options);

    this.client = new Client;
    this.localRoot = util.chomp(path.resolve(this.config.localDir), path.sep);
    this.remoteRoot = util.chomp(this.config.remoteDir, path.posix.sep);
  }

  /**
   * Make SSH2 connection
   */
  connect(): Bluebird<void> {
    let privKeyRaw: Buffer;

    return Bluebird.resolve()
    .then(() => {
      if (this.config.privateKey) {
        return fsAsync.readFile(this.config.privateKey)
        .catch(err => {
          throw new Error(`Local Error: Private key file not found ${this.config.privateKey}`);
        })
        .then(privKey => {
          privKeyRaw = privKey;
        });
      } else {
        return Bluebird.resolve();
      }
    })
    .then(() => {
      return new Bluebird<void>((resolve, reject) => {
        this.client
        .on('ready', () => {
          this.connected = true;
          resolve();
        })
        .on('error', err => {
          reject(new Error(`Connection Error: ${err.message}`));
        })
        .connect({
          host: this.config.host,
          port: this.config.port || 22,
          username: this.config.username,
          password: this.config.password,
          passphrase: this.config.passphrase,
          privateKey: privKeyRaw,
          agent: this.config.agent
        });
      });
    });
  }

  /**
   * Close SSH2 connection
   */
  close(): void {
    this.connected = false;
    this.client.end();
  }

  /**
   * Sync with specified path
   */
  sync(relativePath: string = '', isRootTask: boolean = true): Bluebird<void> {
    let doTask = (entry: SyncTableEntry) => {
      let task = entry.getTask();
      let args = [entry.path, false];

      let preTask = () => {
        let preTasks = Bluebird.resolve();

        if (task.removeRemote) {
          preTasks = preTasks.then(() => this.removeRemote(entry.path, false));
        }

        if (task.method === 'sync' && entry.remoteStat !== 'dir') {
          preTasks = preTasks.then(() => this.createRemoteDirectory(entry.path));
        }

        return preTasks;
      };

      if (this.options.dryRun) {
        entry.dryRunLog();

        if (task.method === 'sync') {
          return this.sync(entry.path, false);
        } else {
          return Bluebird.resolve();
        }
      }

      return preTask()
        .then(() => this[task.method].apply(this, args))
        .then(() => entry.liveRunLog());
    };

    return this.buildSyncTable(relativePath)
      .get('all')
      .map<SyncTableEntry, void>(doTask)
      .return(void 0)
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * Upload file/directory
   */
  upload(relativePath: string, isRootTask: boolean = true): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.upload(relativePath, isRootTask));
    }

    let localPath = this.localFullPath(relativePath);
    let remotePath = this.remoteFullPath(relativePath);

    let uploadDir = () => fsAsync.readdir(localPath)
      .map<string, void>(filename => this.upload(path.posix.join(relativePath, filename), false))
      .return(void 0);

    let uploadFile = () => this.sftpAsync.fastPut(localPath, remotePath);

    return fsAsync.lstat(localPath).then(stat => stat.isDirectory() ? uploadDir() : uploadFile())
      .catch({code: SFTP_STATUS_CODE.NO_SUCH_FILE}, err => {
        throw new Error(`Remote Error: Cannot upload file ${remotePath}`);
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannot upload file. Permission denied ${remotePath}`);
      })
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * Remove a remote file or directory
   */
  removeRemote(relativePath: string, isRootTask: boolean = true): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.removeRemote(relativePath, isRootTask));
    }

    let remotePath = this.remoteFullPath(relativePath);

    let removeDir = () => this.sftpAsync.readdir(remotePath)
      .map<FileEntry, void>(file => this.removeRemote(path.posix.join(relativePath, file.filename), false))
      .then(() => this.sftpAsync.rmdir(remotePath));

    let removeFile = () => this.sftpAsync.unlink(remotePath);

    return this.sftpAsync.lstat(remotePath)
      .then(stat => stat.isDirectory() ? removeDir() : removeFile())
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * No operation
   */
  noop(): Bluebird<void> {
    return Bluebird.resolve();
  }

  /**
   * Create a directory on a remote host
   */
  private createRemoteDirectory(relativePath: string): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.createRemoteDirectory(relativePath));
    }

    let remotePath = this.remoteFullPath(relativePath);

    return this.sftpAsync.mkdir(remotePath)
      .catch({code: SFTP_STATUS_CODE.NO_SUCH_FILE}, err => {
        throw new Error(`Remote Error: Cannnot create directory ${remotePath}`);
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannnot create directory. Permission denied ${remotePath}`);
      });
  }

  /**
   * Build a local and remote files status report for the specified path
   */
  private buildSyncTable(relativePath: string): Bluebird<SyncTable> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.buildSyncTable(relativePath));
    }

    let localPath = this.localFullPath(relativePath);
    let remotePath = this.remoteFullPath(relativePath);
    let table = new SyncTable(relativePath);

    let readLocal = () => fsAsync.readdir(localPath)
      .map<string, void>(filename => {
        let fullPath = path.join(localPath, filename);

        return fsAsync.lstat(fullPath)
          .then(stat => {
            let entry = table.set(filename, {localStat: stat.isDirectory() ? 'dir' : 'file'});
            entry.detectExclusion(this.options.exclude);
          })
          .catch({code: 'EPERM'}, err => {
            table.set(filename, {localStat: 'error'});
          });
      })
      .catch({code: 'ENOENT'}, err => {
        throw new Error(`Local Error: No such directory ${localPath}`);
      })
      .catch({code: 'ENOTDIR'}, err => {
        throw new Error(`Local Error: Not a directory ${localPath}`);
      })
      .catch({code: 'EPERM'}, err => {
        throw new Error(`Local Error: Cannot read directory. Permission denied ${localPath}`);
      });

    let readRemote = () => this.sftpAsync.readdir(remotePath)
      .map<FileEntry, void>(file => {
        let fullPath = path.posix.join(remotePath, file.filename);

        return this.sftpAsync.lstat(fullPath)
          .then<FileStatus>(stat => {
            if (stat.isDirectory()) {
              return this.sftpAsync.readdir(fullPath).then(() => 'dir');
            } else {
              return this.sftpAsync.open(fullPath, 'r+').then(() => 'file');
            }
          })
          .then(type => {
            table.set(file.filename, {remoteStat: type});
          })
          .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
            table.set(file.filename, {remoteStat: 'error'});
          });
      })
      .catch({code: SFTP_STATUS_CODE.NO_SUCH_FILE}, err => {
        if (!this.options.dryRun) {
          throw new Error(`Remote Error: No such directory ${remotePath}`);
        }
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannnot read directory. Permission denied ${remotePath}`);
      });

    return Bluebird.join(readLocal(), readRemote()).return(table);
  }

  /**
   * Get an async version of sftp stream
   */
  private getAsyncSftp(): Bluebird<AsyncSFTPWrapper> {
    if (this.sftpAsync) {
      return Bluebird.resolve(this.sftpAsync);
    }

    if (!this.connected) {
      return this.connect().then(() => this.getAsyncSftp());
    }

    const sftp = Bluebird.promisify(this.client.sftp, {context: this.client});

    return sftp().then(sftp => this.sftpAsync = new AsyncSFTPWrapper(sftp));
  }

  /**
   * Get a full path of a local file or directory
   */
  private localFullPath(relativePath: string): string {
    return path.join(this.localRoot, relativePath);
  }

  /**
   * Get a full path of a local file or directory
   */
  private remoteFullPath(relativePath: string): string {
    return path.posix.join(this.remoteRoot, relativePath);
  }
}
