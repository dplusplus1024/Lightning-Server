import path from 'path';
import { promises as fs } from 'fs';
// import * as nostr from 'nostr-tools';
import crypto from 'crypto';
import 'websocket-polyfill';
import bolt11 from 'bolt11';
import { NextResponse } from 'next/server';

/* for nostr */
const publicKey  = "910bf554c8cb3384798d5b1402b79810a44b304c5c8fe1b27d396223e5a04f0e";
const privateKey = "47ba38891712fa4e0e2837e03a80fcdbdd1cecdfc3ea126694ca6c42b9f8c0dc";
const relays = [
  "wss://relay.damus.io",
  "wss://nostr.mutinywallet.com",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://nostr.fmt.wiz.biz",
  "wss://relay.nostr.bg",
  "wss://nostr.oxtr.dev",
];

/* for LND */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

var startTime, preimage;
const timeoutDuration = 300000; // 5 minutes in milliseconds

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
  //return crypto.createHash('sha256').update(data).digest();
}

const loaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

const packageDefinition = protoLoader.loadSync(
  path.join(process.cwd(), 'files/lightning.proto'),
  loaderOptions
);
const lnrpc = grpc.loadPackageDefinition(packageDefinition).lnrpc;
// Dread's Start9 invoice macaroon
const invMacaroon = "0201036c6e64024f030a10e167061dd8992ff69ce2465ca42f6c901201301a0c0a04696e666f1204726561641a170a08696e766f69636573120472656164120577726974651a100a086f6666636861696e1204726561640000062053add79380c49b8ec1a836d2939178c9f54d23988ae972b9f8c4e465a8ce8d07";
const socket = "chu4oq6qwjfnxiyyvpyfcmznsjuyx5peg56bixzbnfxal6jw4idwxeyd.onion:10009";
// D's invoice macaroon
// const invMacaroon = "0201036C6E640258030A1076C83CCD62C8FEE0EF7D7E107DDC62FD1201301A160A0761646472657373120472656164120577726974651A170A08696E766F69636573120472656164120577726974651A0F0A076F6E636861696E12047265616400000620C62E99D6B11CB72385CD10B681E8C3CF8DB4DD55A6727FDC0D085384E4672014";
process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA:ECDHE-RSA-AES128-GCM-SHA256';
const lndCert = null; // voltage doesn't want a cert
const sslCreds = grpc.credentials.createSsl(lndCert);
const macaroonCreds = grpc.credentials.createFromMetadataGenerator(function (args,callback) {
  let metadata = new grpc.Metadata();
  metadata.add('macaroon', invMacaroon); // invoice macaroon
  callback(null, metadata);
});
const creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
const lightning = new lnrpc.Lightning(socket, creds);

// get bolt 11 invoice from node in amount specified
function createInvoice(user, address, amount, descriptionHash, comment) {
  if (user == 'bazaar') {
    comment = "BAZAAR:" + comment;
  }
  if (comment == undefined)
    comment = `Sent to: ${address} | I love you!`;
  else {
    if (user == 'glitch') {
      comment = "GLITCH:" + comment;
    }
    else if (user == 'halving') {
      comment = "HALVING:" + comment;
    }
    else {
      // may change max comment to be more than 64 in the future?
      comment = comment.slice(0,64);
      comment = `Sent to: ${address} | Comment: ${comment}`;
    }
  }
  let requestInvoice = {
    memo: comment,
    description_hash: Buffer.from(descriptionHash, 'hex'),
    //description_hash: descriptionHash,
    value_msat: amount, // in millisatoshis
    // value: amount,   // in satoshis
  }
  //create invoice
  return new Promise(function(resolve, reject) {
    lightning.addInvoice(requestInvoice, function(err, response) {
       // console.log(response);
       resolve(response.payment_request);
    });
 });
}

// using this invoice as a data store for nostr zaps... sorry lND!
// function createDataInvoice(data) {
//   let memo = {};
//   data = JSON.parse(data);
//   console.log("data from nostr zap:");
//   console.log(data);
//   console.log("end data from nostr zap");
//   memo.pubkey = data.pubkey;
//   memo.content = data.content;
//   memo.event = data.tags.find(tag => tag[0] === 'e')?.[1];
//
//   let requestInvoice = {
//     memo: JSON.stringify(memo),
//     r_preimage: preimage,
//     value_msat: 0, // in millisatoshis
//   }
//
//   const r_hash = crypto.createHash('sha256').update(preimage).digest();
//   console.log("expected r_hash:");
//   console.log(r_hash);
//
//   lightning.addInvoice(requestInvoice, function(err, response) {
//     console.log("Created a data store!");
//     console.log(response);
//     console.log('end response');
//   });
// }
//
// function createNostrInvoice(amount, descriptionHash) {
//   let requestInvoice = {
//     memo: "Zap!",
//     description_hash: Buffer.from(descriptionHash, 'hex'),
//     //description_hash: descriptionHash,
//     value_msat: amount, // in millisatoshis
//   }
//
//   return new Promise(function(resolve, reject) {
//     lightning.addInvoice(requestInvoice, function(err, response) {
//        // create a new invoice linked to this one for a data store
//        // to link them, we'll use this invoice's hash as its preimage
//        console.log("hash for first invoice:");
//        console.log(response.r_hash);
//        preimage = response.r_hash;
//
//        console.log("response:");
//        console.log(response);
//        resolve(response.payment_request);
//     });
//  });
// }

