import * as util from 'util';
import { SFTPWrapper } from 'ssh2';
import { InputAttributes, TransferOptions, FileEntry, Stats } from 'ssh2-streams';

export class AsyncSFTPWrapper {
  fastPut: (localPath: string, remotePath: string, options?: TransferOptions) => Promise<void>;
  open: (filename: string, mode: string, attributes?: InputAttributes) => Promise<Buffer>;
  mkdir: (path: string, attributes?: InputAttributes) => Promise<void>;
  rmdir: (path: string) => Promise<void>;
  readdir: (location: string | Buffer) => Promise<FileEntry[]>;
  unlink: (path: string) => Promise<void>;
  lstat: (path: string) => Promise<Stats>;

  constructor(sftp: SFTPWrapper) {
    this.fastPut = util.promisify<string, string, TransferOptions>(sftp.fastPut).bind(sftp);
    this.open = util.promisify<string, string, InputAttributes, Buffer>(sftp.open).bind(sftp);
    this.mkdir = util.promisify<string, InputAttributes>(sftp.mkdir).bind(sftp);
    this.rmdir = util.promisify<string>(sftp.rmdir).bind(sftp);
    this.readdir = util.promisify<string | Buffer, FileEntry[]>(sftp.readdir).bind(sftp);
    this.lstat = util.promisify<string, Stats>(sftp.lstat).bind(sftp);
    this.unlink = util.promisify<string>(sftp.unlink).bind(sftp);
  }
}
