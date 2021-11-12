'use strict';
const BigNum = require('bn.js');
const axios = require('axios');
// const utils = require('./utils.js');
const {
  StacksTestnet,
  StacksMainnet
} = require('@stacks/network');
const {
  getNonce,
  makeSTXTokenTransfer,
  intToHexString, leftPadHexToLength
} = require('@stacks/transactions');
const express = require('express');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const shajs = require('sha.js')

var ec = new EC('secp256k1');

// Constants
const PORT = 8080
const HOST = '0.0.0.0';
const PUBKEY = process.env.STACKS_PUBKEY;
const PRIKEY = process.env.STACKS_PRIKEY;
const SIGNER_PUBKEY = process.env.STACKS_SIGNER_PUBKEY;
const SIGNER_PRIKEY = process.env.STACKS_SIGNER_PRIKEY;
const NETWORK = process.env.STACKS_NETWORK;
const RISIDIO_API = process.env.RISIDIO_API;
const ALLOWED_IP = process.env.STACKS_ALLOWED_IP;

const networkToUse = (NETWORK === 'mainnet') ? new StacksMainnet() : new StacksTestnet()

const mysha256 = function (message) {
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
  // const hashFunction = new sha256()
  return shajs('sha256').update(encoded).digest('hex')
  // return hashFunction.update(encoded).digest()
  // return hashSha256(encoded)
}
const signPayloadEC = function (message, privateKey) {
  const hash = mysha256(message)
  const ecPrivate = ec.keyFromPrivate(privateKey)
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
}

const broadcast = function (transaction, recipient, microstx) {
  return new Promise((resolve, reject) => {
    console.log(`transaction: ${transaction}\n`);
    const txdata = new Uint8Array(transaction.serialize())
    const headers = {
      'Content-Type': 'application/octet-stream'
    }
    axios.post(RISIDIO_API + '/mesh/v2/broadcast', txdata, { headers: headers }).then(response => {
      console.log('Successfully sent transaction from: ' + PUBKEY);
      console.log('Amount (micro stx): ' + microstx);
      console.log('To: ' + recipient);
      resolve(response.data)
    }).catch((error) => {
      console.log('Failed to post to mesh for broadcast');
      reject(error)
    })
  })
}

const fetchNonce = function () {
  return new Promise((resolve, reject) => {
    getNonce(PUBKEY, networkToUse).then((txNonce) => {
      console.log('Nonce: ' + txNonce + ' for pubkey ' + PUBKEY);
      resolve(txNonce)
    }).catch((error) => {
      console.log('Failed to fetch nonce');
      reject(error)
    })
  })
}

const makeStacksTransfer = function (recipient, microstx, txNonce) {
  return new Promise((resolve, reject) => {
    const amountBN = new BigNum(microstx)
    console.log(`microstx: ${microstx}\n`);
    console.log(`recipient: ${recipient}\n`);
    const txOptions = {
      recipient: recipient,
      amount: amountBN,
      senderKey: PRIKEY,
      network: networkToUse,
      memo: 'Stacks Mate STX Swap.'
    }
    if (txNonce) {
      console.log(`txNonce: ${txNonce}\n`);
      const nonce = new BigNum(txNonce)
      txOptions.nonce = nonce
    }
    makeSTXTokenTransfer(txOptions).then((transaction) => {
      broadcast(transaction, recipient, microstx).then((resp) => {
        console.log('Tx broadcast');
        resolve(resp)
      }).catch((error) => {
        console.log('Failed to broadcast transaction from: ' + PUBKEY);
        reject(error)
      })
    }).catch((error) => {
      console.log('Failed to make transaction from: ' + PUBKEY);
      reject(error)
    })
  })
}

function runAsyncWrapper (callback) {
  return function (req, res, next) {
    callback(req, res, next).catch((err => {
      if (typeof err === 'object' && err !== null) {
        console.log(Object.keys(err));
        if (err.response) {
          console.log(err.response.data);
          res.status(500).send(err.response.data);
        } else {
          console.log(err);
          res.status(500).send(err);
        }
      } else {
        console.log('error not object');
        res.status(500).send(err.response.data.message);
      }
      console.log('-----------------------------------------------------------------');
    }))
  }
}

// App
const app = express();
app.get('/', (req, res) => {
  res.send('hi there...');
});

app.get('/stacksmate/signme/:assetHash', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(ip); // ip address of the user
  if (ALLOWED_IP.indexOf(ip) > -1) {
    const sig = signPayloadEC(req.params.assetHash, SIGNER_PRIKEY)
    res.send(sig);
  } else {
    res.sendStatus(401);
  }
});

app.post('/stacksmate/:recipient/:microstx', runAsyncWrapper(async(req, res) => {
  const transfer = await makeStacksTransfer(req.params.recipient, req.params.microstx)
  res.send(transfer);
}))

app.post('/stacksmate/:recipient/:nonce/:microstx', runAsyncWrapper(async(req, res) => {
  let txNonce = req.params.nonce
  if (txNonce < 0) {
    txNonce = await fetchNonce()
  }
  const transfer = await makeStacksTransfer(req.params.recipient, req.params.microstx, txNonce)
  res.send(transfer);
}))

app.listen(PORT, HOST);
console.log(`Running with ${ALLOWED_IP}\n`);
console.log(`Running with ${RISIDIO_API}\n`);
console.log(`Running with ${PUBKEY}\n`);
console.log(`Running with ${SIGNER_PUBKEY}\n`);
// console.log(`Running with ${SIGNER_PRIKEY}.substring(0,6)\n`);
console.log(`Running on http://${HOST}:${PORT}\n\n`);
