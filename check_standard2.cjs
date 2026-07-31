const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

async function checkMint(mintAddress, label) {
  const mint = new PublicKey(mintAddress);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM);
  const metaAcc = await conn.getAccountInfo(pda);
  const mintAcc = await conn.getAccountInfo(mint);
  if (!metaAcc) return console.log(label, '- no metadata');
  const data = metaAcc.data;
  let off = 1 + 32 + 32;
  const skipStr = () => { const l = data.readUInt32LE(off); off += 4 + l; };
  skipStr(); skipStr(); skipStr();
  off += 2;
  if (data.readUInt8(off++) === 1) { const n = data.readUInt32LE(off); off += 4 + n * 34; }
  off += 1 + 1;
  const hasTS = data.readUInt8(off++);
  const tokenStandard = hasTS === 1 ? data.readUInt8(off) : 'none';
  const standards = {0:'NonFungible',1:'FungibleAsset',2:'Fungible',3:'NonFungibleEdition',4:'ProgrammableNonFungible'};
  const mintAuthority = mintAcc?.data[4] === 1 ? new PublicKey(mintAcc.data.slice(5, 37)).toBase58() : 'BURNED';
  console.log(`${label}: tokenStandard=${tokenStandard} (${standards[tokenStandard]||'unknown'}), mintAuthority=${mintAuthority}`);
}

// Check a Capy Warrior - use a real minted token mint address
checkMint('B1GccLTSwYAs3SUmcrm8hr6im1dfFzRX3ohDdGKSTkQB', 'Capy Warrior member token');
