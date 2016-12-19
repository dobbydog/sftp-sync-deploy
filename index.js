const SftpSync = require('./lib/sftpSync').SftpSync;

function deploy(config, options) {
  const deployer = new SftpSync(config, options);

  console.log(`* Deploying to host ${config.host}`.green);
  console.log('* local dir  = '.gray + deployer.localRoot);
  console.log('* remote dir = '.gray + deployer.remoteRoot);
  console.log('');

  return deployer.sync();
};

deploy.deploy = deploy.default = deploy;
module.exports = deploy;
