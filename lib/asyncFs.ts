import * as fs from 'fs';
import * as Bluebird from 'bluebird';

export interface AsyncFsSubset {
  lstat: (path: string | Buffer) => Bluebird<fs.Stats>;
  readdir: (path: string | Buffer) => Bluebird<string[]>;
  readFile: (filename: string) => Bluebird<Buffer>;
}

export const fsAsync: AsyncFsSubset = {
  lstat: Bluebird.promisify(fs.lstat),
  readdir: Bluebird.promisify(fs.readdir),
  readFile: Bluebird.promisify(fs.readFile)
};
