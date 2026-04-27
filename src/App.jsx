import React, { useState } from 'react';
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

const RARITY = {
  LEGENDARY: { pct: 5, label: 'Legendary', color: '#ffd700', icon: '👑', glow: '0 0 30px rgba(255,215,0,0.4)' },
  MYTHIC:   { pct: 25, label: 'Mythic',    color: '#ff6b35', icon: '✨', glow: '0 0 30px rgba(255,107,53,0.4)' },
  COMMON:   { pct: 70, label: 'Common',    color: '#9ca3af', icon: '🦫', glow: '0 0 20px rgba(156,163,175,0.2)' },
};

const WALLETS = [
  { key: 'phantom',  name: 'Phantom',   icon: '👻' },
  { key: 'backpack', name: 'Backpack',  icon: '🎒' },
  { key: 'solflare', name: 'Solflare',  icon: '🔥' },
];

function getProvider(key) {
  if (key === 'phantom')  return window.phantom?.solana;
  if (key === 'backpack') return window.backpack?.solana;
  if (key === 'solflare') return window.solflare;
  return null;
}

function short(addr) { return addr ? `${addr.slice(0,6)}...${addr.slice(-4)}` : ''; }

export default function App() {
  const [provider, setProvider] = useState(null);
  const [pubkey, setPubkey] = useState(null);
  const [connected, setConnected] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [form, setForm] = useState({ name: '', symbol: '', uri: '', royalty: 5 });
  const [imgOk, setImgOk] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const [minting, setMinting] = useState(false);
  const [geiger, setGeiger] = useState(''); // '', 'requesting', 'fulfilling', 'done'
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const conn = new Connection(import.meta.env.VITE_RPC_URL || RPC, 'confirmed');

  const [oraclePDA] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], GEIGER_PROGRAM_ID);
  const [poolPDA]   = PublicKey.findProgramAddressSync([Buffer.from('entropy_pool')], GEIGER_PROGRAM_ID);

  const connect = async (key) => {
    setErr(null);
    try {
      const prov = getProvider(key);
      if (!prov) throw new Error(`${WALLETS.find(w=>w.key===key).name} not found`);
      const resp = await prov.connect();
      setProvider(prov);
      setPubkey(resp.publicKey);
      setConnected(true);
      setShowWallets(false);
    } catch (e) { setErr(e.message); }
  };

  const disconnect = async () => {
    if (provider) try { await provider.disconnect(); } catch(_) {}
    setProvider(null); setPubkey(null); setConnected(false);
  };

  const onUri = (uri) => {
    setForm(f => ({ ...f, uri }));
    setImgOk(false); setImgErr(false);
    if (uri) {
      const img = new Image();
      img.onload = () => setImgOk(true);
      img.onerror = () => setImgErr(true);
      img.src = uri;
    }
  };

  const mint = async () => {
    if (!connected) { setErr('Connect wallet first'); return; }
    if (!form.name || !form.symbol || !form.uri) { setErr('Name, symbol, and image URI required'); return; }
    setMinting(true); setErr(null); setResult(null); setGeiger('requesting');
    try {
      const { Keypair } = await import('@solana/web3.js');
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');

      // 1. Geiger randomness
      const anchorProv = new anchor.AnchorProvider(conn,
        { publicKey, signTransaction: provider.signTransaction.bind(provider) },
        { commitment: 'confirmed' }
      );
      anchor.setProvider(anchorProv);
      const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProv);

      const userSeed = crypto.getRandomValues(new Uint8Array(32));
      const oracleState = await program.account.oracleState.fetch(oraclePDA);
      const idx = Buffer.alloc(8);
      idx.writeBigUInt64LE(BigInt(oracleState.totalRequests.toString()));
      const [reqPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('rand_request'), pubkey.toBuffer(), idx], GEIGER_PROGRAM_ID
      );

      await program.methods.requestRandomness(Array.from(userSeed)).accounts({
        oracleState: oraclePDA, entropyPool: poolPDA, randomnessRequest: reqPDA,
        requester: pubkey, systemProgram: SystemProgram.programId,
      }).rpc();

      setGeiger('fulfilling');

      await program.methods.fulfillRandomness().accounts({
        oracleState: oraclePDA, entropyPool: poolPDA, randomnessRequest: reqPDA,
        requester: pubkey, systemProgram: SystemProgram.programId,
      }).rpc();

      const req = await program.account.randomnessRequest.fetch(reqPDA);
      const entropyBytes = req.result;
      const val = entropyBytes.slice(0, 8).reduce((a, b, i) => a + b * Math.pow(256, -i - 1), 0);
      let tier;
      if (val < 0.05) tier = 'LEGENDARY';
      else if (val < 0.30) tier = 'MYTHIC';
      else tier = 'COMMON';
      setGeiger('done');

      // 2. Mint NFT
      const mintKP = Keypair.generate();
      const mintPk = mintKP.publicKey;
      const lamports = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
      const ata = getAssociatedTokenAddressSync(mintPk, pubkey);
      const [metaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], METADATA_PROGRAM_ID
      );

      const tx = new Transaction();
      tx.add(SystemProgram.createAccount({ fromPubkey: pubkey, newAccountPubkey: mintPk, space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID }));
      tx.add(createInitializeMintInstruction(mintPk, 0, pubkey, pubkey, TOKEN_PROGRAM_ID));
      tx.add(createAssociatedTokenAccountInstruction(pubkey, ata, pubkey, mintPk, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
      tx.add(createMintToInstruction(mintPk, ata, pubkey, 1, [], TOKEN_PROGRAM_ID));
      tx.add(createCreateMetadataAccountV3Instruction({
        metadata: metaPDA, mint: mintPk, mintAuthority: pubkey,
        payer: pubkey, updateAuthority: pubkey,
      }, {
        createMetadataAccountArgsV3: {
          data: {
            name: `${RARITY[tier].icon} ${form.name}`,
            symbol: form.symbol,
            uri: form.uri,
            sellerFeeBasisPoints: Math.floor(form.royalty * 100),
            creators: null, collection: null, uses: null,
          },
          isMutable: true, collectionDetails: null,
        },
      }));

      const { blockhash } = await conn.getLatestBlockhash();
      tx.recentBlockhash = blockhash; tx.feePayer = pubkey;
      tx.partialSign(mintKP);
      const signed = await provider.signTransaction(tx);
      const txid = await conn.sendRawTransaction(signed.serialize());
      await conn.confirmTransaction(txid, 'confirmed');

      setResult({ mint: mintPk.toString(), txid, tier, entropy: Buffer.from(entropyBytes).toString('hex').slice(0, 32) + '...' });
    } catch (e) {
      console.error(e);
      setErr(e.message?.slice(0, 300) || 'Mint failed');
      setGeiger('');
    } finally { setMinting(false); }
  };

  const tier = result ? RARITY[result.tier] : null;

  return (
    <div className="cappy-app">
      {/* Glow bg */}
      <div className="cappy-bg" />

      {/* Header */}
      <header className="cappy-header">
        <div className="cappy-brand">
          <span className="cappy-logo">🦫</span>
          <div>
            <h1 className="cappy-title">CAPPY</h1>
            <p className="cappy-subtitle">NFT Mint · X1 Network</p>
          </div>
        </div>
        {connected ? (
          <button className="cappy-wallet-pill" onClick={disconnect}>
            <span className="cappy-dot" />
            <span className="cappy-addr">{short(pubkey?.toString())}</span>
            <span className="cappy-x">✕</span>
          </button>
        ) : (
          <button className="cappy-connect" onClick={() => setShowWallets(true)}>
            Connect Wallet
          </button>
        )}
      </header>

      {/* Wallet Modal */}
      {showWallets && (
        <div className="cappy-overlay" onClick={() => setShowWallets(false)}>
          <div className="cappy-modal" onClick={e => e.stopPropagation()}>
            <h3 className="cappy-modal-title">Connect Wallet</h3>
            {WALLETS.map(w => (
              <button key={w.key} className="cappy-wallet-opt" onClick={() => connect(w.key)}>
                <span className="cappy-wallet-icon">{w.icon}</span>
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="cappy-main">
        {/* Left: Preview + Rarity */}
        <section className="cappy-card cappy-preview-section">
          <h2 className="cappy-section-title">PREVIEW</h2>
          <div className="cappy-preview-box">
            {form.uri && !imgErr ? (
              <img src={form.uri} alt="NFT preview" className="cappy-preview-img" onError={() => setImgErr(true)} />
            ) : (
              <div className="cappy-preview-empty">
                <span className="cappy-preview-empty-icon">🦫</span>
                <span>Paste an image URL to preview</span>
              </div>
            )}
            {imgOk && !imgErr && (
              <span className="cappy-img-badge">✓ Image loaded</span>
            )}
          </div>
          {imgErr && <p className="cappy-img-err">⚠️ Couldn't load image — check the URL</p>}

          {/* Rarity */}
          <div className="cappy-rarity">
            <h3 className="cappy-rarity-title">RARITY TIERS</h3>
            {Object.entries(RARITY).map(([key, r]) => (
              <div key={key} className="cappy-rarity-row" style={{ borderLeftColor: r.color }}>
                <span className="cappy-rarity-icon" style={{ color: r.color }}>{r.icon}</span>
                <span className="cappy-rarity-name" style={{ color: r.color }}>{r.label}</span>
                <span className="cappy-rarity-pct">{r.pct}%</span>
              </div>
            ))}
            <p className="cappy-rarity-note">
              ☢️ Determined by Geiger Entropy Oracle at mint time — provably random, on-chain verifiable.
            </p>
          </div>
        </section>

        {/* Right: Form + Status */}
        <section className="cappy-card cappy-form-section">
          <h2 className="cappy-section-title">MINT YOUR CAPPY</h2>

          <label className="cappy-label">
            Image URL *
            <input
              type="url"
              placeholder="https://arweave.net/... or IPFS URI"
              value={form.uri}
              onChange={e => onUri(e.target.value)}
              className="cappy-input"
            />
          </label>

          <div className="cappy-row">
            <label className="cappy-label cappy-col">
              Name *
              <input
                type="text"
                placeholder="Cappy #001"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="cappy-input"
              />
            </label>
            <label className="cappy-label cappy-col">
              Symbol *
              <input
                type="text"
                placeholder="CAPPY"
                value={form.symbol}
                onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                className="cappy-input"
              />
            </label>
          </div>

          <label className="cappy-label">
            Royalty %
            <input
              type="number" min="0" max="50" step="0.5"
              value={form.royalty}
              onChange={e => setForm(f => ({ ...f, royalty: parseFloat(e.target.value) || 0 }))}
              className="cappy-input"
            />
          </label>

          {/* Geiger status */}
          {geiger && (
            <div className={`cappy-status ${geiger === 'done' ? 'cappy-status-ok' : 'cappy-status-geiger'}`}>
              {geiger === 'requesting' && '☢️ Requesting Geiger entropy...'}
              {geiger === 'fulfilling' && '⚡ Fulfilling randomness...'}
              {geiger === 'done' && '✅ Entropy captured!'}
            </div>
          )}

          {/* Error */}
          {err && <div className="cappy-status cappy-status-err">❌ {err}</div>}

          {/* Mint button */}
          <button
            className={`cappy-mint-btn ${connected && !minting ? 'cappy-mint-btn-ready' : ''}`}
            onClick={mint}
            disabled={!connected || minting || !form.name || !form.symbol || !form.uri}
          >
            {minting ? '☢️ MINTING...' : connected ? '🦫 MINT CAPPY' : 'CONNECT WALLET TO MINT'}
          </button>

          {/* Result */}
          {result && tier && (
            <div className="cappy-result" style={{ borderColor: tier.color, boxShadow: tier.glow }}>
              <div className="cappy-result-header">
                <span className="cappy-result-icon">{tier.icon}</span>
                <span className="cappy-result-tier" style={{ color: tier.color }}>{tier.label} Cappy Minted!</span>
              </div>
              <div className="cappy-result-meta">
                <p><span className="cappy-result-label">Mint:</span> <code>{short(result.mint)}</code></p>
                <p><span className="cappy-result-label">Entropy:</span> <code>{result.entropy}</code></p>
              </div>
              <a href={`https://explorer.x1.xyz/tx/${result.txid}`} target="_blank" rel="noopener noreferrer" className="cappy-result-link">
                View on X1 Explorer →
              </a>
            </div>
          )}
        </section>
      </main>

      <footer className="cappy-footer">
        Powered by X1 Network · Geiger Entropy Oracle ☢️ · <a href="https://github.com/echohound-labs/geiger-entropy-oracle" target="_blank" rel="noopener noreferrer">Docs</a>
      </footer>
    </div>
  );
}