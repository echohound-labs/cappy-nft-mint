const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const MINT = process.argv[2];
async function check() {
  const mint = new PublicKey(MINT);
  const mintAcc = await conn.getAccountInfo(mint);
  const d = mintAcc.data;
  const auth = d[0] === 1 ? new PublicKey(d.slice(4, 36)) : null;
  console.log('mint authority :', auth ? auth.toBase58() : 'NONE');
  console.log('supply         :', d.readBigUInt64LE(36).toString());
  console.log('decimals       :', d[44]);
  if (auth) {
    const authAcc = await conn.getAccountInfo(auth);
    console.log('authority owner:', authAcc ? authAcc.owner.toBase58() : 'account not found');
    const [expectedME] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer(), Buffer.from('edition')],
      METADATA_PROGRAM
    );
    console.log('is master edition PDA:', auth.equals(expectedME) ? 'YES' : 'NO — got ' + auth.toBase58());
  }
}
check();
