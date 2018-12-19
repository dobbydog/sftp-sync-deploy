import { SFTPWrapper, Client } from 'ssh2';
import { InputAttributes, TransferOptions, FileEntry, Stats } from 'ssh2-streams';
import Queue from 'queue';

export class QueuifiedSFTP {

  sftp: SFTPWrapper;
  queue: Queue;
  started = false;
  paused = false;

  private constructor(concurrency: number) {
    this.queue = new Queue({concurrency});
    this.queue.on('end', err => {
      this.started = false;
    });
  }

  static init(client: Client, concurrency = Infinity): Promise<QueuifiedSFTP> {
    const instance = new QueuifiedSFTP(concurrency);

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) return reject(err);
        instance.sftp = sftp;
        resolve(instance);
      });
    })
  }

  async fastPut(localPath: string, remotePath: string, options?: TransferOptions): Promise<void> {
    return this.run('fastPut', [localPath, remotePath, options]);
  }

  async open(filename: string, mode: string, attributes?: InputAttributes): Promise<Buffer> {
    return this.run('open', [filename, mode, attributes]);
  }

  async writeData(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number) {
    return this.run('write', [handle, buffer, offset, length, position]);
  }

  async close(handle: Buffer): Promise<void> {
    return this.run('close', [handle]);
  }

  async mkdir(path: string, attributes?: InputAttributes): Promise<void> {
    return this.run('mkdir', [path, attributes]);
  }

  async rmdir(path: string): Promise<void> {
    return this.run('rmdir', [path]);
  }

  async readdir(location: string | Buffer): Promise<FileEntry[]> {
    return this.run('readdir', [location]);
  }

  async unlink(path: string): Promise<void> {
    return this.run('unlink', [path]);
  }

  async lstat(path: string): Promise<Stats> {
    return this.run('lstat', [path]);
  }

  private run(method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push(cb => {
        this.sftp[method](...args, (err, result) => {
          err ? reject(err) : resolve(result);
          cb(null, result);
        });
      });

      if (!this.started) {
        this.queue.start();
        this.started = true;
      }
    })
  }
}
