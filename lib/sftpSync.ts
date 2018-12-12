import { Client, SFTP_STATUS_CODE } from 'ssh2';
import { Stats as SSH2Stats } from 'ssh2-streams';
import * as path from 'path';
import { chomp } from './util';
import { AsyncSFTPWrapper } from './asyncSftpWrapper';
import { fsAsync } from './asyncFs';
import { SyncTable } from './syncTable';
import { SftpSyncConfig, SftpSyncOptions } from './config';
import { Stats } from 'fs';

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
  constructor(config: SftpSyncConfig, options?: SftpSyncOptions) {
    this.config = config;

    this.options = Object.assign({
      dryRun: false,
      exclude: [],
      excludeMode: 'remove'
    }, options);

    this.client = new Client;
    this.localRoot = chomp(path.resolve(this.config.localDir), path.sep);
    this.remoteRoot = chomp(this.config.remoteDir, path.posix.sep);
  }

  /**
   * Make SSH2 connection
   */
  async connect(): Promise<void> {
    let privKeyRaw: Buffer;

    try {
      privKeyRaw = await fsAsync.readFile(this.config.privateKey);
    }
    catch (err) {
      throw new Error(`Local Error: Private key file not found ${this.config.privateKey}`);
    }

    return new Promise<void>((resolve, reject) => {
      this.client
        .on('ready', () => {
          this.connected = true;
          resolve();
        })
        .on('error', err_1 => {
          reject(new Error(`Connection Error: ${err_1.message}`));
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
  async sync(relativePath: string = '', isRootTask: boolean = true): Promise<void> {
    const table = await this.buildSyncTable(relativePath);

    await Promise.all(table.all.map(async entry => {
      const task = entry.getTask();
      const args = [entry.path, false];

      if (this.options.dryRun) {
        entry.dryRunLog();

        if (task.method === 'sync') {
          return this.sync(entry.path, false);
        }
        return;
      }

      if (task.removeRemote) {
        await this.removeRemote(entry.path, false);
      }

      if (task.method === 'sync' && entry.remoteStat !== 'dir') {
        await this.createRemoteDirectory(entry.path);
      }

      await this[task.method].apply(this, args);
      return entry.liveRunLog();
    }));

    if (isRootTask) this.close();
  }

  /**
   * Upload file/directory
   */
  async upload(relativePath: string, isRootTask: boolean = true): Promise<void> {
    if (!this.sftpAsync) {
      await this.getAsyncSftp();
      return this.upload(relativePath, isRootTask);
    }

    const localPath = this.localFullPath(relativePath);
    const remotePath = this.remoteFullPath(relativePath);

    try {
      const stat = await fsAsync.lstat(localPath);
      if (stat.isDirectory()) {
        const files = await fsAsync.readdir(localPath);
        await Promise.all(
          files.map(filename => this.upload(path.posix.join(relativePath, filename), false))
        )
      } else {
        await this.sftpAsync.fastPut(localPath, remotePath);
      }
    } catch (err) {
      switch (err.code) {
        case SFTP_STATUS_CODE.NO_SUCH_FILE: {
          throw new Error(`Remote Error: Cannot upload file ${remotePath}`);
        }
        case SFTP_STATUS_CODE.PERMISSION_DENIED: {
          throw new Error(`Remote Error: Cannot upload file. Permission denied ${remotePath}`);
        }
        default: throw err;
      }
    }

    if (isRootTask) this.close();
  }

  /**
   * Remove a remote file or directory
   */
  async removeRemote(relativePath: string, isRootTask: boolean = true): Promise<void> {
    if (!this.sftpAsync) {
      await this.getAsyncSftp();
      return this.removeRemote(relativePath, isRootTask);
    }

    const remotePath = this.remoteFullPath(relativePath);
    const stat = await this.sftpAsync.lstat(remotePath);

    if (stat.isDirectory()) {
      const files = await this.sftpAsync.readdir(remotePath);
      await Promise.all(
        files.map(file => this.removeRemote(path.posix.join(relativePath, file.filename), false))
      );
      await this.sftpAsync.rmdir(remotePath);
    } else {
      await this.sftpAsync.unlink(remotePath);
    }

    if (isRootTask) this.close();
  }

  /**
   * No operation
   */
  async noop(): Promise<void> {
    return;
  }

  /**
   * Create a directory on a remote host
   */
  private async createRemoteDirectory(relativePath: string): Promise<void> {
    if (!this.sftpAsync) {
      await this.getAsyncSftp();
      return this.createRemoteDirectory(relativePath);
    }

    const remotePath = this.remoteFullPath(relativePath);

    try {
      await this.sftpAsync.mkdir(remotePath);
    } catch (err) {
      switch (err.code) {
        case SFTP_STATUS_CODE.NO_SUCH_FILE: {
          throw new Error(`Remote Error: Cannnot create directory ${remotePath}`);
        }
        case SFTP_STATUS_CODE.PERMISSION_DENIED: {
          throw new Error(`Remote Error: Cannnot create directory. Permission denied ${remotePath}`);
        }
        default: throw err;
      }
    }
  }

  /**
   * Build a local and remote files status report for the specified path
   */
  private async buildSyncTable(relativePath: string): Promise<SyncTable> {
    if (!this.sftpAsync) {
      await this.getAsyncSftp();
      return this.buildSyncTable(relativePath);
    }

    const localPath = this.localFullPath(relativePath);
    const remotePath = this.remoteFullPath(relativePath);
    const table = new SyncTable(relativePath, this.options);

    const readLocal = async () => {
      const files = await fsAsync.readdir(localPath);

      try {
        await Promise.all(files.map(async filename => {
          const fullPath = path.join(localPath, filename);
          let stat: Stats;

          try {
            stat = await fsAsync.lstat(fullPath);
          } catch (err) {
            if (err.code === 'EPERM') {
              table.set(filename, {localStat: 'error', localTimestamp: null});
            }
            return;
          }

          const mtime = Math.floor(new Date(stat.mtime).getTime() / 1000);
          table.set(filename, {
            localStat: stat.isDirectory() ? 'dir' : 'file',
            localTimestamp: mtime
          });
        }));
      } catch (err) {
        switch (err.code) {
          case 'ENOENT'  : throw new Error(`Local Error: No such directory ${localPath}`);
          case 'ENOTDIR' : throw new Error(`Local Error: Not a directory ${localPath}`);
          case 'EPERM'   : throw new Error(`Local Error: Cannot read directory. Permission denied ${localPath}`);
          default        : throw err;
        }
      }
    };

    const readRemote = async () => {
      const files = await this.sftpAsync.readdir(remotePath);

      try {
        await Promise.all(files.map(async file => {
          const fullPath = path.posix.join(remotePath, file.filename);
          let stat: SSH2Stats;

          try {
            stat = await this.sftpAsync.lstat(fullPath);
            if (stat.isDirectory()) {
              await this.sftpAsync.readdir(fullPath);
            } else {
              await this.sftpAsync.open(fullPath, 'r+');
            }
          } catch (err) {
            if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
              table.set(file.filename, {remoteStat: 'error', remoteTimestamp: null});
            }
            return;
          }

          table.set(file.filename, {
            remoteStat: stat.isDirectory() ? 'dir' : 'file',
            remoteTimestamp: stat.mtime
          });
        }));
      } catch (err) {
        switch (err.code) {
          case SFTP_STATUS_CODE.NO_SUCH_FILE: {
            if (this.options.dryRun) break;
            throw new Error(`Remote Error: No such directory ${remotePath}`);
          }
          case SFTP_STATUS_CODE.PERMISSION_DENIED: {
            throw new Error(`Remote Error: Cannnot read directory. Permission denied ${remotePath}`);
          }
          default: throw err;
        }
      }
    };

    await Promise.all([readLocal(), readRemote()])
    return table.forEach(entry => entry.detectExclusion());
  }

  /**
   * Get an async version of sftp stream
   */
  private async getAsyncSftp(): Promise<AsyncSFTPWrapper> {
    if (this.sftpAsync) {
      return this.sftpAsync;
    }

    if (!this.connected) {
      await this.connect();
      return this.getAsyncSftp();
    }

    return new Promise<AsyncSFTPWrapper>((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        this.sftpAsync = new AsyncSFTPWrapper(sftp);
        resolve(this.sftpAsync);
      });
    });
  }

  /**
   * Get a full path of a local file or directory
   */
  private localFullPath(relativePath: string): string {
    return path.join(this.localRoot, relativePath);
  }

  /**
   * Get a full path of a remote file or directory
   */
  private remoteFullPath(relativePath: string): string {
    return path.posix.join(this.remoteRoot, relativePath);
  }
}
