import 'colors';
import { Client, SFTP_STATUS_CODE } from 'ssh2';
import * as Bluebird from 'bluebird';
import * as minimatch from 'minimatch';
import * as fs from 'fs';
import * as path from 'path';
import * as util from './util';
import { AsyncSFTPWrapper } from './asyncSftpWrapper';
import { SyncTable, FileStatus } from './syncTable';
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
   * Constructor
   */
  constructor(config: SftpSyncConfig, options: SftpSyncOptions) {
    this.config = config;

    this.options = Object.assign({
      dryRun: false,
      exclude: []
    }, options);

    this.client = new Client;
    this.sftpAsync = undefined;

    let localDir = util.chomp(path.resolve(this.config.localDir), path.sep);
    let remoteDir = util.chomp(this.config.remoteDir, '/');

    if (!fs.lstatSync(localDir).isDirectory()) {
      throw new Error('src: ' + localDir + ' is not directory');
    }

    this.localDir = localDir;
    this.remoteDir = remoteDir;
  }

  /**
   * Make SSH2 connection and start sync
   */
  start(): Bluebird<void> {
    return new Bluebird<void>((resolve, reject) => {
      this.client.on('ready', () => {
        this.sync(this.localDir, this.remoteDir).then(() => {
          resolve();
        }).catch(err => {
          reject(err);
        }).finally(() => {
          this.client.end();
        });
      })
      .on('error', err => {
        reject(err);
      })
      .connect({
        host: this.config.host,
        port: this.config.port || 22,
        username: this.config.username,
        password: this.config.password,
        passphrase: this.config.passphrase,
        privateKey: this.config.privateKey ? fs.readFileSync(this.config.privateKey) : undefined
      });
    });
  };

  /**
   * Get sftp stream
   */
  getAsyncSftp(): Bluebird<AsyncSFTPWrapper> {
    if (this.sftpAsync) {
      return Bluebird.resolve(this.sftpAsync);
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
   * Sync with specified path
   */
  sync(localPath: string, remotePath: string): Bluebird<void> {
    return this.buildSyncTable(localPath, remotePath).then(project => {

      return Bluebird.map(project.files(), filename => {
        let stats = project.get(filename);
        let localFilePath = localPath + path.sep + filename;
        let remoteFilePath = remotePath + '/' + filename;
        let task = stats.getTask();
        let args = [localFilePath, remoteFilePath];

        if (this.options.dryRun) {
          util.dryRunLog(util.normalizedRelativePath(localFilePath, this.localDir), stats);

          if (task.method === 'sync' || stats.local === 'dir') {
            return this.sync(localFilePath, remoteFilePath);
          } else {
            return Bluebird.resolve();
          }
        }

        let preMethod = task.removeRemote ? this.removeRemote(remoteFilePath) : Bluebird.resolve();

        return preMethod.then(() => this[task.method].apply(this, args));
      });
    }).then(() => {
      if (!this.options.dryRun) {
        console.log('     sync completed : '.cyan + util.normalizedRelativePath(localPath, this.localDir));
      }
    });
  }


  /**
   * Upload the file
   */
  upload(localPath: string, remotePath: string): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.upload(localPath, remotePath));
    }

    let isDirectory = fs.lstatSync(localPath).isDirectory();

    if (isDirectory) {
      let localList = fs.readdirSync(localPath);

      return this.sftpAsync.mkdir(remotePath).then(() => {

        return Bluebird.map(localList, filename => {
          let fullPath = localPath + path.sep + filename;
          let isDir = fs.lstatSync(fullPath).isDirectory();
          let ignored = this.isIgnored(fullPath, isDir);

          return !ignored ? this.upload(fullPath, remotePath + '/' + filename) : Bluebird.resolve();
        }).then(() => {
          console.log(' directory uploaded : '.yellow + util.normalizedRelativePath(localPath, this.localDir));
        });
      });
    } else {
      return this.sftpAsync.fastPut(localPath, remotePath).then(() => {
        console.log('      file uploaded : '.yellow + util.normalizedRelativePath(localPath, this.localDir));
      });
    }
  };

  /**
   * Remove the specified remote file or directory
   */
  removeRemote(remotePath: string): Bluebird<void> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.removeRemote(remotePath));
    }

    return this.sftpAsync.lstat(remotePath).then(stat => {
      if (stat.isDirectory()) {
        return this.sftpAsync.readdir(remotePath).then(list => {
          return Bluebird.map(list, file => this.removeRemote(remotePath + '/' + file.filename))
          .then(() => {
            this.sftpAsync.rmdir(remotePath).then(() => {
              console.log(' remote dir removed : '.red + util.normalizedRelativePath(remotePath, this.remoteDir));
            });
          });
        });
      } else {
        return this.sftpAsync.unlink(remotePath).then(() => {
          console.log('remote file removed : '.red + util.normalizedRelativePath(remotePath, this.remoteDir));
        });
      }
    });
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
  buildSyncTable(localPath: string, remotePath: string): Bluebird<SyncTable> {
    if (!this.sftpAsync) {
      return this.getAsyncSftp().then(() => this.buildSyncTable(localPath, remotePath));
    }

    let localList = fs.readdirSync(localPath);
    let table = new SyncTable();

    localList.forEach(filename => {
      let fullPath = localPath + path.sep + filename;
      let isDir = fs.lstatSync(fullPath).isDirectory();
      let ignored = this.isIgnored(fullPath, isDir);

      table.set(filename, 'local', ignored ? 'ignore' : isDir ? 'dir' : 'file');
    });

    return this.sftpAsync.readdir(remotePath)
    .catch(err => {
      if (err.code === SFTP_STATUS_CODE.NO_SUCH_FILE) {
        return table;
      } else if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
        table.forEach((stats, filename) => {
          table.set(filename, 'remote', 'error');
        });
        return table;
      } else {
        throw err;
      }
    })
    .then(val => {
      if (val instanceof SyncTable) {
        return val;
      }

      return Bluebird.map(val, file => {
        let fullPath = remotePath + '/' + file.filename;
        return this.sftpAsync.lstat(fullPath).then<FileStatus>(stat => {
          if (stat.isDirectory()) {
            return this.sftpAsync.readdir(fullPath).then(() => 'dir');
          } else {
            return this.sftpAsync.open(fullPath, 'r+').then(() => 'file');
          }
        }).then(type => {
          table.set(file.filename, 'remote', type);
        }).catch(err => {
          if (err.code === SFTP_STATUS_CODE.PERMISSION_DENIED) {
            table.set(file.filename, 'remote', 'error');
          } else {
            throw err;
          }
        });
      })
      .then(() => table);
    });
  };

  /**
   * Check if the path matches the exclude patterns
   * @param {string} localPath
   * @param {boolean} isDir
   * @return {boolean}
   */
  isIgnored(localPath: string, isDir: boolean): boolean {
    let pathForMatch = util.normalizedRelativePath(localPath, this.localDir);

    if (isDir) {
      pathForMatch += '/';
    }

    return this.options.exclude.some(pattern => minimatch(pathForMatch, pattern));
  }
}
