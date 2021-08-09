'use strict';
const BigNum = require('bn.js');
const axios = require('axios');
const {
  StacksTestnet,
  StacksMainnet
} = require('@stacks/network');
const {
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

const makeStacksTransfer = function (recipient, microstx) {
  return new Promise((resolve, reject) => {
    const amountBN = new BigNum(microstx)
    const senderKey = PRIKEY
    const txOptions = {
      recipient: recipient,
      amount: amountBN,
      senderKey: senderKey,
      network: networkToUse,
      memo: 'Stacks Mate STX Swap.'
    }
    makeSTXTokenTransfer(txOptions).then((transaction) => {
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
        console.log('Failed to send transaction from: ' + PUBKEY, error);
        console.log('Amount (micro stx): ' + microstx);
        console.log('To: ' + recipient);
        reject(error)
      })
    }).catch((error) => {
      console.log('Failed to send transaction from: ' + PUBKEY, error);
      reject(error)
    })
  })
}

// App
const app = express();
app.get('/', (req, res) => {
  res.send('Hello World');
});
app.get('/stxswap/:recipient/:microstx', (req, res) => {
  makeStacksTransfer(req.params.recipient, req.params.microstx).then((resp) => {
    res.send(resp);
  }).catch((err) => {
    res.sendStatus(500);
  })
});

app.listen(PORT, HOST);
console.log(`Running with ${RISIDIO_API}\n`);
console.log(`Running with ${PUBKEY}\n`);
console.log(`Running with ${PRIKEY}\n`);
console.log(`Running on http://${HOST}:${PORT}\n\n`);
