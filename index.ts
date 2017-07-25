import * as Bluebird from 'bluebird';
import { SftpSyncConfig, SftpSyncOptions } from './lib/config';
import { SftpSync } from './lib/sftpSync';

export function deploy(config: SftpSyncConfig, options?: SftpSyncOptions): Bluebird<void> {
  const deployer = new SftpSync(config, options);

  console.log(`* Deploying to host ${config.host}`.green);
  console.log('* local dir  = '.gray + deployer.localRoot);
  console.log('* remote dir = '.gray + deployer.remoteRoot);
  console.log('');

  return deployer.sync();
};

export default deploy;
export * from './lib/sftpSync';
export * from './lib/config';
