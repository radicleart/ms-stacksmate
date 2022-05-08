'use strict';
const BigNum = require('bn.js');
const axios = require('axios');

const {
  StacksTestnet,
  StacksMainnet
} = require('@stacks/network');
const {
  uintCV,
  standardPrincipalCV,
  listCV,
  tupleCV,
  getNonce,
  makeSTXTokenTransfer,
  intToHexString,
  leftPadHexToLength,
  PostConditionMode,
  FungibleConditionCode,
  NonFungibleConditionCode,
  makeContractCall,
  createAssetInfo,
  broadcastTransaction,
  makeStandardSTXPostCondition,
  makeStandardFungiblePostCondition,
  makeStandardNonFungiblePostCondition
} = require('@stacks/transactions');
const express = require('express');
const crypto = require('crypto');
const EC = require('elliptic').ec;
const shajs = require('sha.js');
const { resolve } = require('path');

var ec = new EC('secp256k1');

// Constants
const PORT = 8080
const HOST = '0.0.0.0';
const PUBKEY = process.env.STACKS_PUBKEY;
const PRIKEY = process.env.STACKS_PRIKEY;
const OPENNODE_API_KEY_SM = process.env.OPENNODE_API_KEY_SM;
const SIGNER_PUBKEY = process.env.STACKS_SIGNER_PUBKEY;
const SIGNER_PRIKEY = process.env.STACKS_SIGNER_PRIKEY;
const NETWORK = process.env.STACKS_NETWORK;
const RISIDIO_API = process.env.RISIDIO_API;
const ALLOWED_IP = process.env.STACKS_ALLOWED_IP;

const networkToUse = (NETWORK === 'mainnet') ? new StacksMainnet() : new StacksTestnet()

const toOnChainAmount = function (amount, gftPrecision) {
  try {
    if (!gftPrecision) {
      amount = amount * precision
      return Math.round(amount * precision) / precision
    } else {
      const newPrec = Math.pow(10, gftPrecision)
      amount = amount * newPrec
      return Math.round(amount * newPrec) / newPrec
    }
  } catch {
    return 0
  }
}
const getAdminMintManyArgs = function (data) {
  const entryList = []
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i]
    const tupCV = tupleCV({
      recipient: standardPrincipalCV(entry.recipient),
      nftIndex: uintCV(entry.nftIndex)
    })
    entryList.push(tupCV)
  }
  return [listCV(entryList)]
}

