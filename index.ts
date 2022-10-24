/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fbAdmin from 'firebase-admin'
import type FirebaseRequest from 'teeny-request/build/src/index'
import type { Storage } from 'firebase-admin/lib/storage/storage'

type Nullable<T> = T | null
type MimeMap = { [fileName: string]: string }
type MulterFile = Express.Multer.File
type ExpressRequest = Express.Request
type FirebaseBucket = ReturnType<InstanceType<typeof Storage>['bucket']>
type FirebaseFile = ReturnType<FirebaseBucket['file']>
type FirebaseRequest = Parameters<FirebaseFile['delete']>['0']

export type FirebaseCredentials = {
  projectId: string
  privateKey: string
  clientEmail: string
}

export enum AvailableHooks {
  beforeUpload = 'beforeUpload',
  afterUpload = 'afterUpload',
  beforeDelete = 'beforeDelete',
  afterDelete = 'afterDelete',
  beforeInit = 'beforeInit',
  afterInit = 'afterInit',
}

interface MulterFirebaseStorageFileReference {
  fileRef: FirebaseFile,
  path: string,
  bucket: string,
  bucketRef: FirebaseBucket,
  isPublic: boolean,
  publicUrl?: string
}

/**
 * @property {string} bucketName The bucket to upload to.
 * @property {string | FirebaseCredentials} credentials Firebase credentials
 * @property {string} [directoryPath] The destination path of the file, this will be appended to the file name
 * @property {{[fileName: string]: string}} [mimeMap] A map of file names to mime types
 * @property {string} [appName] The name of the app.
 * @property {string} [namePrefix] The prefix to prepend to the file name.
 * @property {string} [nameSuffix] The suffix to append to the file name.
 * @property {boolean} [unique] If true, will append an unique identifier to the file name. (default: false)
 * @property {boolean} [public] Whether the file should be public or not (default false)
 * @property {{[hookName: string]: Hooks}} [hooks] Defined function hooks, these will be called during the lifecycle of the engine.
 **/
interface MulterFirebaseOptions {
  bucketName: string
  credentials: string | FirebaseCredentials
  directoryPath?: string
  mimeMap?: MimeMap
  appName?: string
  namePrefix?: string
  nameSuffix?: string
  unique?: boolean
  public?: boolean
  hooks?: { [hookName: string]: Hooks }
}

/**
 * @typedef Hooks
 * @property {(req: Request, file: Multer.File) => void} beforeUpload Called before the file is uploaded
 * @property {(req: Request, file: Multer.File, fileRef: Firebase.Storage.File, bucketRef: Firebase.Storage.Bucket) => void} afterUpload Called after the file is uploaded
 * @property {(req: Request, file: Multer.File) => void} beforeDelete Called after the file is uploaded
 * @property {(req: Request, file: Multer.File, fileRef: Firebase.Storage.File, bucketRef: Firebase.Storage.Bucket) => void} afterDelete Called before the file is deleted
 * @property {(instance: FirebaseStorage) => void} beforeInit Called before the Firebase client is initialized
 * @property {(instance: FirebaseStorage, client: app.App) => void} afterInit Called after the Firebase client is initialized
**/
interface Hooks {
  beforeUpload?: (req: ExpressRequest, file: MulterFile) => void
  afterUpload?: (
    req: ExpressRequest,
    file: MulterFile,
    fileRef: FirebaseFile,
    bucketRef: FirebaseBucket
  ) => void
  beforeDelete?: (req: ExpressRequest, file: MulterFile) => void
  afterDelete?: (
    req: ExpressRequest,
    file: MulterFile,
    fileRef: FirebaseFile,
    bucketRef: FirebaseBucket
  ) => void
  beforeInit?: (instance: FirebaseStorage) => void
  afterInit?: (instance: FirebaseStorage, client: fbAdmin.app.App) => void
}

class FirebaseStorage {
  #directoryPath = ''
  #bucket = ''
  #namePrefix = ''
  #nameSuffix = ''
  #firebase: Nullable<fbAdmin.app.App> = null
  #unique = false
  #appName = ''
  #public = false
  #mimeMap: MimeMap = {}
  #hooks: Hooks = {}

  #required = (message: string) => { throw new Error(message) }

  #callHook <HookName extends keyof typeof AvailableHooks> (hookName: HookName, ...params: Parameters<Required<Hooks>[HookName]>): void {
    type HookFunction = (...args: Parameters<Required<Hooks>[HookName]>) => ReturnType<Required<Hooks>[HookName]>
    type HookParameters = Parameters<Required<Hooks>[HookName]>
    type HookReturn = ReturnType<Required<Hooks>[HookName]>

