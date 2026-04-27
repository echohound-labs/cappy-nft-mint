import React, { useState, useEffect } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import GEIGER_IDL from './geiger_idl.json';

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt918CN2');
const GEIGER_PROGRAM_ID = new PublicKey('BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU');

// Rarity tiers based on Geiger entropy
const RARITY_TIERS = {
  COMMON: { threshold: 0.70, label: 'Common', color: '#888888', icon: '🦫' },
  MYTHIC: { threshold: 0.25, label: 'Mythic', color: '#ff6b35', icon: '✨' },
  LEGENDARY: { threshold: 0.05, label: 'Legendary', color: '#ffd700', icon: '👑' },
};

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function explorerLink(sig) {
  return `https://explorer.x1.xyz/tx/${sig}`;
}

const WALLETS = [
  { key: 'phantom', name: 'Phantom', icon: '👻', check: () => window.phantom?.solana },
  { key: 'backpack', name: 'Backpack', icon: '🎒', check: () => window.backpack?.solana },
  { key: 'solflare', name: 'Solflare', icon: '🔥', check: () => window.solflare },
];

// Sample capybara images for preview
const SAMPLE_CAPYS = [
  'https://i.imgur.com/JP0CJfG.jpeg',
  'https://i.imgur.com/8Km9t8J.jpeg',
  'https://i.imgur.com/5QXz4QG.jpeg',
  'https://i.imgur.com/LK9t8HJ.jpeg',
];

