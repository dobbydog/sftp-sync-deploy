import * as Bluebird from 'bluebird';
import { SFTPWrapper } from 'ssh2';
import { InputAttributes, TransferOptions, FileEntry, Stats } from 'ssh2-streams';

export class AsyncSFTPWrapper {
  fastPut: (localPath: string, remotePath: string, options?: TransferOptions) => Bluebird<void>;
  open: (filename: string, mode: string, attributes?: InputAttributes) => Bluebird<Buffer>;
  mkdir: (path: string, attributes?: InputAttributes) => Bluebird<void>;
  rmdir: (path: string) => Bluebird<void>;
  readdir: (location: string | Buffer) => Bluebird<FileEntry[]>;
  unlink: (path: string) => Bluebird<void>;
  lstat: (path: string) => Bluebird<Stats>;

  constructor(sftp: SFTPWrapper) {
    this.fastPut = Bluebird.promisify<void, string, string, TransferOptions>(sftp.fastPut, {context: sftp});
    this.open = Bluebird.promisify<Buffer, string, string, InputAttributes>(sftp.open, {context: sftp});
    this.mkdir = Bluebird.promisify<void, string, InputAttributes>(sftp.mkdir, {context: sftp});
    this.rmdir = Bluebird.promisify<void, string>(sftp.rmdir, {context: sftp});
    this.readdir = Bluebird.promisify(sftp.readdir, {context: sftp});
    this.lstat = Bluebird.promisify(sftp.lstat, {context: sftp});
    this.unlink = Bluebird.promisify<void, string>(sftp.unlink, {context: sftp});
  }
}
