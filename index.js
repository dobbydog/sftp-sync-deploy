const SftpSync = require('./lib/sftpSync').SftpSync;

function deploy(config, options) {
  const deployer = new SftpSync(config, options);

  console.log(`* Deploying to host ${config.host}`.green);
  console.log('* local dir  = '.gray + deployer.localDir);
  console.log('* remote dir = '.gray + deployer.remoteDir);
  console.log('');

  return deployer.sync();
};

deploy.deploy = deploy.default = deploy;
module.exports = deploy;
