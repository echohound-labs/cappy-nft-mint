const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');

async function check() {
  const mint = new PublicKey('G6RPpkg7Vwx5FWz5AFCUjHVTKL81u5ookgUKKaekGF1K');
  const mintAcc = await conn.getAccountInfo(mint);
  const data = mintAcc.data;
  console.log('Full mint account hex (first 50 bytes):', Buffer.from(data.slice(0, 50)).toString('hex'));
  console.log('Mint authority option byte (byte 0):', data[0]);
  console.log('Mint authority option byte (byte 4):', data[4]);
  console.log('Supply bytes:', data.readBigUInt64LE(36));
  console.log('Decimals:', data[44]);
  console.log('Is initialized:', data[45]);
}
check();
