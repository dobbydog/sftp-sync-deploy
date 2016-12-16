import * as Bluebird from 'bluebird';

export interface SftpSyncConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  localDir: string;
  remoteDir: string;
}

export interface SftpSyncOptions {
  dryRun?: boolean;
  exclude?: string[];
}

export function deploy(config: SftpSyncConfig, options?: SftpSyncOptions): Bluebird<void>;

export default deploy;
