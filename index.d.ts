export interface SftpSyncDeployConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  localDir: string;
  remoteDir: string;
}

export interface SftpSyncDeployOptions {
  dryRun?: boolean;
}

export function deploy(config: SftpSyncDeployConfig, options?: SftpSyncDeployOptions): Promise<boolean>;

export default deploy;