// async function getNostrInvoice(amount, description) {
//   const descriptionHash = sha256(description);
//   let bolt11 = await createNostrInvoice(amount, descriptionHash);
//   return bolt11;
// }

function logTime(message) {
  console.log(message + " Time elapsed: " + (new Date().getTime() - startTime) + " milliseconds.");
}

function getStatus(hash) {
  let request = {
    r_hash_str: hash
  };

  return new Promise(function(resolve, reject) {
    lightning.lookupInvoice(request, function(err, response) {
      if (response) {
        resolve(response?.state == 'SETTLED');
      }
      else
        resolve(false);
    });
  });
}

// async function zapReceipt(data) {
//   const note = JSON.parse(data.description);
//   let e = note.tags.find(tag => tag[0] === 'e')?.[1];
//   let p = note.tags.find(tag => tag[0] === 'p')?.[1];
//
//   if (!p) {
//     return;
//   }
//   let zap = {
//     content: '', // leave this blank
//     kind: 9735,
//     pubkey: note.pubkey, // pubkey from the lnurl endpoint used to sign zap receipts == publicKey
//     created_at: Math.floor(Date.now() / 1000), // time of invoice paid
//     tags: [
//       ["bolt11", data.bolt11],
//       ["description", data.description],
//       ["p", p],
//     ]
//   };
//   if (e) {
//     zap.tags[zap.tags.length] = ["e", e];
//   }
//   zap.id = nostr.getEventHash(zap);
//   zap.sig = nostr.getSignature(zap, privateKey);
//   const signedEvent = nostr.finishEvent(zap, privateKey);
//   // console.log("sending to relays...");
//   let isPublished = false;
//   for (let relayUrl of relays) {
//     try {
//       let relay = nostr.relayInit(relayUrl);
//       await relay.connect();
//       await relay.publish(signedEvent);
//       console.log(`Published to ${relayUrl}`);
//       isPublished = true;
//       relay.close();
//     } catch (error) {
//       console.error(`Failed to publish to ${relayUrl}:`, error);
//     }
//   }
// }

function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getHash(invoice) {
  try {
    const decoded = bolt11.decode(invoice);
    const paymentHash = decoded.tags.find(tag => tag.tagName === 'payment_hash').data;
    return paymentHash;
  } catch (error) {
    console.error('Error decoding invoice:', error);
    return null;
  }
}

export async function GET(req, { params }) {
  startTime = new Date().getTime();
  console.log("Welcome to getInvoice.js!");

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  console.log("Welcome to getInvoice.js");

  var lnurl = {};

  const url = new URL(req.url);
  const amount = Number(url.searchParams.get('amount'));

  if (isNaN(amount)) {
    return NextResponse.json({ message: "No amount was provided." }, { headers });
  }

  const zap = url.searchParams.get('nostr');
  // // it's a nostr zap
  // if (zap) {
  //   // get invoice
  //   let bolt11 = await getNostrInvoice(amount, zap);
  //
  //   // using my node as a data store... sorry LND! and we don't need to await this...
  //   createDataInvoice(zap);
  //
  //   lnurl.pr = bolt11;
  //   lnurl.routes = [];
  //   logTime("Created an invoice for a nostr zap.");
  //   res.status(200).json(lnurl);
  //   let hash = getHash(bolt11);
  //   console.log("New invoice generated. Waiting for payment...");
  //   pause(1000);
  //   // check status of invoice here
  //   while (await getStatus(hash) == false) {
  //      pause(1000);
  //      const currentTime = new Date().getTime();
  //      if (currentTime - startTime > timeoutDuration) {
  //       console.log("Timed out waiting for payment status.");
  //       return false; // check for five minutes and then halt
  //     }
  //   }
  //   // successful zap! invoice settled.
  //   await zapReceipt({ bolt11: bolt11, description: zap });
  //   logTime("Nostr zap receipt success!");
  //   return true;
  // }

  // not a nostr zap, just a regular invoice
  let user = params.user.toLowerCase() || "none";
  let comment = url.searchParams.get('comment');

  var meta;
  switch (user) {
    case "glitch":
      meta = "G / L / I / T / C / H";
      break;
    case "bazaar":
      meta = "Bitcoin Bazaar";
      break;
    default:
      meta = "Pay to D++";
  }
  // fun with emojis!
  if (user == '💖')
    user = '%f0%9f%92%96';
  // these may look the same but they're not! we have variation selectors to consider
  if (user == '⚡')
    user = '%E2%9A%A1';           // no variation selector
  if (user == '⚡️')
     user = '%E2%9A%A1%EF%B8%8F'; // variation selector to display as emoji
  if (user == '⚡︎')
     user = '%E2%9A%A1%EF%B8%8E'; // variation selector to display as text

  var address = `${user}@islandbitcoin.com`;
  var memo = JSON.stringify([["text/plain", meta],["text/identifier", `${address}`]]);
  var hash = sha256(memo);

  lnurl.pr = await createInvoice(user, address, amount, hash, comment);
  lnurl.routes = [];
  logTime("Invoice creation success!");
  return NextResponse.json(lnurl, { headers });
}
