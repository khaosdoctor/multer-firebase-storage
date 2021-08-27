# multer-firebase-storage

> Multer Storage Engine for Firebase

## Installation

`npm install multer-firebase-storage`

## Usage

Using Express:

```javascript
const Express = require('express')
const Multer = require('multer')
const FirebaseStorage = require('multer-firebase-storage')
const app = new Express()

const multer = Multer({
  storage: FirebaseStorage({
    bucketName: 'your-default-bucket',
    credentials: {
      clientEmail: 'your-firebase-client-email',
      privateKey: 'your private key',
      projectId: 'your-project-id'
    }
  })
})

app.post('/file', multer.single('file'), (req, res) => {
  res.status(201).json(req.file)
})

app.listen(3000, () => {
  console.log('Example app listening on port 3000!')
})
```

## Tweaks and options

Firebase Storage supports the following setup options:

```typescript
{
    bucketName: string;
    credentials: string | { projectId: string, privateKey: string, clientEmail: string }
    directoryPath?: string
    mimeMap?: {
      [fileName: string]: string
    }
    appName?: string
    namePrefix?: string
    nameSuffix?: string
    unique?: boolean
    public?: boolean
    hooks: {
      [hookName: string]: function
    }
}
```

## Required options

- `bucketName`: The name of the bucket to upload to.
- `credentials`: The credentials to use for authentication. It can be a refresh token string or the Firebase credentials object (just like the firebase admin SDK requests).
  - Credentials can be provided by reading the Firebase Service Account JSON file and passing the contents __as an object__
  - Credentials can be a set of the following properties: `projectId`, `privateKey`, `clientEmail` which can be obtained by the Firebase console.
  - __Note:__ The `privateKey` field needs to be in the same format as in the JSON file.

### Optional options

- `directoryPath`: Will be appended to the file name to include the file in a subdirectory.
  - For example: if the file name is `image.jpg` and the directory path is `images`, the resulting file name will be `images/image.jpg`. There's no need to add a trailing slash.
- `appName`: Firebase allows only a single instance of its admin SDK to be executed per app. If you need more than one, specify the name of the app you want to use. Remember it __needs to be unique in the application__
- `namePrefix`: The prefix to be added to the file name.
  - This will append a string before the file name, but after the directory path. For example: if the file name is `image.jpg` and the prefix is `preview_`, the resulting file name will be `preview_image.jpg`.
- `nameSuffix`: The suffix to be added to the file name.
  - This will append a string after the file name, but before the file extension. For example: if the file name is `image.jpg` and the suffix is `_final`, the resulting file name will be `image_final.jpg`.
- `unique`: If set to `true`, the file name will be unique by generating a time-based hash that will be appended to the end of the file name (after `nameSuffix` and before the file extension). If set to `false`, the file name will be the same as the original file name.
  - For example: if the file name is `image.jpg` and the suffix is `_final` and `unique` is `true`, the resulting file name will be `image_final<somehashhere>.jpg`.
- `public`: If set to `true`, the file will be made public and the public URL will be returned. If set to `false`, the file will be private.
- `hooks`: Where you can define [lifecycle hooks](#lifecycle-hooks)

## Returned data

After a successful insertion, all returned data will be appended to the `req.file` object. Besides the original Multer properties, the following properties will be added:

- `fileRef`: A reference to the Firebase Storage file object. You can use that to manipulate the file after the upload has been done.
  - Common operations to this reference are: generating signed URLs, deleting the file, etc.
  - The type of this property is the same as if you were using the Firebase Storage SDK directly with `firebase.storage().bucket().file(filename)`
- `path`: The path of the file in the bucket.
- `bucket`: The name of the bucket.
- `bucketRef`: A reference to the Firebase Storage bucket object. You can use that to manipulate the bucket after the upload has been done.
  - The type of this property is the same as if you were using the Firebase Storage SDK directly with `firebase.storage().bucket(bucketname)`
- `isPublic`: If the file is public or private.
- `publicUrl`: If the file is public, the public URL will be returned.

## Using your own Firebase instance

You can pass an optional parameter to the `FirebaseStorage` constructor to use your own Firebase instance. In this case, the `credentials` and `bucket` options will be ignored.

```javascript
const Express = require('express')
const Multer = require('multer')
const fbAdmin = require('firebase-admin')
const FirebaseStorage = require('multer-firebase-storage')
const app = new Express()

const fbInstance = fbAdmin.initializeApp({
  credential: fbAdmin.credential.cert(somecredentials),
  storageBucket: 'some bucket'
})

const multer = Multer({
  storage: FirebaseStorage({}, fbInstance)
})

app.post('/file', multer.single('file'), (req, res) => {
  res.status(201).json(req.file)
})

app.listen(3000, () => {
  console.log('Example app listening on port 3000!')
})
```

## Lifecycle hooks

Multer-Firebase-Storage supports the following lifecycle hooks:

- `beforeUpload`: This hook will be called before the file is uploaded to Firebase Storage.
- `afterUpload`: This hook will be called after the file is uploaded to Firebase Storage.
- `beforeDelete`: This hook will be called before the file is deleted from Firebase Storage.
- `afterDelete`: This hook will be called after the file is deleted from Firebase Storage.
- `beforeInit`: This hook will be called before the Firebase Storage instance is initialized.
- `afterInit`: This hook will be called after the Firebase Storage instance is initialized.

Each hook has a different function signature:

- `beforeUpload`: `(req, file) => void`
  - `req` is the Express request object. `file` is the Multer file object.
- `afterUpload`: `(req, file, fileRef, bucketRef) => void`
  - `req` is the Express request object. `file` is the Multer file object. `fileRef` and `bucketRef` are the references to the Firebase Storage objects.
- `beforeDelete`: `(req, file) => void`
  - `req` is the Express request object. `file` is the Multer file object.
- `afterDelete`: `(req, file, fileRef, bucketRef) => void`
  - `req` is the Express request object. `file` is the Multer file object. `fileRef` and `bucketRef` are the references to the Firebase Storage objects.
- `beforeInit`: `(storageInstance) => void`
  - `storageInstance` is the Firebase Storage instance passed as `this`.
- `afterInit`: `(storageInstance, firebaseInstance) => void`
  - `storageInstance` is the Firebase Storage instance passed as `this`. `firebaseInstance` is the Firebase instance passed either as the second parameter to the `FirebaseStorage` constructor or the internally constructed instance.

### Usage example

```javascript
const Express = require('express')
const Multer = require('multer')
const FirebaseStorage = require('multer-firebase-storage')
const app = new Express()

const multer = Multer({
  storage: FirebaseStorage({
    bucketName: 'your-default-bucket',
    credentials: {
      clientEmail: 'your-firebase-client-email',
      privateKey: 'your private key',
      projectId: 'your-project-id'
    },
    hooks: {
      beforeInit (instance) {
        console.log(`before init:`, instance)
      },
      afterInit (instance, fb) {
        console.log(`after init:`, instance, fb)
      },
      beforeUpload (req, file) {
        console.log(`before upload:`, req, file)
      },
      afterUpload (req, file, fref, bref) {
        console.log(`after upload:`, req, file, fref, bref)
      },
      beforeRemove (req, file) {
        console.log(`before remove:`, req, file)
      },
      afterRemove (req, file, fref, bref) {
        console.log(`after remove:`, req, file, fref, bref)
      }
    }
  })
})

app.post('/file', multer.single('file'), (req, res) => {
  res.status(201).json(req.file)
})

app.listen(3000, () => {
  console.log('Example app listening on port 3000!')
})
```
