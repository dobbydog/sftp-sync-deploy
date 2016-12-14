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
Outputs the tasks to be done for each file in following format. Any changes of the files will not be performed.
```
[ (local file status) | (remote file status) ] (file path)
                                               -> (task)
```

### Output example
```
# Local is a file. (upload the file)
[ F | F ] index.html
          -> upload

# Local is a directory. (sync recursively)
[ D | D ] lib
          -> sync

# Excluded. (do nothing)
[ X |   ] node_modules
          -> ignore

# Remote exists but local doesn't, or is excluded. (remove the remote file or directory)
[   | F ] index.html.bak
          -> remove remote

[ X | D ] .bin
          -> remove remote

# Local and remote have the same name but the different types. (remove remote then upload local)
[ F | D ] test
          -> remove remote and upload

# Permission error in the remote server. (ignored)
[ F | ! ] secret.txt
          -> denied
