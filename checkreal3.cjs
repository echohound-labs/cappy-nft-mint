const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
async function check() {
  const mint = new PublicKey('6fC6xsQThKoJrC436STmkS5cLageFT8PYotXotuMuTo9');
  const mintAcc = await conn.getAccountInfo(mint);
  const data = mintAcc.data;
  console.log('Full mint account hex (first 50 bytes):', Buffer.from(data.slice(0, 50)).toString('hex'));
  console.log('Mint authority option byte (byte 0):', data[0]);
  const mintAuthority = data[0] === 1 ? new PublicKey(data.slice(4, 36)).toBase58() : 'BURNED';
  console.log('Mint authority:', mintAuthority);
  console.log('Supply:', data.readBigUInt64LE(36));
  console.log('Decimals:', data[44]);
}
check();
