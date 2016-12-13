import * as Bluebird from 'bluebird';
import { InputAttributes, TransferOptions, FileEntry, Stats } from 'ssh2-streams';

export interface AsyncSFTPWrapper {
  fastPut: (localPath: string, remotePath: string, options?: TransferOptions) => Bluebird<any>;
  open: (filename: string, mode?: string, attributes?: InputAttributes) => Bluebird<Buffer>;
  mkdir: (path: string, attributes?: InputAttributes) => Bluebird<any>;
  rmdir: (path: string) => Bluebird<any>;
  readdir: (location: string | Buffer) => Bluebird<FileEntry[]>;
  unlink: (path: string) => Bluebird<any>;
  lstat: (path: string) => Bluebird<Stats>;
}
