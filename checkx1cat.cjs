const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
async function check() {
  const mint = new PublicKey('GTDev8QaM2VtUnfH6c6KHs6HyutFrExLVyXwrn2pvF3u');
  const mintAcc = await conn.getAccountInfo(mint);
  const data = mintAcc.data;
  const mintAuthority = data[0] === 1 ? new PublicKey(data.slice(4, 36)).toBase58() : 'BURNED';
  console.log('X1Cat mint authority:', mintAuthority);
  console.log('Supply:', data.readBigUInt64LE(36));
  console.log('Decimals:', data[44]);
}
check();
