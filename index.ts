import * as Bluebird from 'bluebird';
import chalk from 'chalk';
import { SftpSyncConfig, SftpSyncOptions } from './lib/config';
import { SftpSync } from './lib/sftpSync';

export function deploy(config: SftpSyncConfig, options?: SftpSyncOptions): Bluebird<void> {
  const deployer = new SftpSync(config, options);

  console.log(chalk.green(`* Deploying to host ${config.host}`));
  console.log(chalk.grey('* local dir  = ') + deployer.localRoot);
  console.log(chalk.grey('* remote dir = ') + deployer.remoteRoot);
  console.log('');

  return deployer.sync();
};

export default deploy;
export * from './lib/sftpSync';
export * from './lib/config';
