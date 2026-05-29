const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const connection = new Connection('https://rpc.testnet.x1.xyz', 'confirmed');

  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, '.config/solana/capy-mint-authority.json')
    )))
  );

  const idl = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../target/idl/capy_warriors.json')
  ));

  const programId = new PublicKey('9TjTjyiz3gpRrTaeGvxi2LTrjjsYmDers7VQVDxo9Zdh');
  const GEIGER_PROGRAM = new PublicKey('2dQf9uaCzXewrDNLttmtzQmc3SmqfAHz3qahKQjtGQyY');

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), { commitment: 'confirmed' });
  const program = new anchor.Program(idl, provider);

  const [mintStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_state_v2')], programId
  );
  const [pendingMintPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pending_mint'), wallet.publicKey.toBuffer()], programId
  );
  const [oracleStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_state')], GEIGER_PROGRAM
  );
  const [entropyPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('entropy_pool')], GEIGER_PROGRAM
  );

  // Read total_requests from oracle state — offset 48 (same as Rise Phoenix)
  const oracleAcc = await connection.getAccountInfo(oracleStatePDA);
  let totalRequests = 0;
  if (oracleAcc && oracleAcc.data.length >= 56) {
    try {
      totalRequests = Number(oracleAcc.data.readBigUInt64LE(48));
    } catch(e) { totalRequests = 0; }
  }
  console.log('Oracle total_requests:', totalRequests);

  const [randomnessRequestPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('rand_request'),
      wallet.publicKey.toBuffer(),
      Buffer.from(new Uint8Array(new BigUint64Array([BigInt(totalRequests)]).buffer))
    ],
    GEIGER_PROGRAM
  );

  console.log('Wallet:', wallet.publicKey.toString());
  console.log('Mint State PDA:', mintStatePDA.toString());
  console.log('Pending Mint PDA:', pendingMintPDA.toString());
  console.log('Oracle State PDA:', oracleStatePDA.toString());
  console.log('Randomness Request PDA:', randomnessRequestPDA.toString());

  const tx = await program.methods.requestMint()
    .accounts({
      mintState: mintStatePDA,
      minter: wallet.publicKey,
      pendingMint: pendingMintPDA,
      oracleState: oracleStatePDA,
      entropyPool: entropyPoolPDA,
      randomnessRequest: randomnessRequestPDA,
      geigerProgram: GEIGER_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log('✅ request_mint SUCCESS! TX:', tx);
  console.log('Wait a few seconds for Geiger to fulfill, then run fulfill-mint.cjs');
})();
