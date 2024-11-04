import { Web5 } from '@web5/api';
import { VerifiableCredential } from '@web5/credentials';
import { DidDht } from '@web5/dids';
import { DidJwk } from '@web5/dids';
import bodyParser from 'body-parser';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import { Offering } from '@tbdex/http-server';
import express from 'express';
const app = express();
const logging = logger('dev');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(logging);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
const aliceDid = 'did:dht:rr1w5z9hdjtt76e6zmqmyyxc5cfnwjype6prz45m6z1qsbm8yjao';
const { did: thediDid, web5: thediWeb5 } = await Web5.connect({
    sync: '3s',
    didCreateOptions: {
        dwnEndpoints: ['https://dwn.gcda.xyz']
    },
    registration: {
        onSuccess: () => {
            console.log('Connection to Thedi DWN successful....');
        },
        onFailure: (error) => {
            console.log('Connection to Thedi DWN failed....');
        },
    },
});
/*
const { web5: aliceWeb5 } = await Web5.connect({
  connectedDid: 'did:dht:rr1w5z9hdjtt76e6zmqmyyxc5cfnwjype6prz45m6z1qsbm8yjao',
  didCreateOptions: {
    dwnEndpoints: ['https://vc-to-dwn.tbddev.org']
  },
  registration: {
    onSuccess: async () => {
      console.log('Connection to Alice DWN successfull...');
    },
    onFailure: (error) => {
      console.log('Connection to Alice DWN failed....');
    },
  },
})
*/
const aliceBearerDid = await DidJwk.create();
const credentialProtocol = {
    protocol: "https://vc-to-dwn.tbddev.org/vc-protocol",
    published: true,
    types: {
        credential: {
            schema: "https://vc-to-dwn.tbddev.org/vc-protocol/schema/credential",
            dataFormats: [
                "application/vc+jwt"
            ]
        },
        issuer: {
            schema: "https://vc-to-dwn.tbddev.org/vc-protocol/schema/issuer",
            dataFormats: [
                "text/plain",
                "application/json"
            ]
        },
        judge: {
            schema: "https://vc-to-dwn.tbddev.org/vc-protocol/schema/judge",
            dataFormats: [
                "text/plain",
                "application/json"
            ]
        }
    },
    structure: {
        issuer: {
            "$role": true
        },
        judge: {
            "$role": true
        },
        credential: {
            "$actions": [
                {
                    role: "issuer",
                    can: [
                        "create"
                    ]
                },
                {
                    role: "judge",
                    can: [
                        "query",
                        "read",
                        "subscribe"
                    ]
                }
            ]
        }
    }
};
const { protocol, status } = await thediWeb5.dwn.protocols.configure({
    message: {
        definition: credentialProtocol
    }
});
await protocol.send(thediDid);
const pfiDid = await DidDht.create({
    options: {
        services: [{
                id: 'pfi',
                type: 'PFI',
                serviceEndpoint: 'https://example.com'
            }]
    }
});
/*

const exchangesApiProvider = new ExchangesApiProvider();
const offeringsApiProvider = new OfferingsApiProvider(pfiDid);

const tbDexServer = new TbdexHttpServer({
    exchangesApi: exchangesApiProvider,
    offeringsApi: offeringsApiProvider,
    pfiDid: pfiDid.uri
});



tbDexServer.onCreateExchange(async (ctx, rfq, opts) => {
  await exchangesApiProvider.write({ message: rfq, replyTo: opts.replyTo })
});

tbDexServer.onSubmitOrder(async (ctx, order, opts) => {
  await exchangesApiProvider.write({ message: order, replyTo: opts.replyTo })
});

tbDexServer.onSubmitClose(async (ctx, close, opts) => {
  await exchangesApiProvider.write({ message: close, replyTo: opts.replyTo })
});
*/
function parseJwtToken(token) {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}
app.get('/protocols', async (req, res) => {
    const { protocols } = await thediWeb5.dwn.protocols.query({
        message: {
            filter: {
                protocol: 'https://vc-to-dwn.tbddev.org/vc-protocol',
            },
        },
    });
    res.send({ Protocols: protocols });
});
app.post('/auth', async (req, res) => {
    const vc = await VerifiableCredential.create({
        type: 'ThediAuthCredential',
        issuer: thediDid,
        subject: aliceDid,
        data: req.body,
        credentialSchema: {
            id: "https://vc.schemas.host/kcc.schema.json",
            type: "JsonSchema",
        },
        evidence: [
            {
                "kind": "Thedi_Authentication",
                "checks": ["identification_doc", "credit_report", "name", "dob", "email", "passport_sized_photo"]
            },
            {
                "kind": "sanction_screening",
                "checks": ["PEP"]
            }
        ]
    });
    await fetch(`https://vc-to-dwn.tbddev.org/authorize?issuerDid=${thediDid}`, {
        method: 'GET',
        mode: 'no-cors'
    })
        .then(async (response) => {
        const data = await response.json();
        console.log('Permission:   ', data);
        const signedVc = await vc.sign({ did: aliceBearerDid });
        const { record, status } = await thediWeb5.dwn.records.create({
            data: JSON.stringify({
                name: 'Thedi Verifiable Credential',
                description: 'Verification credential to authenticate and authorize with Thedi platform',
                VerifiableCredential: signedVc
            }),
            message: {
                dataFormat: 'application/vc+jwt',
                protocol: credentialProtocol.protocol,
                protocolPath: 'credential',
                schema: credentialProtocol.types.credential.schema,
                recipient: aliceDid
            },
        });
        console.log(record);
        console.log(status);
        const recordStatus = await record.send(thediDid);
        console.log(JSON.stringify({
            SignedVC: signedVc,
            Record: record,
            Status: recordStatus
        }));
        res.send({
            SignedVC: signedVc,
            Record: record,
            Status: recordStatus
        });
    })
        .catch((err => console.error(err)));
});
app.get('/', async (req, res) => {
    res.send("Thedi Server Running.......");
});
app.get('/records', async (req, res) => {
    const response = await thediWeb5.dwn.records.query({
        from: thediDid,
        message: {
            filter: {
                //recipient: thediDid
                schema: 'http://authcredential',
                dataFormat: 'application/vc+jwt',
            },
        },
    });
    res.send({ Records: await response });
});
app.get('/records/:id', async (req, res) => {
    let { record } = await thediWeb5.dwn.records.read({
        message: {
            filter: {
                recordId: req.params.id,
            },
        },
    });
    if (await record) {
        const text = await record.data.text();
        res.send({ Record: text, Result: '' });
    }
    else {
        res.send({ Result: "Record Not Found" });
    }
});
app.get('/offerings', async (req, res) => {
    const pd = {
        id: "presentation-definition-kcc",
        name: "KYC Verification",
        purpose: "We need to verify your customer status and necessary checks.",
        format: {
            jwt_vc: {
                alg: ["ES256K", "EdDSA"]
            }
        },
        input_descriptors: [
            {
                id: "known-customer-credential",
                name: "Known Customer Credential",
                purpose: "Please present your Known Customer Credential for verification.",
                constraints: {
                    fields: [
                        {
                            path: ["$.type[*]"],
                            filter: {
                                type: "string",
                                pattern: "KnownCustomerCredential"
                            }
                        },
                        {
                            path: ["$.evidence[*].kind"],
                            filter: {
                                type: "string",
                                pattern: "sanction_screening"
                            }
                        },
                        {
                            path: ["$.credentialSubject.countryOfResidence"],
                            filter: {
                                type: "string",
                                const: "US"
                            }
                        },
                        {
                            path: ["$.issuer"],
                            filter: {
                                type: "string",
                                const: "did:dht:d4sgiggd3dwimo4ubki7spo45q5dazxphrizbxhcgapapcnzpouy"
                            }
                        }
                    ]
                }
            }
        ]
    };
    const offering = Offering.create({
        metadata: {
            from: pfiDid.uri,
            protocol: "1.0"
        },
        data: {
            description: "Selling BTC for USD",
            payin: {
                currencyCode: "USD",
                methods: [{
                        kind: "DEBIT_CARD",
                        requiredPaymentDetails: {
                            "$schema": "http://json-schema.org/draft-07/schema",
                            "type": "object",
                            "properties": {
                                "cardNumber": {
                                    "type": "string",
                                    "description": "The 16-digit debit card number",
                                    "minLength": 16,
                                    "maxLength": 16
                                },
                                "expiryDate": {
                                    "type": "string",
                                    "description": "The expiry date of the card in MM/YY format",
                                    "pattern": "^(0[1-9]|1[0-2])\\/([0-9]{2})$"
                                },
                                "cardHolderName": {
                                    "type": "string",
                                    "description": "Name of the cardholder as it appears on the card"
                                },
                                "cvv": {
                                    "type": "string",
                                    "description": "The 3-digit CVV code",
                                    "minLength": 3,
                                    "maxLength": 3
                                }
                            }
                        }
                    }]
            },
            payout: {
                currencyCode: 'BTC',
                methods: [
                    {
                        kind: 'BTC_ADDRESS',
                        estimatedSettlementTime: 60,
                        fee: '0.25',
                    }
                ]
            },
            payoutUnitsPerPayinUnit: '0.00003826',
            requiredClaims: pd
        }
    });
    await offering.sign(pfiDid);
    offering.validate();
    res.send({ Offerings: offering });
});
app.get('/offerings/:id', async (req, res) => {
    res.send(JSON.stringify(res));
});
app.post('/exchanges', async (req, res) => {
    res.send(`Coming soon....`);
});
app.post('/exchanges/:id', async (req, res) => {
    res.send(`Coming soon....`);
});
app.get('/exchanges', async (req, res) => {
    res.send(`Coming soon....`);
});
app.get('/exchanges/:id', async (req, res) => {
    res.send('Coming soon....');
});
const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
    console.log(`listening on port ${port}`);
});
//# sourceMappingURL=index.js.map