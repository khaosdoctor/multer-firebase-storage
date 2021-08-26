const fbAdmin = require('firebase-admin')

/**
 * @typedef FirebaseCredentials
 * @property {string} projectId The project ID
 * @property {string} privateKey The client's RSA private key
 * @property {string} clientEmail The client's email
 **/

/**
 * @typedef MulterFirebaseOptions
 * @property {string} bucketName The bucket to upload to.
 * @property {string | FirebaseCredentials} credentials Firebase credentials
 * @property {string} [directoryPath] The destination path of the file, this will be appended to the file name
 * @property {{[fileName: string]: string}} [mimeMap] A map of file names to mime types
 * @property {string} [appName] The name of the app.
 * @property {string} [namePrefix] The prefix to prepend to the file name.
 * @property {string} [nameSuffix] The suffix to append to the file name.
 * @property {boolean} [unique] If true, will append an unique identifier to the file name. (default: false)
 * @property {boolean} [public] Whether the file should be public or not (default false)
 **/

class FirebaseStorage {
  #directoryPath = ''
  #bucket = ''
  #namePrefix = ''
  #nameSuffix = ''
  #firebase = null
  #unique = false
  #appName = ''
  #public = false
  #mimeMap = {}

  #required = (message) => { throw new Error(message) }

  /**
   * @param {MulterFirebaseOptions} opts Configuration Options
  **/
  constructor (opts, firebaseClient = null) {
    this.#directoryPath = opts.directoryPath || ''
    this.#namePrefix = opts.namePrefix || ''
    this.#nameSuffix = opts.nameSuffix || ''
    this.#mimeMap = opts.mimeMap || {}
    this.#public = opts.public || false
    this.#unique = opts.unique || false
    this.#bucket = opts.bucketName || this.#required('Bucket Name Required')
    this.#appName = opts.appName ? opts.appName : `multer-firebase-${this.#bucket}-${Date.now().toString(16)}`
    this.#firebase = firebaseClient

    if (!firebaseClient) {
      this.#validateCredentials(opts.credentials)

      this.#firebase = fbAdmin.initializeApp({
        credential: fbAdmin.credential.cert(opts.credentials),
        storageBucket: this.#bucket
      }, this.#appName)
    }
  }

  /**
   * @private
  **/
  _handleFile (_, file, cb) {
    const fileName = this.#getFileName(file)
    const bucketFile = this.#firebase.storage().bucket().file(fileName)
    const outStream = bucketFile.createWriteStream({
      metadata: {
        contentType: this.#getMimetype(file)
      }
    })
    file.stream.pipe(outStream)

    outStream.on('error', (err) => {
      cb(err)
    })

    outStream.on('finish', () => {
      let returnObject = {
        fileRef: bucketFile,
        path: fileName,
        bucket: this.#bucket,
        bucketRef: this.#firebase.storage().bucket(this.#bucket),
        isPublic: this.#public
      }
      if (this.#public) {
        bucketFile.makePublic()
        returnObject.publicUrl = bucketFile.publicUrl()
      }
      cb(null, returnObject)
    })

  }

  /**
   * @private
  **/
  _removeFile (_, file, cb) {
    const fileRef = this.#firebase.storage().bucket().file(this.#getFileName(file))
    return fileRef.delete({ ignoreNotFound: true }, cb)
  }

  #getMimetype (file) {
    const mime = this.#mimeMap[file.originalname.split('.')[0]] || this.#mimeMap['*'] || file.mimetype
    return mime
  }

  #getFileName (file) {
    return `${this.#directoryPath ? this.#directoryPath + '/' : ''}${this.#namePrefix}${file.originalname.split('.')[0]}${this.#nameSuffix}${this.#unique ? Date.now().toString(16) : ''}.${file.originalname.split('.')[1] || ''}`
  }

  #validateCredentials (credentials) {
    if (!credentials) return this.#required('Credentials Required')
    if (!['string', 'object'].includes(typeof credentials)) return this.#required('Credentials must be a string or service account object')
    if (typeof credentials === 'object'
      && !'projectId' in credentials
      || !'privateKey' in credentials
      || !'clientEmail' in credentials
    ) return this.#required('Credential model is missing keys, necessary keys are: projectId, privateKey, anc clientEmail')
    return credentials
  }
}

/**
 * @param {MulterFirebaseOptions} opts Configuration Options
 * @returns {FirebaseStorage}
 **/
module.exports = (opts, firebaseClient = null) => new FirebaseStorage(opts, firebaseClient)
