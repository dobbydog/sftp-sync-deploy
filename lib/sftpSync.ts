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
  localDir: string;

  /**
   * Remote directory root
   */
  remoteDir: string;

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
    this.localDir = util.chomp(path.resolve(this.config.localDir), path.sep);
    this.remoteDir = util.chomp(this.config.remoteDir, '/');
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
          privateKey: privKeyRaw
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
  sync(localPath: string = this.localDir, remotePath: string = this.remoteDir, isRootTask: boolean = true): Bluebird<void> {
    let doTask = (entry: SyncTableEntry) => {
      let task = entry.getTask();
      let args = [entry.localPath, entry.remotePath, false];

      let preTask = () => {
        let preTasks = Bluebird.resolve();

        if (task.removeRemote) {
          preTasks = preTasks.then(() => this.removeRemote(entry.remotePath, false));
        }

        if (task.method === 'sync' && !entry.remoteStat) {
          preTasks = preTasks.then(() => this.createRemoteDirectory(entry.remotePath));
        }

        return preTasks;
      };

      if (this.options.dryRun) {
        entry.dryRunLog();

        if (task.method === 'sync') {
          return this.sync(entry.localPath, entry.remotePath, false);
        } else {
          return Bluebird.resolve();
        }
      }

      return preTask()
        .then(() => this[task.method].apply(this, args))
        .then(() => entry.liveRunLog());
    };

    return this.buildSyncTable(localPath, remotePath)
      .get('all')
      .map<SyncTableEntry, void>(doTask)
      .return(void 0)
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * Upload the file
   */
  upload(localPath: string, remotePath: string, isRootTask: boolean = true): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.upload(localPath, remotePath, isRootTask));
    }

    return this.sftpAsync.fastPut(localPath, remotePath)
      .catch({code: SFTP_STATUS_CODE.NO_SUCH_FILE}, err => {
        throw new Error(`Remote Error: Cannot upload file ${remotePath}`);
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannot upload file. Permission denied ${remotePath}`);
      })
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * Remove the specified remote file or directory
   */
  removeRemote(remotePath: string, isRootTask: boolean = true): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.removeRemote(remotePath, isRootTask));
    }

    let removeDir = () => this.sftpAsync.readdir(remotePath)
      .map<FileEntry, void>(file => this.removeRemote(remotePath + '/' + file.filename, false))
      .then(() => this.sftpAsync.rmdir(remotePath));

    let removeFile = () => this.sftpAsync.unlink(remotePath);

    return this.sftpAsync.lstat(remotePath)
      .then(stat => stat.isDirectory() ? removeDir() : removeFile())
      .finally(() => isRootTask ? this.close() : void 0);
  }

  /**
   * dummy operation
   */
  noop(): Bluebird<void> {
    return Bluebird.resolve();
  }

  /**
   * Create a directory on remote
   */
  private createRemoteDirectory(remotePath: string): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.createRemoteDirectory(remotePath));
    }

    return this.sftpAsync.mkdir(remotePath)
      .catch({code: SFTP_STATUS_CODE.NO_SUCH_FILE}, err => {
        throw new Error(`Remote Error: Cannnot create directory ${remotePath}`);
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannnot create directory. Permission denied ${remotePath}`);
      });
  }

  /**
   * Build a local and remote files status report for specified path
   */
  private buildSyncTable(localPath: string, remotePath: string): Bluebird<SyncTable> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.buildSyncTable(localPath, remotePath));
    }

    let table = new SyncTable(localPath, remotePath, this.localDir, this.remoteDir);

    let readLocal = () => fsAsync.readdir(localPath)
      .map<string, void>(filename => {
        let fullPath = localPath + path.sep + filename;

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
        let fullPath = remotePath + '/' + file.filename;

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
        throw new Error(`Remote Error: No such directory ${remotePath}`);
      })
      .catch({code: SFTP_STATUS_CODE.PERMISSION_DENIED}, err => {
        throw new Error(`Remote Error: Cannnot read directory. Permission denied ${remotePath}`);
      });

    return Bluebird.join(readLocal(), readRemote()).return(table);
  }

  /**
   * Get sftp stream
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
}