const getAdminMintManySfts = function (data) {
  const entryList = []
  for (let i = 0; i < data.entries.length; i++) {
    const entry = data.entries[i]
    const tupCV = tupleCV({
      nftIndex: uintCV(entry.nftIndex),
      amount: uintCV(entry.amount),
      recipient: standardPrincipalCV(entry.recipient)
    })
    entryList.push(tupCV)
  }
  return [listCV(entryList)]
}

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
const getSTXMintPostConds = function (data) {
  let postConditionAddress = data.recipient
  let amount = new BigNum(toOnChainAmount(data.price + 0.001))
  if (data.batchOption > 1) {
    amount = new BigNum(toOnChainAmount((data.price * data.batchOption + 0.001)))
  }
  const standardFungiblePostCondition = makeStandardSTXPostCondition(postConditionAddress, FungibleConditionCode.Less, amount)
  const postConds = [standardFungiblePostCondition]
  return postConds
}
const getGFTMintPostConds = function (data) {
  let postConditionAddress = data.recipient
  const postConditionCode = FungibleConditionCode.LessEqual
  const postConditionAmount = new BigNum(toOnChainAmount((data.price * data.batchOption + 0.001), data.sipTenToken.decimals))
  const fungibleAssetInfo = createAssetInfo(data.sipTenToken.contractId.split('.')[0], data.sipTenToken.contractId.split('.')[1], data.sipTenToken.contractId.split('.')[1])
  const standardFungiblePostCondition = makeStandardFungiblePostCondition(postConditionAddress, postConditionCode, postConditionAmount, fungibleAssetInfo)
  const postConds = [standardFungiblePostCondition]
  return postConds
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
const checkOpenNodeApiKey = function (data) {
  const received = data.hashed_order;
  const calculated = crypto.createHmac('sha256', OPENNODE_API_KEY_SM).update(data.paymentId).digest('hex');
  if (received !== calculated) {
    console.log('checkOpenNodeApiKey: received=' + received);
    console.log('checkOpenNodeApiKey: calculated=' + calculated);
    console.log('checkOpenNodeApiKey: paymentId=' + paymentId);
    return false
  }
  return true
}

const transferNFT = function (data) {
  return new Promise((resolve, reject) => {
    if (!data.batchOption) data.batchOption = 1
    console.log('transfer nft: data=', data);
    if (!checkOpenNodeApiKey(data)) throw new Error('Not called via open node!')
    const nonFungibleAssetInfo = createAssetInfo(
      data.contractId.split('.')[0],
      data.contractId.split('.')[1],
      (data.assetName) ? data.assetName : data.contractName.split('-')[0]
    )
    // Post-condition check failure on non-fungible asset ST1ESYCGJB5Z5NBHS39XPC70PGC14WAQK5XXNQYDW.thisisnumberone-v1::my-nft owned by STFJEDEQB1Y1CQ7F04CS62DCS5MXZVSNXXN413ZG: UInt(3) Sent
    const standardNonFungiblePostCondition = makeStandardNonFungiblePostCondition(
      data.owner, // postConditionAddress
      NonFungibleConditionCode.DoesNotOwn,
      nonFungibleAssetInfo, // contract and nft info
      uintCV(data.nftIndex)
    )
    const txOptions = {
      contractAddress: data.contractId.split('.')[0],
      contractName: data.contractId.split('.')[1],
      fee: new BigNum(50000),
      functionName: 'transfer',
      functionArgs: [uintCV(data.nftIndex), standardPrincipalCV(data.owner), standardPrincipalCV(data.recipient)],
      senderKey: PRIKEY,
      network: networkToUse,
      postConditions: [standardNonFungiblePostCondition],
    };
    makeContractCall(txOptions).then((transaction) => {
      broadcastTransaction(transaction, networkToUse).then((response) => {
        console.log('transferNFT: Tx broadcast', response);
        resolve(response)
      }).catch((error) => {
        console.log('Failed to broadcast: ' + error);
        reject(error)
      })
    })
  })
}
const mintNFT = function (data) {
  return new Promise((resolve, reject) => {
    if (!data.batchOption) data.batchOption = 1
    console.log('mint nft: data=', data);
    if (!checkOpenNodeApiKey(data)) throw new Error('Not called via open node!')
    // const tender = contractPrincipalCV(data.tokenContractAddress, data.tokenContractName)
    const localPCs = [] // (data.tokenContractName === 'unwrapped-stx-token') ? getSTXMintPostConds(data) : getGFTMintPostConds(data)
    const txOptions = {
      senderKey: PRIKEY,
      network: networkToUse,
      fee: new BigNum(5000),
      postConditionMode: (data.postConditionMode) ? data.postConditionMode : PostConditionMode.Deny,
      postConditions: (data.postConditions) ? data.postConditions : localPCs,
      contractAddress: data.contractId.split('.')[0],
      contractName: data.contractId.split('.')[1],
      functionName: (data.batchOption === 1) ? 'mint-with' : 'mint-with-many',
      functionArgs: (data.batchOption === 1) ? [tender] : [uintCV(data.batchOption), tender]
    }
    makeContractCall(txOptions).then((transaction) => {
      broadcastTransaction(transaction, networkToUse).then((response) => {
        console.log('mintNFT: Tx broadcast', response);
        resolve(response)
      }).catch((error) => {
        console.log('Failed to broadcast transaction: ' + error);
        reject(error)
      })
    })
  })
}
const adminMintNFT = function (data) {
  return new Promise((resolve, reject) => {
    if (!data.batchOption) data.batchOption = 1
    console.log('admin mint nft: data=', data);
    if (!checkOpenNodeApiKey(data)) throw new Error('Not called via open node!')
    // const tender = contractPrincipalCV(data.tokenContractAddress, data.tokenContractName)
    const localPCs = [] // (data.tokenContractName === 'unwrapped-stx-token') ? getSTXMintPostConds(data) : getGFTMintPostConds(data)
    const txOptions = {
      senderKey: PRIKEY,
      network: networkToUse,
      fee: new BigNum(5000),
      postConditionMode: (data.postConditionMode) ? data.postConditionMode : PostConditionMode.Deny,
      postConditions: (data.postConditions) ? data.postConditions : localPCs,
      contractAddress: data.contractId.split('.')[0],
      contractName: data.contractId.split('.')[1],
      functionName: (data.batchOption === 1) ? 'admin-mint' : 'admin-mint-many'
    }
    if (data.batchOption === 1) {
      txOptions.functionArgs = [standardPrincipalCV(data.recipient), uintCV(data.nftIndex)]
    } else {
      txOptions.functionArgs = getAdminMintManyArgs(data)
    }
    makeContractCall(txOptions).then((transaction) => {
      broadcastTransaction(transaction, networkToUse).then((response) => {
        console.log('mintNFT: Tx broadcast', response);
        resolve(response)
      }).catch((error) => {
        console.log('Failed to broadcast transaction: ' + error);
        reject(error)
      })
    })
  })
}
const adminMintSFT = function (data) {
  return new Promise((resolve, reject) => {
    if (!data.batchOption) data.batchOption = 1
    console.log('admin mint sft: data=', data);
    if (!checkOpenNodeApiKey(data)) throw new Error('Not called via open node!')
    const localPCs = []
    const txOptions = {
      senderKey: PRIKEY,
      network: networkToUse,
      fee: new BigNum(5000),
      postConditionMode: (data.postConditionMode) ? data.postConditionMode : PostConditionMode.Deny,
      postConditions: (data.postConditions) ? data.postConditions : localPCs,
      contractAddress: data.contractId.split('.')[0],
      contractName: data.contractId.split('.')[1],
      functionName: (data.batchOption === 1) ? 'admin-mint' : 'admin-mint-many'
    }
    if (data.batchOption === 1) {
      txOptions.functionArgs = [uintCV(data.nftIndex), uintCV(data.amount), standardPrincipalCV(data.recipient)]
    } else {
      txOptions.functionArgs = getAdminMintManySfts(data)
    }
    makeContractCall(txOptions).then((transaction) => {
      broadcastTransaction(transaction, networkToUse).then((response) => {
        console.log('mintSFT: Tx broadcast', response);
        resolve(response)
      }).catch((error) => {
        console.log('Failed to broadcast transaction: ' + error);
        reject(error)
      })
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
app.use(express.json())

app.get('/', (req, res) => {
  res.send('hi there...');
});

app.get('/stacksmate/signme/:assetHash', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(ip); // ip address of the user
  if (ip.indexOf(ALLOWED_IP) > -1) {
    const sig = signPayloadEC(req.params.assetHash, SIGNER_PRIKEY)
    res.send(sig);
  } else {
    res.sendStatus(401);
  }
});

app.post('/stacksmate/transfer-nft', runAsyncWrapper(async(req, res) => {
  const transfer = await transferNFT(req.body)
  res.send(transfer);
}))

app.post('/stacksmate/mint-nft', runAsyncWrapper(async(req, res) => {
  const transfer = await mintNFT(req.body)
  res.send(transfer);
}))

app.post('/stacksmate/admin-mint-nft', runAsyncWrapper(async(req, res) => {
  const transfer = await adminMintNFT(req.body)
  res.send(transfer);
}))

app.post('/stacksmate/admin-mint-sft', runAsyncWrapper(async(req, res) => {
  const transfer = await adminMintSFT(req.body)
  res.send(transfer);
}))

app.post('/stacksmate/:tokenId/:sender/:recipient', runAsyncWrapper(async(req, res) => {
  const transfer = await makeStacksTransfer(req.params.recipient, req.params.microstx)
  res.send(transfer);
}))

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
console.log(`Running with ${OPENNODE_API_KEY_SM}\n`);
// console.log(`Running with ${SIGNER_PRIKEY}.substring(0,6)\n`);
console.log(`Running on http://${HOST}:${PORT}\n\n`);
