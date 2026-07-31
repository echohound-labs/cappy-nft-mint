const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const mint = new PublicKey('HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC');
const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);
conn.getAccountInfo(pda).then(a => console.log('Metadata PDA exists:', !!a, 'Size:', a?.data.length));