    const hookToBeCalled = this.#hooks[hookName]
    if (hookToBeCalled) {
      return (hookToBeCalled as unknown as HookFunction).call<ThisType<FirebaseStorage>, HookParameters, HookReturn>(this, ...params)
    }
  }

  /**
   * @param {MulterFirebaseOptions} opts Configuration Options
  **/
  constructor (opts: MulterFirebaseOptions, firebaseClient: fbAdmin.app.App | null) {
    this.#directoryPath = opts.directoryPath || ''
    this.#namePrefix = opts.namePrefix || ''
    this.#nameSuffix = opts.nameSuffix || ''
    this.#mimeMap = opts.mimeMap || {}
    this.#public = opts.public || false
    this.#unique = opts.unique || false
    this.#hooks = opts.hooks || {}
    this.#bucket = opts.bucketName || this.#required('Bucket Name Required')
    this.#appName = opts.appName ? opts.appName : `multer-firebase-${this.#bucket}-${Date.now().toString(16)}`
    this.#firebase = firebaseClient

    this.#callHook('beforeInit', this)

    if (!firebaseClient) {
      this.#validateCredentials(opts.credentials)

      this.#firebase = fbAdmin.initializeApp({
        credential: fbAdmin.credential.cert(opts.credentials),
        storageBucket: this.#bucket
      }, this.#appName)
    }

    this.#callHook('afterInit', this, this.#firebase as fbAdmin.app.App)
  }

  /**
   * @private
  **/
  _handleFile (req: ExpressRequest, file: MulterFile, cb: (err: Error | null, info?: MulterFirebaseStorageFileReference) => void) {
    this.#callHook('beforeUpload', req, file)
    const fileName = this.#getFileName(file)
    const bucketFile = this.#firebase!.storage().bucket().file(fileName)
    const outStream = bucketFile.createWriteStream({
      metadata: {
        contentType: this.#getMimetype(file)
      }
    })
    file.stream.pipe(outStream)

    outStream.on('error', (err: Error) => {
      cb(err)
    })

    outStream.on('finish', () => {
      const returnObject: MulterFirebaseStorageFileReference = {
        fileRef: bucketFile,
        path: fileName,
        bucket: this.#bucket,
        bucketRef: this.#firebase!.storage().bucket(this.#bucket),
        isPublic: this.#public,
      }
      if (this.#public) {
        bucketFile.makePublic()
        returnObject.publicUrl = bucketFile.publicUrl()
      }
      this.#callHook('afterUpload', req, file, returnObject.fileRef, returnObject.bucketRef)
      cb(null, returnObject)
    })

  }

  /**
   * @private
  **/
  _removeFile (req: ExpressRequest, file: MulterFile, cb: (err: Error | null, data?: unknown) => void) {
    this.#callHook('beforeDelete', req, file)
    const fileRef = this.#firebase!.storage().bucket().file(this.#getFileName(file))

    fileRef.delete({ ignoreNotFound: true }, (err: Error | null, data?: FirebaseRequest.Response) => {
      this.#callHook('afterDelete', req, file, fileRef, this.#firebase!.storage().bucket(this.#bucket))
      cb(err, data)
    })
  }

  #getMimetype (file: MulterFile) {
    const mime = this.#mimeMap[file.originalname.split('.')[0]] || this.#mimeMap['*'] || file.mimetype
    return mime
  }

  #getFileName (file: MulterFile) {
    return `${this.#directoryPath ? this.#directoryPath + '/' : ''}${this.#namePrefix}${file.originalname.split('.')[0]}${this.#nameSuffix}${this.#unique ? Date.now().toString(16) : ''}.${file.originalname.split('.')[1] || ''}`
  }

  #validateCredentials (credentials: string | FirebaseCredentials) {
    if (!credentials) return this.#required('Credentials Required')
    if (!['string', 'object'].includes(typeof credentials)) return this.#required('Credentials must be a string or service account object')
    if (typeof credentials === 'object' &&
      !(credentials as FirebaseCredentials).projectId || !(credentials as FirebaseCredentials).privateKey || !(credentials as FirebaseCredentials).clientEmail) return this.#required('Credentials must be a string or service account object')
    return credentials
  }
}

/**
 * @param {MulterFirebaseOptions} opts Configuration Options
 * @returns {FirebaseStorage}
 **/
module.exports = (opts: MulterFirebaseOptions, firebaseClient: Nullable<fbAdmin.app.App> = null) => new FirebaseStorage(opts, firebaseClient)

