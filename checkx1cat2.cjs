const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
async function check(address, label) {
  const mint = new PublicKey(address);
  const mintAcc = await conn.getAccountInfo(mint);
  if (!mintAcc) return console.log(label, '- not found');
  const data = mintAcc.data;
  const mintAuthority = data[0] === 1 ? new PublicKey(data.slice(4, 36)).toBase58() : 'BURNED';
  console.log(`${label}: mintAuthority=${mintAuthority} supply=${data.readBigUInt64LE(36)} decimals=${data[44]}`);
}
// X1Cat token you provided
check('GTDev8QaM2VtUnfH6c6KHs6HyutFrExLVyXwrn2pvF3u', 'X1Cat #1');
// Capy Warrior for comparison
check('6fC6xsQThKoJrC436STmkS5cLageFT8PYotXotuMuTo9', 'Capy Warrior');
