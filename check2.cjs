const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const mint = new PublicKey('HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC');
const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);
conn.getAccountInfo(pda).then(a => {
  const data = a.data;
  // Token standard is at byte 64 after the metadata
  const tokenStandard = data[64 + 1 + 32 + 32 + 4 + 32 + 4 + 200 + 4 + 10 + 2 + 1 + 1];
  console.log('Raw data length:', data.length);
  // Read name from offset 65
  let off = 1 + 32 + 32;
  const nameLen = data.readUInt32LE(off); off += 4;
  const name = data.slice(off, off + nameLen).toString('utf8').replace(/\0/g, ''); off += nameLen;
  const symLen = data.readUInt32LE(off); off += 4;
  const sym = data.slice(off, off + symLen).toString('utf8').replace(/\0/g, '');
  console.log('Name:', name);
  console.log('Symbol:', sym);
  console.log('Token standard byte at 64+1+32+32+4+nameLen+4+symLen:', data[off]);
});
