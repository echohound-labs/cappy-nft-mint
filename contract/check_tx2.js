const { Connection } = require('@solana/web3.js');
const conn = new Connection('https://rpc.testnet.x1.xyz', 'confirmed');
const sig = 'Pwys7qjF7J1nUVCxz9c6VS1g8W3yuULH9B4Lpr283fCuzxiM4KD8D6WsxaVe24AQffxp5cgqosrnetW4gEbY7Hw';
(async () => {
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  const logs = tx?.meta?.logMessages || [];
  const eventLog = logs.find(l => l.startsWith('Program data: '));
  if (eventLog) {
    const data = Buffer.from(eventLog.replace('Program data: ', ''), 'base64');
    console.log('hex:', data.toString('hex'));
    for(let i = 0; i < data.length - 3; i++) {
      const val = data.readUInt32LE(i);
      if(val > 0 && val <= 500) console.log('offset', i, '=', val);
    }
  }
})();
