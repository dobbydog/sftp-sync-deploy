# sftp-deploy
Sync local files to remote using SFTP.

## Usage
```js
const sftpDeploy = require('sftp-deploy');

let config = {
  host: 'example.com',            // required.
  port: 22,                       // optional.
  username: 'user',               // required.
  password: 'password',           // optional.
  privateKey: '/pass/to/key.pem', // optional.
  passphrase: 'passphrase',       // optional.
  localDir: 'dist',               // required. Absolute or relative to cwd
  remoteDir: '/pass/to/dest'      // required. Absolute path only. 
};

let options = {
  dryRun: false                   // enable dry-run mode
};

sftpDeploy(config, options).then(() => {
  console.log('success!');
}).catch(err => {
  console.error('error! ', err);
})
