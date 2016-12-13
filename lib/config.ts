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