export default function App() {
  const [provider, setProvider] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [connected, setConnected] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    uri: '',
    royaltyPercent: 5,
  });
  const [imagePreview, setImagePreview] = useState('');
  const [imageError, setImageError] = useState(false);
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [geigerStatus, setGeigerStatus] = useState('idle'); // idle, requesting, fulfilling, complete

  const connection = new Connection(
    import.meta.env.VITE_RPC_URL || 'https://rpc.mainnet.x1.xyz',
    'confirmed'
  );

  // Derive Geiger PDAs
  const [oracleStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle_state')],
    GEIGER_PROGRAM_ID
  );
  const [entropyPoolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('entropy_pool')],
    GEIGER_PROGRAM_ID
  );

  const handleConnect = async (walletKey) => {
    setError(null);
    try {
      const walletDef = WALLETS.find(w => w.key === walletKey);
      const prov = walletDef.check();
      if (!prov) {
        throw new Error(`${walletDef.name} wallet not found. Please install it first.`);
      }
      const resp = await prov.connect();
      setProvider(prov);
      setPublicKey(resp.publicKey);
      setConnected(true);
      setShowWalletModal(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDisconnect = async () => {
    if (provider) {
      try { await provider.disconnect(); } catch(e) {}
    }
    setProvider(null);
    setPublicKey(null);
    setConnected(false);
  };

  const handleImageChange = (e) => {
    const uri = e.target.value;
    setFormData({ ...formData, uri });
    setImageError(false);
    if (uri) {
      setImagePreview(uri);
    } else {
      setImagePreview('');
    }
  };

  const handleImageError = () => {
    setImageError(true);
  };

  // Determine rarity from entropy result
  const determineRarity = (entropyBytes) => {
    // Use first 8 bytes as a number 0-1
    const value = entropyBytes.slice(0, 8).reduce((acc, b, i) => acc + b * Math.pow(256, -i-1), 0);
    
    if (value < RARITY_TIERS.LEGENDARY.threshold) {
      return 'LEGENDARY';
    } else if (value < RARITY_TIERS.LEGENDARY.threshold + RARITY_TIERS.MYTHIC.threshold) {
      return 'MYTHIC';
    }
    return 'COMMON';
  };

  const requestGeigerRandomness = async () => {
    const { Keypair } = await import('@solana/web3.js');
    const anchorProvider = new anchor.AnchorProvider(
      connection,
      { publicKey, signTransaction: provider.signTransaction.bind(provider) },
      { commitment: 'confirmed' }
    );
    anchor.setProvider(anchorProvider);
    const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProvider);

    // Generate user seed
    const userSeed = crypto.getRandomValues(new Uint8Array(32));
    
    // Get current total_requests
    const oracleState = await program.account.oracleState.fetch(oracleStatePDA);
    const requestIndex = Buffer.alloc(8);
    requestIndex.writeBigUInt64LE(BigInt(oracleState.totalRequests.toString()));
    
    // Derive request PDA
    const [requestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('rand_request'), publicKey.toBuffer(), requestIndex],
      GEIGER_PROGRAM_ID
    );

    // Request randomness
    const requestTx = await program.methods
      .requestRandomness(Array.from(userSeed))
      .accounts({
        oracleState: oracleStatePDA,
        entropyPool: entropyPoolPDA,
        randomnessRequest: requestPDA,
        requester: publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('Geiger Request TX:', requestTx);
    
    return { requestPDA, userSeed };
  };

  const fulfillGeigerRandomness = async (requestPDA) => {
    const anchorProvider = new anchor.AnchorProvider(
      connection,
      { publicKey, signTransaction: provider.signTransaction.bind(provider) },
      { commitment: 'confirmed' }
    );
    anchor.setProvider(anchorProvider);
    const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProvider);

    const fulfillTx = await program.methods
      .fulfillRandomness()
      .accounts({
        oracleState: oracleStatePDA,
        entropyPool: entropyPoolPDA,
        randomnessRequest: requestPDA,
        requester: publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('Geiger Fulfill TX:', fulfillTx);

    // Read the result
    const request = await program.account.randomnessRequest.fetch(requestPDA);
    return request.result;
  };

  const handleMint = async () => {
    if (!connected) {
      setError('Connect your wallet first');
      return;
    }
    if (!formData.name || !formData.symbol || !formData.uri) {
      setError('Name, symbol, and image URI are required');
      return;
    }

    setMinting(true);
    setError(null);
    setResult(null);
    setGeigerStatus('requesting');

    try {
      // Step 1: Request Geiger randomness
      const { requestPDA } = await requestGeigerRandomness();
      
      setGeigerStatus('fulfilling');
      
      // Step 2: Fulfill randomness
      const entropyResult = await fulfillGeigerRandomness(requestPDA);
      const rarity = determineRarity(entropyResult);
      
      setGeigerStatus('complete');
      console.log(`Rarity determined: ${rarity} from entropy ${Buffer.from(entropyResult).toString('hex').slice(0, 16)}...`);

      // Step 3: Mint NFT with rarity metadata
      const { Keypair } = await import('@solana/web3.js');
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');
      
      const mintKeypair = Keypair.generate();
      const mintPubkey = mintKeypair.publicKey;
      const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const associatedTokenAddress = getAssociatedTokenAddressSync(mintPubkey, publicKey);

      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
        METADATA_PROGRAM_ID
      );

      const transaction = new Transaction();

      // Create mint account
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintPubkey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        })
      );

      // Initialize mint (0 decimals for NFT)
      transaction.add(
        createInitializeMintInstruction(mintPubkey, 0, publicKey, publicKey, TOKEN_PROGRAM_ID)
      );

      // Create ATA
      transaction.add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          associatedTokenAddress,
          publicKey,
          mintPubkey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      // Mint 1 token
      transaction.add(
        createMintToInstruction(
          mintPubkey,
          associatedTokenAddress,
          publicKey,
          1,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Create metadata with rarity attributes
      const rarityConfig = RARITY_TIERS[rarity];
      const metadataUri = formData.uri;
      
      transaction.add(
        createCreateMetadataAccountV3Instruction(
          {
            metadata: metadataPDA,
            mint: mintPubkey,
            mintAuthority: publicKey,
            payer: publicKey,
            updateAuthority: publicKey,
          },
          {
            createMetadataAccountArgsV3: {
              data: {
                name: `${rarityConfig.icon} ${formData.name}`,
                symbol: formData.symbol,
                uri: metadataUri,
                sellerFeeBasisPoints: Math.floor(formData.royaltyPercent * 100),
                creators: null,
                collection: null,
                uses: null,
              },
              isMutable: true,
              collectionDetails: null,
            },
          }
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      transaction.partialSign(mintKeypair);
      const signed = await provider.signTransaction(transaction);
      const txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, 'confirmed');

      setResult({
        mintAddress: mintPubkey.toString(),
        txid,
        rarity,
        rarityConfig,
        entropyHash: Buffer.from(entropyResult).toString('hex').slice(0, 32) + '...',
      });
    } catch (err) {
      console.error('Mint error:', err);
      setError(err.message || 'Mint failed. Check console for details.');
      setGeigerStatus('idle');
    } finally {
      setMinting(false);
    }
  };

  const getStatusMessage = () => {
    switch (geigerStatus) {
      case 'requesting': return '☢️ Requesting Geiger entropy...';
      case 'fulfilling': return '⚡ Fulfilling randomness...';
      case 'complete': return '✨ Entropy captured!';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-6">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1a0a0a] via-[#0a0a0f] to-[#0a1a1a]" />
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,107,53,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,107,53,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      {/* Header */}
      <header className="w-full max-w-3xl mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="text-5xl animate-float">🦫</div>
              <div className="absolute -top-1 -right-1 text-xl animate-pulse">✨</div>
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">
                <span className="bg-gradient-to-r from-orange-400 via-amber-300 to-yellow-200 bg-clip-text text-transparent">
                  CAPPY
                </span>
              </h1>
              <p className="text-sm text-gray-400">Mint • Preview • Geiger Randomness</p>
            </div>
          </div>

          <div>
            {connected ? (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800/80 border border-gray-700 hover:bg-gray-700 transition-all"
              >
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="font-mono text-sm text-gray-300">{shortenAddress(publicKey?.toString())}</span>
                <span className="text-gray-500">✕</span>
              </button>
            ) : (
              <button
                onClick={() => setShowWalletModal(true)}
                className="px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-orange-500 to-amber-500 text-black hover:from-orange-400 hover:to-amber-400 transition-all shadow-lg shadow-orange-500/20"
              >
                CONNECT WALLET
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Wallet Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
             onClick={() => setShowWalletModal(false)}>
          <div className="rounded-2xl p-6 w-80 bg-gray-900 border border-gray-700"
               onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4 text-orange-400">Connect Wallet</h3>
            <div className="space-y-3">
              {WALLETS.map(w => (
                <button
                  key={w.key}
                  onClick={() => handleConnect(w.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-all"
                >
                  <span className="text-2xl">{w.icon}</span>
                  <span className="font-semibold">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="w-full max-w-3xl grid md:grid-cols-2 gap-6">
        
        {/* Left: Image Preview */}
        <div className="bg-gray-900/80 rounded-2xl p-6 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <span>🖼️</span> PREVIEW
          </h3>
          
          <div className="aspect-square rounded-xl overflow-hidden bg-gray-800 border border-gray-700 mb-4 relative group">
            {imagePreview && !imageError ? (
              <img 
                src={imagePreview} 
                alt="NFT Preview" 
                className="w-full h-full object-cover"
                onError={handleImageError}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
                <span className="text-6xl mb-3">🦫</span>
                <span className="text-sm">Paste an image URL below</span>
              </div>
            )}
            
            {/* Sample Images */}
            {!imagePreview && (
              <div className="absolute inset-0 flex flex-col justify-end p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-xs text-gray-400 mb-2">Sample Cappys:</p>
                <div className="flex gap-2">
                  {SAMPLE_CAPYS.map((url, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setFormData({ ...formData, uri: url });
                        setImagePreview(url);
                        setImageError(false);
                      }}
                      className="w-12 h-12 rounded-lg overflow-hidden border border-gray-600 hover:border-orange-400 transition-all hover:scale-105"
                    >
                      <img src={url} className="w-full h-full object-cover" alt={`Sample ${i+1}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {imageError && (
            <div className="text-sm text-red-400 flex items-center gap-2">
              <span>⚠️</span> Could not load image. Check the URL.
            </div>
          )}

          {/* Rarity Legend */}
          <div className="mt-6 pt-6 border-t border-gray-700/50">
            <h4 className="text-xs font-semibold text-gray-500 mb-3">RARITY TIERS</h4>
            <div className="space-y-2">
              {Object.entries(RARITY_TIERS).map(([key, tier]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span style={{ color: tier.color }}>{tier.icon}</span>
                    <span style={{ color: tier.color }} className="font-semibold">{tier.label}</span>
                  </div>
                  <span className="text-gray-500 text-xs">{(tier.threshold * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Mint Form */}
        <div className="bg-gray-900/80 rounded-2xl p-6 border border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-4 flex items-center gap-2">
            <span>✨</span> MINT DETAILS
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Image URL *</label>
              <input
                type="url"
                placeholder="https://..."
                value={formData.uri}
                onChange={handleImageChange}
                className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm focus:border-orange-500 focus:outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Name *</label>
                <input
                  type="text"
                  placeholder="Cappy #001"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm focus:border-orange-500 focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Symbol *</label>
                <input
                  type="text"
                  placeholder="CAPPY"
                  value={formData.symbol}
                  onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm focus:border-orange-500 focus:outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Royalty %</label>
              <input
                type="number"
                min="0" max="50" step="0.5"
                value={formData.royaltyPercent}
                onChange={e => setFormData({ ...formData, royaltyPercent: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm focus:border-orange-500 focus:outline-none transition-all"
              />
            </div>
          </div>

          {/* Status Messages */}
          {geigerStatus !== 'idle' && (
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <span className="animate-spin">☢️</span>
                {getStatusMessage()}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
              <div className="text-red-400 text-sm">❌ {error}</div>
            </div>
          )}

          {/* Mint Button */}
          <button
            onClick={handleMint}
            disabled={!connected || minting || !formData.name || !formData.symbol || !formData.uri}
            className="w-full mt-6 py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden"
            style={{
              background: connected && !minting 
                ? 'linear-gradient(135deg, #f97316, #fbbf24)' 
                : '#374151',
              color: connected && !minting ? '#000' : '#9ca3af',
            }}
          >
            <span className="relative z-10">
              {minting ? '☢️ MINTING...' : connected ? '🦫 MINT CAPPY' : 'CONNECT WALLET'}
            </span>
            {connected && !minting && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-1000" />
            )}
          </button>

          {/* Result */}
          {result && (
            <div className="mt-4 p-4 rounded-xl border animate-fade-in"
                 style={{ 
                   background: `${result.rarityConfig.color}15`, 
                   borderColor: `${result.rarityConfig.color}40` 
                 }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{result.rarityConfig.icon}</span>
                <span className="font-bold" style={{ color: result.rarityConfig.color }}>
                  {result.rarityConfig.label} CAPPY MINTED!
                </span>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <div className="font-mono break-all">Mint: {shortenAddress(result.mintAddress)}</div>
                <div className="font-mono">Entropy: {result.entropyHash}</div>
              </div>
              <a
                href={explorerLink(result.txid)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-bold bg-gray-800 hover:bg-gray-700 transition-all"
                style={{ color: result.rarityConfig.color }}
              >
                View on Explorer →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center text-xs text-gray-600">
        <p>Powered by X1 Network • Geiger Entropy Oracle</p>
      </footer>
    </div>
  );
}
