# sftp-sync-deploy
Sync local files to remote using SFTP.

## Usage

### Javscript
```js
const deploy = require('sftp-sync-deploy');

let config = {
  host: 'example.com',            // required.
  port: 22,                       // optional. Default to 22.
  username: 'user',               // required.
  password: 'password',           // optional.
  privateKey: '/pass/to/key.pem', // optional.
  passphrase: 'passphrase',       // optional.
  localDir: 'dist',               // required. Absolute or relative to cwd
  remoteDir: '/pass/to/dest'      // required. Absolute path only. 
};

let options = {
  dryRun: false,                  // enable dry-run mode
  exclude: [                      // exclude pattern (glob)
    'node_modules',
    'src/**/*.spec.ts'
  ]
};

deploy(config, options).then(() => {
  console.log('success!');
}).catch(err => {
  console.error('error! ', err);
})
```

### TypeScript
```ts
import { deploy, SftpSyncConfig, SftpSyncOptions } from 'sftp-sync-deploy';

let config: SftpSyncConfig = {...};
let options: SftpSyncOptions = {...};

deploy(config, options);
```

## Dry run mode
```js
deploy(config, {dryRun: true});
```
```
# Local is a file. (upload the file)
[ F | F ] index.html
          -> upload

# Both local and remote are directories. (sync recursively)
[ D | D ] lib
          -> sync

# Local is a directory and remote doesn't exist. (upload the whole directory)
[ D |   ] assets
          -> upload

# Remote exists but local doesn't, or is excluded. (remove the remote file or directory)
[   | F ] index.html.bak
          -> remove remote

[ X | D ] .bin
          -> remove remote

# Excluded. (do nothing)
[ X |   ] node_modules
          -> ignore

# Local and remote have same name but different type. (remove remote then upload local)
[ F | D ] test
          -> remove remote and upload
