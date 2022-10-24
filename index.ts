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

/**
 * Subset of all firebase credentials with only the needed keys for the engine
 */
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

/**
 * Reference object from the uploaded file
 */
interface MulterFirebaseStorageFileReference {
  /**
   * The file reference object in firebase, this is not the file itself
   * You can use firebase functions on this reference like delete and others
   */
  fileRef: FirebaseFile,
  /**
   * The file path
   */
  path: string,
  /**
   * Bucket name
   */
  bucket: string,
  /**
   * The reference to the bucket in firebase to be manipulated
   */
  bucketRef: FirebaseBucket,
  /**
   * The file is public or not
   */
  isPublic: boolean,
  /**
   * If isPublic is true, this is the url to the file otherwise is undefined
   */
  publicUrl?: string
}

interface MulterFirebaseOptions {
  /**
   * The bucket to upload to.
   */
  bucketName: string
  /**
   * Firebase credentials
   */
  credentials: string | FirebaseCredentials
  /**
   * The destination path of the file, this will be appended to the file name
   */
  directoryPath?: string
  /**
   * A map of file names to mime types
   */
  mimeMap?: MimeMap
  /**
   * The name of the app.
   */
  appName?: string
  /**
   * The prefix to prepend to the file name.
   */
  namePrefix?: string
  /**
   * The suffix to append to the file name.
   */
  nameSuffix?: string
  /**
   * If true, will append an unique identifier to the file name. (default: false)
   */
  unique?: boolean
  /**
   * Whether the file should be public or not (default false)
   */
  public?: boolean
  /**
   * Defined function hooks, these will be called during the lifecycle of the engine.
   */
  hooks?: { [hookName: string]: Hooks }
}

interface Hooks {
  /**
   * Called before the file is uploaded
   */
  beforeUpload?: (req: ExpressRequest, file: MulterFile) => void
  /**
   * Called after the file is uploaded
   */
  afterUpload?: (
    req: ExpressRequest,
    file: MulterFile,
    fileRef: FirebaseFile,
    bucketRef: FirebaseBucket
  ) => void
  /**
   * Called before the file is deleted
   */
  beforeDelete?: (req: ExpressRequest, file: MulterFile) => void
  /**
   * Called after the file is deleted
   */
  afterDelete?: (
    req: ExpressRequest,
    file: MulterFile,
    fileRef: FirebaseFile,
    bucketRef: FirebaseBucket
  ) => void
  /**
   * Called before the Firebase client is initialized
   */
  beforeInit?: (instance: FirebaseStorage) => void
  /**
   * Called after the Firebase client is initialized
   */
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
 * The firebase storage engine for multer
*/
export default function (opts: MulterFirebaseOptions, firebaseClient: fbAdmin.app.App | null = null): FirebaseStorage {
  return new FirebaseStorage(opts, firebaseClient)
}
module.exports = (opts: MulterFirebaseOptions, firebaseClient: Nullable<fbAdmin.app.App> = null) => new FirebaseStorage(opts, firebaseClient)

