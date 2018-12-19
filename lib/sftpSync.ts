import { Client, SFTP_STATUS_CODE } from 'ssh2';
import { Stats as SSH2Stats, FileEntry } from 'ssh2-streams';
import * as path from 'path';
import * as fs from 'fs';
import { chomp } from './util';
import { QueuifiedSFTP } from './queuifiedSftp';
import { SyncTable } from './syncTable';
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
   * Promisified SFTP wrapper with queue
   */
  queuifiedSftp: QueuifiedSFTP;

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

    this.options = {
      dryRun: false,
      exclude: [],
      excludeMode: 'remove',
      concurrency: 100,
      ...options,
    };

    this.client = new Client;
    this.localRoot = chomp(path.resolve(this.config.localDir), path.sep);
    this.remoteRoot = chomp(this.config.remoteDir, path.posix.sep);
  }

  /**
   * Make SSH2 connection
   */
  connect(): Promise<void> {
    let privKeyRaw: Buffer;

    if (this.config.privateKey){
      try {
        privKeyRaw = fs.readFileSync(this.config.privateKey);
      }
      catch (err) {
        throw new Error(`Local Error: Private key file not found ${this.config.privateKey}`);
      }
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
      entry.liveRunLog();
    }));

    if (isRootTask) this.close();
  }

  /**
   * Upload file/directory
   */
  async upload(relativePath: string, isRootTask: boolean = true): Promise<void> {
    if (!this.queuifiedSftp) {
      await this.initQueuifiedSftp();
      return this.upload(relativePath, isRootTask);
    }

    const localPath = this.localFullPath(relativePath);
    const remotePath = this.remoteFullPath(relativePath);

    const stat = fs.lstatSync(localPath);

    if (stat.isDirectory()) {
      const files = fs.readdirSync(localPath);
      if (files && files.length) {
        await Promise.all(
          files.map(filename => this.upload(path.posix.join(relativePath, filename), false))
        );
      }
    } else {
      try {
        // const buffer = fs.readFileSync(localPath);
        // const handle = await this.queuifiedSftp.open(remotePath, 'r+');
        // await this.queuifiedSftp.writeData(handle, buffer, 0, buffer.length, 0);
        // await this.queuifiedSftp.close(handle);
        await this.queuifiedSftp.fastPut(localPath, remotePath);
      } catch (err) {
        switch (err.code) {
          case SFTP_STATUS_CODE.NO_SUCH_FILE: {
            throw new Error(`Remote Error: Cannot upload file ${remotePath}`);
          }
          case SFTP_STATUS_CODE.PERMISSION_DENIED: {
            throw new Error(`Remote Error: Cannot upload file. Permission denied ${remotePath}`);
          }
          case SFTP_STATUS_CODE.FAILURE: {
            throw new Error(`Remote Error: Unknown error while uploading file ${remotePath}`);
          }
          default: throw err;
        }
      }
    }

    if (isRootTask) this.close();
  }

  /**
   * Remove a remote file or directory
   */
  async removeRemote(relativePath: string, isRootTask: boolean = true): Promise<void> {
    if (!this.queuifiedSftp) {
      await this.initQueuifiedSftp();
      return this.removeRemote(relativePath, isRootTask);
    }

    const remotePath = this.remoteFullPath(relativePath);
    const stat = await this.queuifiedSftp.lstat(remotePath);

    if (stat.isDirectory()) {
      const files = await this.queuifiedSftp.readdir(remotePath);
      await Promise.all(
        files.map(file => this.removeRemote(path.posix.join(relativePath, file.filename), false))
      );
      await this.queuifiedSftp.rmdir(remotePath);
    } else {
      return this.queuifiedSftp.unlink(remotePath);
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
  async createRemoteDirectory(relativePath: string): Promise<void> {
    if (!this.queuifiedSftp) {
      await this.initQueuifiedSftp();
      return this.createRemoteDirectory(relativePath);
    }

    const remotePath = this.remoteFullPath(relativePath);

    try {
      await this.queuifiedSftp.mkdir(remotePath);
    } catch (err) {
      switch (err.code) {
        case SFTP_STATUS_CODE.NO_SUCH_FILE: {
          throw new Error(`Remote Error: Cannot create directory ${remotePath}`);
        }
        case SFTP_STATUS_CODE.PERMISSION_DENIED: {
          throw new Error(`Remote Error: Cannot create directory. Permission denied ${remotePath}`);
        }
        case SFTP_STATUS_CODE.FAILURE: {
          throw new Error(`Remote Error: Unknown error while creating directory ${remotePath}`);
        }
        default: throw err;
      }
    }
  }

  /**
   * Build a local and remote files status report for the specified path
   */
  private async buildSyncTable(relativePath: string): Promise<SyncTable> {
    if (!this.queuifiedSftp) {
      await this.initQueuifiedSftp();
      return this.buildSyncTable(relativePath);
    }

    const localPath = this.localFullPath(relativePath);
    const remotePath = this.remoteFullPath(relativePath);
    const table = new SyncTable(relativePath, this.options);

    const readLocal = async () => {
      let files: string[];

      try {
        files = fs.readdirSync(localPath);
      } catch (err) {
        switch (err.code) {
          case 'ENOENT'  : throw new Error(`Local Error: No such directory ${localPath}`);
          case 'ENOTDIR' : throw new Error(`Local Error: Not a directory ${localPath}`);
          case 'EPERM'   : throw new Error(`Local Error: Cannot read directory. Permission denied ${localPath}`);
          default        : throw err;
        }
      }

      if (!files || !files.length) return;

      await Promise.all(files.map(async filename => {
        const fullPath = path.join(localPath, filename);
        let stat: fs.Stats;

        try {
          fs.accessSync(fullPath, fs.constants.R_OK);
          stat = fs.lstatSync(fullPath);
        } catch (err) {
          if (err.code === 'EPERM' || err.code === 'EACCES') {
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
    };

    const readRemote = async () => {
      let files: FileEntry[];

      try {
        files = await this.queuifiedSftp.readdir(remotePath);
      } catch (err) {}

      if (!files || !files.length) return;

      await Promise.all(files.map(async file => {
        const fullPath = path.posix.join(remotePath, file.filename);
        let stat: SSH2Stats;

        try {
          stat = await this.queuifiedSftp.lstat(fullPath);

          if (stat.isDirectory()) {
            await this.queuifiedSftp.readdir(fullPath);
          } else {
            const buffer = await this.queuifiedSftp.open(fullPath, 'r+');
            await this.queuifiedSftp.close(buffer);
          }
        } catch (err) {
          if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
            table.set(file.filename, {remoteStat: 'error', remoteTimestamp: null});
          }
          return;
        }

        if (stat) {
          table.set(file.filename, {
            remoteStat: stat.isDirectory() ? 'dir' : 'file',
            remoteTimestamp: stat.mtime
          });
        }
      }));
    };

    await Promise.all([readLocal(), readRemote()]);
    return table.forEach(entry => entry.detectExclusion());
  }

  /**
   * Get an async version of sftp stream
   */
  private async initQueuifiedSftp(concurrency = this.options.concurrency): Promise<QueuifiedSFTP> {
    if (this.queuifiedSftp) {
      return this.queuifiedSftp;
    }

    if (!this.connected) {
      await this.connect();
      return this.initQueuifiedSftp(concurrency);
    }

    this.queuifiedSftp = await QueuifiedSFTP.init(this.client, concurrency);

    return this.queuifiedSftp;
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
