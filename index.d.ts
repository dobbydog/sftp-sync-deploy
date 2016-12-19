import * as Bluebird from 'bluebird';
import { SftpSyncConfig, SftpSyncOptions } from './lib/config';

export { SftpSync } from './lib/sftpSync';
export { SftpSyncConfig, SftpSyncOptions };

export function deploy(config: SftpSyncConfig, options?: SftpSyncOptions): Bluebird<void>;

export default deploy;
