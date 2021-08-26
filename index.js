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
 * @property {appName} [appName] The name of the app.
 * @property {string} destination The destination path of the file, this will be appended to the file name
 * @property {string | FirebaseCredentials} credentials Firebase credentials
 * @property {string} [nameKey] The request key to use for the file name, if omitted the `file.name` property will be used
 * @property {boolean} [public] Whether the file should be public or not
 **/

class FirebaseStorage {
  #destination = ''
  #bucket = ''
  #nameKey = null
  #firebase = null
  #appName = ''
  #public = false
  #required = (message) => { throw new Error(message) }

  /**
   * @param {MulterFirebaseOptions} opts Configuration Options
  **/
  constructor (opts) {
    this.#destination = opts.destination || ''
    this.#public = opts.public || false
    this.#bucket = opts.bucketName || this.#required('Bucket Name Required')
    this.#appName = opts.appName ? opts.appName : `multer-firebase-${this.#bucket}-${Date.now().toString(16)}`
    this.#validateCredentials(opts.credentials)

    this.#firebase = fbAdmin.initializeApp({
      credential: fbAdmin.credential.cert(opts.credentials),
      storageBucket: this.#bucket
    }, this.#appName)
    this.#nameKey = opts.nameKey || null
  }

  _handleFile (req, file, cb) {
    const fileName = this.#getFileName(req, file)
    const bucketFile = this.#firebase.storage().bucket().file(fileName)
    const outStream = fileRef.createWriteStream({
      metadata: {
        contentType: file.mimetype
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
        isPublic: this.#public
      }
      if (this.#public) {
        bucketFile.makePublic()
        returnObject.publicUrl = bucketFile.publicUrl()
      }
      cb(null, returnObject)
    })

  }

  _removeFile (req, file, cb) {
    const fileRef = this.#firebase.storage().bucket().file(this.#getFileName(req, file))
    return fileRef.delete({ ignoreNotFound: true }, cb)
  }

  #extractInfo (file) {
    const mime = file.mimetype
    return { mime, extension: mime.split('/').pop() }
  }

  #getFileName (req, file) {
    const info = this.#extractInfo(file)
    if (this.#nameKey) {
      return `${this.#destination ? this.#destination + '/' : ''}${req[this.#nameKey]}.${info.extension}`
    }
    return `${this.#destination ? this.#destination + '/' : ''}${file.originalName}.${info.extension}`
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
module.exports = (opts) => new FirebaseStorage(opts)
