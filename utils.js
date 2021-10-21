const crypto = require('crypto');
const intToHexString = require('@stacks/transactions');
const leftPadHexToLength = require('@stacks/transactions');
const makeECPrivateKey = require('@stacks/encryption');
const publicKeyToAddress = require('@stacks/encryption');
const signECDSA = require('@stacks/encryption');
const verifyECDSA = require('@stacks/encryption');
const encryptECIES = require('@stacks/encryption');
const decryptECIES = require('@stacks/encryption');
const SECP256K1Client = require('jsontokens');
const EllipticCurve = require('elliptic');
const sha256 = require('sha.js');

const ecurve = new EllipticCurve('secp256k1')

const utils = {
  sha256: function (message) {
    let encoded
    if (typeof message === 'string') {
      encoded = new TextEncoder().encode(message)
    } else if (typeof message === 'number') {
      // const buf = Buffer.alloc(8)
      // buf.writeUInt8(message, 0)
      // encoded = new Uint8Array(buf)
      const buf = Buffer.alloc(16)
      buf.writeUIntLE(message, 0, 6)
      encoded = Uint8Array.from(buf)
    } else {
      // encoded = new Uint8Array(message)
      encoded = Uint8Array.from(message)
    }
    // eslint-disable-next-line new-cap
    const hashFunction = new sha256()
    return hashFunction.update(encoded).digest()
    // return hashSha256(encoded)
  },
  signPayloadEC: function (message, privateKey) {
    const hash = this.sha256(message)
    const ecPrivate = ecurve.keyFromPrivate(privateKey)
    const signature = ecPrivate.sign(hash)
    const coordinateValueBytes = 32
    const r = leftPadHexToLength(signature.r.toString('hex'), coordinateValueBytes * 2)
    const s = leftPadHexToLength(signature.s.toString('hex'), coordinateValueBytes * 2)
    if (signature.recoveryParam === undefined || signature.recoveryParam === null) {
      throw new Error('"signature.recoveryParam" is not set')
    }
    const recoveryParam = intToHexString(signature.recoveryParam, 1)
    console.log('signature.recoveryParam', signature.recoveryParam)
    const recoverableSignatureString = r + s + recoveryParam
    // const combined = r + s
    // return Buffer.from(combined, 'hex')
    // return (Buffer.from(recoverableSignatureString, 'hex'))
    return recoverableSignatureString
  },
  makeKeys: function () {
    const privateKey = makeECPrivateKey()
    const publicKey = SECP256K1Client.derivePublicKey(privateKey)
    const address = publicKeyToAddress(publicKey)
    return {
      privateKey: privateKey,
      publicKey: publicKey,
      address: address
    }
  },
  encryptWithPubKey: function (publicKey, privateKey, message) {
    return new Promise((resolve) => {
      // Encrypt string with public key
      encryptECIES(publicKey, Buffer.from(message), true).then((cipherObj) => {
        // Decrypt the cipher with private key to get the message
        decryptECIES(privateKey, cipherObj).then((deciphered) => {
          resolve(deciphered)
        })
      })
    })
  },
  signWithPrivKey: async function (privateKey, message) {
    // Encrypt string with public key
    const sigObj = await signECDSA(privateKey, message)
    // Verify content using ECDSA
    const result = await verifyECDSA(message, sigObj.publicKey, sigObj.signature)
    return (result) ? sigObj : null
  },
  buildHash: function (hashable) {
    return crypto.createHash('sha256').update(hashable).digest('hex')
  }
}
export default utils
