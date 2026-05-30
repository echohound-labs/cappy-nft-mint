const { Connection } = require('@solana/web3.js');
const conn = new Connection('https://rpc.testnet.x1.xyz', 'confirmed');
const sig = '3h4D4seTJqSQYPpqkHQ3ECP94g9WxbyhoK5AhByUZ19QG5kGd5gS1QUENPneTGPK4YQhUh7PBUc5wum1SDTxents';
(async () => {
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  const logs = tx?.meta?.logMessages || [];
  logs.forEach((l, i) => console.log(i, l));
})();
