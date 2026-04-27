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
import './App.css';

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt918CN2');
const GEIGER_PROGRAM_ID = new PublicKey('BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU');
const RPC = 'https://rpc.mainnet.x1.xyz';

const RARITY_TIERS = {
  LEGENDARY: { threshold: 0.05, label: 'Legendary', color: '#ffd700', icon: '👑', bg: 'rgba(255,215,0,0.08)' },
  MYTHIC: { threshold: 0.30, label: 'Mythic', color: '#ff6b35', icon: '✨', bg: 'rgba(255,107,53,0.08)' },
  COMMON: { threshold: 1.0, label: 'Common', color: '#9ca3af', icon: '🦫', bg: 'rgba(156,163,175,0.06)' },
};

const WALLETS = [
  { key: 'phantom', name: 'Phantom', icon: '👻', check: () => window.phantom?.solana },
  { key: 'backpack', name: 'Backpack', icon: '🎒', check: () => window.backpack?.solana },
  { key: 'solflare', name: 'Solflare', icon: '🔥', check: () => window.solflare },
];

const SAMPLE_CAPYS = [
  'https://i.imgur.com/JP0CJfG.jpeg',
  'https://i.imgur.com/8Km9t8J.jpeg',
  'https://i.imgur.com/5QXz4QG.jpeg',
  'https://i.imgur.com/LK9t8HJ.jpeg',
];

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [connected, setConnected] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', symbol: '', uri: '', royaltyPercent: 5 });
  const [imagePreview, setImagePreview] = useState('');
  const [imageError, setImageError] = useState(false);
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [geigerStatus, setGeigerStatus] = useState('idle');

  const connection = new Connection(import.meta.env.VITE_RPC_URL || RPC, 'confirmed');

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
      if (!prov) throw new Error(`${walletDef.name} wallet not found. Please install it first.`);
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
    if (provider) { try { await provider.disconnect(); } catch(e) {} }
    setProvider(null);
    setPublicKey(null);
    setConnected(false);
  };

  const handleImageChange = (uri) => {
    setFormData({ ...formData, uri });
    setImageError(false);
    setImagePreview(uri || '');
  };

  const determineRarity = (entropyBytes) => {
    const value = entropyBytes.slice(0, 8).reduce((acc, b, i) => acc + b * Math.pow(256, -i-1), 0);
    if (value < RARITY_TIERS.LEGENDARY.threshold) return 'LEGENDARY';
    if (value < RARITY_TIERS.MYTHIC.threshold) return 'MYTHIC';
    return 'COMMON';
  };

  const requestGeigerRandomness = async () => {
    const anchorProvider = new anchor.AnchorProvider(
      connection,
      { publicKey, signTransaction: provider.signTransaction.bind(provider) },
      { commitment: 'confirmed' }
    );
    anchor.setProvider(anchorProvider);
    const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProvider);

    const userSeed = crypto.getRandomValues(new Uint8Array(32));
    const oracleState = await program.account.oracleState.fetch(oracleStatePDA);
    const requestIndex = Buffer.alloc(8);
    requestIndex.writeBigUInt64LE(BigInt(oracleState.totalRequests.toString()));

    const [requestPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('rand_request'), publicKey.toBuffer(), requestIndex],
      GEIGER_PROGRAM_ID
    );

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

    await program.methods
      .fulfillRandomness()
      .accounts({
        oracleState: oracleStatePDA,
        entropyPool: entropyPoolPDA,
        randomnessRequest: requestPDA,
        requester: publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const request = await program.account.randomnessRequest.fetch(requestPDA);
    return request.result;
  };

  const handleMint = async () => {
    if (!connected) { setError('Connect your wallet first'); return; }
    if (!formData.name || !formData.symbol || !formData.uri) {
      setError('Name, symbol, and image URI are required'); return;
    }

    setMinting(true);
    setError(null);
    setResult(null);
    setGeigerStatus('requesting');

    try {
      const { Keypair } = await import('@solana/web3.js');
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');

      // Step 1: Geiger randomness
      const { requestPDA } = await requestGeigerRandomness();
      setGeigerStatus('fulfilling');
      const entropyResult = await fulfillGeigerRandomness(requestPDA);
      const rarity = determineRarity(entropyResult);
      setGeigerStatus('complete');

      // Step 2: Mint NFT
      const mintKeypair = Keypair.generate();
      const mintPubkey = mintKeypair.publicKey;
      const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const associatedTokenAddress = getAssociatedTokenAddressSync(mintPubkey, publicKey);
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
        METADATA_PROGRAM_ID
      );

      const transaction = new Transaction();
      transaction.add(SystemProgram.createAccount({
        fromPubkey: publicKey, newAccountPubkey: mintPubkey,
        space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID,
      }));
      transaction.add(createInitializeMintInstruction(mintPubkey, 0, publicKey, publicKey, TOKEN_PROGRAM_ID));
      transaction.add(createAssociatedTokenAccountInstruction(
        publicKey, associatedTokenAddress, publicKey, mintPubkey,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ));
      transaction.add(createMintToInstruction(mintPubkey, associatedTokenAddress, publicKey, 1, [], TOKEN_PROGRAM_ID));

      const rarityConfig = RARITY_TIERS[rarity];
      transaction.add(createCreateMetadataAccountV3Instruction(
        {
          metadata: metadataPDA, mint: mintPubkey, mintAuthority: publicKey,
          payer: publicKey, updateAuthority: publicKey,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: `${rarityConfig.icon} ${formData.name}`,
              symbol: formData.symbol,
              uri: formData.uri,
              sellerFeeBasisPoints: Math.floor(formData.royaltyPercent * 100),
              creators: null, collection: null, uses: null,
            },
            isMutable: true, collectionDetails: null,
          },
        }
      ));

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
      setError(err.message || 'Mint failed');
      setGeigerStatus('idle');
    } finally {
      setMinting(false);
    }
  };

  const statusMsg = {
    requesting: '☢️ Requesting Geiger entropy...',
    fulfilling: '⚡ Fulfilling randomness...',
    complete: '✨ Entropy captured!',
  };

  return (
    <div className="app">
      {/* BG */}
      <div className="bg-glow" />

      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-icon">🦫</span>
          <div>
            <h1 className="logo-text">CAPPY</h1>
            <p className="logo-sub">Mint · Preview · Geiger Randomness</p>
          </div>
        </div>
        <div>
          {connected ? (
            <button className="wallet-pill" onClick={handleDisconnect}>
              <span className="wallet-dot" />
              <span className="wallet-addr">{shortenAddress(publicKey?.toString())}</span>
              <span className="wallet-x">✕</span>
            </button>
          ) : (
            <button className="connect-btn" onClick={() => setShowWalletModal(true)}>
              CONNECT WALLET
            </button>
          )}
        </div>
      </header>

      {/* Wallet Modal */}
      {showWalletModal && (
        <div className="modal-overlay" onClick={() => setShowWalletModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Connect Wallet</h3>
            <div className="wallet-list">
              {WALLETS.map(w => (
                <button key={w.key} className="wallet-option" onClick={() => handleConnect(w.key)}>
                  <span className="wallet-option-icon">{w.icon}</span>
                  <span className="wallet-option-name">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="main-grid">
        {/* Left: Preview */}
        <div className="card preview-card">
          <h3 className="card-title">🖼️ PREVIEW</h3>
          <div className="preview-frame">
            {imagePreview && !imageError ? (
              <img src={imagePreview} alt="NFT Preview" className="preview-img" onError={() => setImageError(true)} />
            ) : (
              <div className="preview-placeholder">
                <span className="preview-placeholder-icon">🦫</span>
                <span className="preview-placeholder-text">Paste an image URL</span>
              </div>
            )}
          </div>
          {imageError && <p className="error-sm">⚠️ Could not load image. Check the URL.</p>}

          {/* Sample capys */}
          {!imagePreview && (
            <div className="samples">
              <p className="samples-label">Sample Cappys:</p>
              <div className="samples-row">
                {SAMPLE_CAPYS.map((url, i) => (
                  <button key={i} className="sample-thumb" onClick={() => handleImageChange(url)}>
                    <img src={url} alt={`Sample ${i+1}`} className="sample-img" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rarity Legend */}
          <div className="rarity-legend">
            <h4 className="rarity-legend-title">RARITY TIERS</h4>
            {Object.entries(RARITY_TIERS).map(([key, tier]) => (
              <div key={key} className="rarity-row">
                <span className="rarity-icon" style={{ color: tier.color }}>{tier.icon}</span>
                <span className="rarity-label" style={{ color: tier.color }}>{tier.label}</span>
                <span className="rarity-pct">
                  {key === 'LEGENDARY' ? '5%' : key === 'MYTHIC' ? '25%' : '70%'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Form */}
        <div className="card form-card">
          <h3 className="card-title">✨ MINT DETAILS</h3>

          <div className="form-group">
            <label className="form-label">Image URL *</label>
            <input
              type="url"
              placeholder="https://..."
              value={formData.uri}
              onChange={e => handleImageChange(e.target.value)}
              className="form-input"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input
                type="text"
                placeholder="Cappy #001"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Symbol *</label>
              <input
                type="text"
                placeholder="CAPPY"
                value={formData.symbol}
                onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                className="form-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Royalty %</label>
            <input
              type="number"
              min="0" max="50" step="0.5"
              value={formData.royaltyPercent}
              onChange={e => setFormData({ ...formData, royaltyPercent: parseFloat(e.target.value) || 0 })}
              className="form-input"
            />
          </div>

          {/* Geiger Status */}
          {geigerStatus !== 'idle' && (
            <div className="status-box geiger-status">
              <span className={`status-icon ${geigerStatus === 'fulfilling' ? 'spin' : geigerStatus === 'complete' ? '' : 'pulse'}`}>
                {geigerStatus === 'complete' ? '✅' : '☢️'}
              </span>
              <span>{statusMsg[geigerStatus]}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="status-box error-status">
              ❌ {error}
            </div>
          )}

          {/* Mint Button */}
          <button
            onClick={handleMint}
            disabled={!connected || minting || !formData.name || !formData.symbol || !formData.uri}
            className={`mint-btn ${connected && !minting ? 'mint-btn-active' : ''}`}
          >
            {minting ? '☢️ MINTING...' : connected ? '🦫 MINT CAPPY' : 'CONNECT WALLET'}
          </button>

          {/* Result */}
          {result && (
            <div className="result-box" style={{ background: result.rarityConfig.bg, borderColor: result.rarityConfig.color }}>
              <div className="result-header">
                <span className="result-icon">{result.rarityConfig.icon}</span>
                <span className="result-title" style={{ color: result.rarityConfig.color }}>
                  {result.rarityConfig.label} CAPPY MINTED!
                </span>
              </div>
              <div className="result-details">
                <p className="result-mono">Mint: {shortenAddress(result.mintAddress)}</p>
                <p className="result-mono">Entropy: {result.entropyHash}</p>
              </div>
              <a
                href={`https://explorer.x1.xyz/tx/${result.txid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="result-link"
                style={{ color: result.rarityConfig.color }}
              >
                View on Explorer →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="footer">
        Powered by X1 Network · Geiger Entropy Oracle ☢️
      </footer>
    </div>
  );
}