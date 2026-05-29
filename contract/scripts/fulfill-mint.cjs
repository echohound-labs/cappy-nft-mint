const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } = require('@solana/spl-token');
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
  const LP_TREASURY = new PublicKey('GZuBHE3fQCQ6eSTLMwWKrK15CjtWfA58BmxdtWwG5mJJ');
  const ORACLE_OPERATOR = new PublicKey('HGFisVbULNKqogtPuGTfcHG9y6i5nboZabYwifkiiodo');
  const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

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

  // Read randomness request PDA from pending mint account
  const pendingAcc = await connection.getAccountInfo(pendingMintPDA);
  if (!pendingAcc) {
    console.error('No pending mint found! Run request-mint.cjs first.');
    process.exit(1);
  }
  const randomnessRequestPDA = new PublicKey(pendingAcc.data.slice(40, 72));
  console.log('Randomness Request PDA:', randomnessRequestPDA.toString());

  // Check if Geiger has fulfilled the randomness
  const reqAcc = await connection.getAccountInfo(randomnessRequestPDA);
  console.log('Randomness status byte:', reqAcc.data[104]);

  if (reqAcc.data[104] !== 1) {
    console.log('Randomness not yet fulfilled — calling fulfillRandomness on Geiger...');
    const fulfillDiscrim = Buffer.from([235, 105, 140, 46, 40, 88, 117, 2]);
    const cuIx = require('@solana/web3.js').ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 });
    const fulfillIx = new TransactionInstruction({
      keys: [
        { pubkey: oracleStatePDA, isSigner: false, isWritable: true },
        { pubkey: entropyPoolPDA, isSigner: false, isWritable: false },
        { pubkey: randomnessRequestPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: GEIGER_PROGRAM,
      data: fulfillDiscrim,
    });
    const tx = new Transaction().add(cuIx).add(fulfillIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.sign(wallet);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, 'confirmed');
    console.log('fulfillRandomness TX:', sig);
  } else {
    console.log('Randomness already fulfilled!');
  }

  // Now fulfill the mint
  const nftMint = Keypair.generate();
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), nftMint.publicKey.toBuffer()],
    METADATA_PROGRAM
  );
  const minterAta = getAssociatedTokenAddressSync(nftMint.publicKey, wallet.publicKey);

  console.log('NFT Mint:', nftMint.publicKey.toString());
  console.log('Metadata PDA:', metadataPDA.toString());

  const tx2 = await program.methods.fulfillMint()
    .accounts({
      mintState: mintStatePDA,
      minter: wallet.publicKey,
      pendingMint: pendingMintPDA,
      randomnessRequest: randomnessRequestPDA,
      nftMint: nftMint.publicKey,
      minterAta,
      metadata: metadataPDA,
      lpTreasury: LP_TREASURY,
      oracleOperator: ORACLE_OPERATOR,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      tokenMetadataProgram: METADATA_PROGRAM,
      rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
    })
    .signers([nftMint])
    .rpc();

  console.log('✅ fulfill_mint SUCCESS! TX:', tx2);
  console.log('NFT Mint Address:', nftMint.publicKey.toString());
})();
