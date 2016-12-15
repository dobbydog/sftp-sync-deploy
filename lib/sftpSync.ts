import 'colors';
import { Client, SFTP_STATUS_CODE } from 'ssh2';
import { FileEntry } from 'ssh2-streams';
import * as Bluebird from 'bluebird';
import * as minimatch from 'minimatch';
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
      return fsAsync.lstat(this.localDir)
      .catch(err => {
        throw new Error(`localDir: ${this.localDir} does not exist.`);
      })
      .then(stats => {
        if (!stats.isDirectory()) {
          throw new Error(`localDir: ${this.localDir} is not a directory.`);
        }
      });
    })
    .then(() => {
      if (this.config.privateKey) {
        return fsAsync.readFile(this.config.privateKey)
        .catch(err => {
          throw new Error(`privateKey: ${this.config.privateKey} does not exist.`);
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
        .on('error', err => reject(err))
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
    this.client.end();
  }

  /**
   * Sync with specified path
   */
  sync(localPath: string = this.localDir, remotePath: string = this.remoteDir, isRootTask: boolean = true): Bluebird<void> {
    return this.buildSyncTable(localPath, remotePath)
    .get('all')
    .map<SyncTableEntry, void>(entry => {
      let localFilePath = localPath + path.sep + entry.name;
      let remoteFilePath = remotePath + '/' + entry.name;
      let task = entry.getTask();
      let args = [localFilePath, remoteFilePath, false];

      if (this.options.dryRun) {
        util.dryRunLog(util.normalizedRelativePath(localFilePath, this.localDir), entry);

        if (task.method === 'sync') {
          return this.sync(localFilePath, remoteFilePath, false);
        } else {
          return Bluebird.resolve();
        }
      }

      let preTask = () => {
        let preTasks = Bluebird.resolve();

        if (task.removeRemote) {
          preTasks = preTasks.then(() => this.removeRemote(remoteFilePath, false));
        }

        if (task.method === 'sync' && !entry.remote) {
          preTasks = preTasks.then(() => this.sftpAsync.mkdir(remoteFilePath));
        }

        return preTasks;
      };

      return preTask().then(() => this[task.method].apply(this, args));
    })
    .then(() => {
      if (!this.options.dryRun) {
        console.log('     sync completed : '.cyan + util.normalizedRelativePath(localPath, this.localDir));
      }
    })
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
      .then(() => {
        console.log('      file uploaded : '.yellow + util.normalizedRelativePath(localPath, this.localDir));
      })
      .finally(() => isRootTask ? this.close() : void 0);
  };

  /**
   * Remove the specified remote file or directory
   */
  removeRemote(remotePath: string, isRootTask: boolean = true): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.removeRemote(remotePath, isRootTask));
    }

    let removeDir = () => this.sftpAsync.readdir(remotePath)
      .map<FileEntry, void>(file => this.removeRemote(remotePath + '/' + file.filename, false))
      .then(() => this.sftpAsync.rmdir(remotePath))
      .then(() => {
        console.log(' remote dir removed : '.red + util.normalizedRelativePath(remotePath, this.remoteDir));
      });

    let removeFile = () => this.sftpAsync.unlink(remotePath)
      .then(() => {
        console.log('remote file removed : '.red + util.normalizedRelativePath(remotePath, this.remoteDir));
      });

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
   * Build a local and remote files status report for specified path
   */
  private buildSyncTable(localPath: string, remotePath: string): Bluebird<SyncTable> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.buildSyncTable(localPath, remotePath));
    }

    let table = new SyncTable(localPath, remotePath);

    let readLocal = () => fsAsync.readdir(localPath)
      .map<string, void>(filename => {
        let fullPath = localPath + path.sep + filename;

        return fsAsync.lstat(fullPath).then(stat => {
          let isDir = stat.isDirectory();
          let isExcluded = this.isExcluded(fullPath, isDir);

          table.set(filename, 'local', isExcluded ? 'ignore' : isDir ? 'dir' : 'file');
        });
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
          table.set(file.filename, 'remote', type);
        })
        .catch(err => {
          if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
            table.set(file.filename, 'remote', 'error');
          } else {
            throw err;
          }
        });
      })
      .catch(err => {
        if (err.code === SFTP_STATUS_CODE.NO_SUCH_FILE) {
          return;
        } else {
          throw err;
        }
      });

    return Bluebird.join(readLocal(), readRemote()).return(table);
  };

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

    return sftp().then(sftp => {
      this.sftpAsync = {
        fastPut: Bluebird.promisify(sftp.fastPut, {context: sftp}),
        open: Bluebird.promisify(sftp.open, {context: sftp}),
        mkdir: Bluebird.promisify(sftp.mkdir, {context: sftp}),
        rmdir: Bluebird.promisify(sftp.rmdir, {context: sftp}),
        readdir: Bluebird.promisify(sftp.readdir, {context: sftp}),
        lstat: Bluebird.promisify(sftp.lstat, {context: sftp}),
        unlink: Bluebird.promisify(sftp.unlink, {context: sftp})
      };
      return this.sftpAsync;
    });
  };

  /**
   * Check if the path matches the exclude patterns
   */
  private isExcluded(localPath: string, isDir: boolean): boolean {
    let pathForMatch = util.normalizedRelativePath(localPath, this.localDir);

    if (isDir) {
      pathForMatch += '/';
    }

    return this.options.exclude.some(pattern => minimatch(pathForMatch, pattern));
  }
}
