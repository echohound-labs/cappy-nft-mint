const {Connection, PublicKey} = require('@solana/web3.js');
const conn = new Connection('https://rpc.mainnet.x1.xyz');
conn.getAccountInfo(new PublicKey('B1GccLTSwYAs3SUmcrm8hr6im1dfFzRX3ohDdGKSTkQB')).then(a => {
  if (!a) return console.log('not found');
  const mint = new PublicKey(a.data.slice(33, 65));
  console.log('mint address:', mint.toBase58());
});
