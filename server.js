'use strict';
const BigNum = require('bn.js');
const axios = require('axios');
const {
  StacksTestnet,
  StacksMainnet
} = require('@stacks/network');
const {
  getNonce,
  makeSTXTokenTransfer
} = require('@stacks/transactions');
const express = require('express');

// Constants
const PORT = 8080
const HOST = '0.0.0.0';
const PUBKEY = process.env.STACKS_PUBKEY;
const PRIKEY = process.env.STACKS_PRIKEY;
const NETWORK = process.env.STACKS_NETWORK;
const RISIDIO_API = process.env.RISIDIO_API;

const networkToUse = (NETWORK === 'mainnet') ? new StacksMainnet() : new StacksTestnet()

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
console.log(`Running with ${RISIDIO_API}\n`);
console.log(`Running with ${PUBKEY}\n`);
console.log(`Running with ${PRIKEY}\n`);
console.log(`Running on http://${HOST}:${PORT}\n\n`);
