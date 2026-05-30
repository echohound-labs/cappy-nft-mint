const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://rpc.testnet.x1.xyz', 'confirmed');
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

(async () => {
  const wallet = new PublicKey('5GYrG5TBUcfjMJDxmLqh9FS23xHocULDSy7DZrfe7qRq');
  const tokens = await conn.getParsedTokenAccountsByOwner(wallet, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
  for (const ta of tokens.value) {
    const info = ta.account.data.parsed.info;
    if (info.tokenAmount?.amount !== '1') continue;
    const mint = new PublicKey(info.mint);
    const [metaPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM
    );
    const metaAcc = await conn.getAccountInfo(metaPDA);
    if (!metaAcc) continue;
    const data = metaAcc.data;
    let offset = 65;
    const nameLen = data.readUInt32LE(offset); offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0+$/, '');
    if (!name.startsWith('Capy')) { continue; }
    offset += nameLen;
    const symbolLen = data.readUInt32LE(offset); offset += 4;
    const symbol = data.slice(offset, offset + symbolLen).toString('utf8').replace(/\0+$/, ''); offset += symbolLen;
    const uriLen = data.readUInt32LE(offset); offset += 4;
    console.log('Name:', name, 'Symbol:', symbol, 'uriLen:', uriLen);
    console.log('URI raw hex:', data.slice(offset, offset + 10).toString('hex'));
    console.log('URI:', data.slice(offset, offset + uriLen).toString('utf8').replace(/\0+$/, ''));
    break;
  }
})();
