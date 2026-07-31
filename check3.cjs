const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const mint = new PublicKey('HC8zqrya22MHNR2JsNkmvr2yqPthDDov1ehDSEUATKbC');
const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);
conn.getAccountInfo(pda).then(a => {
  const data = a.data;
  let off = 1 + 32 + 32;
  const nameLen = data.readUInt32LE(off); off += 4 + nameLen;
  const symLen = data.readUInt32LE(off); off += 4 + symLen;
  const uriLen = data.readUInt32LE(off); off += 4 + uriLen;
  off += 2 + 1; // seller_fee + has_creators
  const creatorCount = data.readUInt32LE(off); off += 4 + (creatorCount * 34);
  off += 1 + 1; // primary_sale + is_mutable
  // token_standard is Option<u8> - 1 byte flag + 1 byte value
  const hasTokenStandard = data[off]; off++;
  const tokenStandard = data[off];
  const standards = {0:'NonFungible',1:'FungibleAsset',2:'Fungible',3:'NonFungibleEdition',4:'ProgrammableNonFungible'};
  console.log('hasTokenStandard:', hasTokenStandard);
  console.log('tokenStandard value:', tokenStandard);
  console.log('tokenStandard name:', standards[tokenStandard] || 'Unknown');
});
