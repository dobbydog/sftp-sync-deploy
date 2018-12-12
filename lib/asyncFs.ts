import * as fs from 'fs';
import * as util from 'util';

export interface AsyncFsSubset {
  lstat: (path: string | Buffer) => Promise<fs.Stats>;
  readdir: (path: string | Buffer) => Promise<string[]>;
  readFile: (filename: string) => Promise<Buffer>;
}

export const fsAsync: AsyncFsSubset = {
  lstat: util.promisify(fs.lstat),
  readdir: util.promisify(fs.readdir),
  readFile: util.promisify(fs.readFile)
};
