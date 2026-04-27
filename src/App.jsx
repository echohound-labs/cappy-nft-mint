import React, { useState } from 'react';
import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
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

// ── Collection Config ──────────────────────────────────
const COLLECTION = {
  symbol: 'CAPPY',
  royalty: 5,        // 5%
  baseUri: 'https://cappy-nft-mint.vercel.app/metadata/',  // placeholder
  namePrefix: 'Cappy',
};
// ── Tiers ───────────────────────────────────────────────
const TIERS = [
  { key: 'COMMON',    label: 'Common',    pct: 70, color: '#b87333', emoji: '🦫', glow: '0 0 30px rgba(184,115,51,0.25)', bg: 'linear-gradient(135deg,#2a1f0e,#1a1208)' },
  { key: 'MYTHIC',    label: 'Mythic',    pct: 25, color: '#e8722a', emoji: '✨', glow: '0 0 30px rgba(232,114,42,0.3)',  bg: 'linear-gradient(135deg,#2a1508,#1a0c04)' },
  { key: 'LEGENDARY', label: 'Legendary', pct: 5,  color: '#ffd700', emoji: '👑', glow: '0 0 40px rgba(255,215,0,0.35)',  bg: 'linear-gradient(135deg,#2a2208,#1a1604)' },
];

const WALLETS = [
  { key: 'phantom',  name: 'Phantom',  icon: '👻' },
  { key: 'backpack', name: 'Backpack', icon: '🎒' },
  { key: 'solflare', name: 'Solflare', icon: '🔥' },
];

function getProvider(key) {
  if (key === 'phantom')  return window.phantom?.solana;
  if (key === 'backpack') return window.backpack?.solana;
  if (key === 'solflare') return window.solflare;
  return null;
}

function short(a) { return a ? `${a.slice(0,5)}...${a.slice(-4)}` : ''; }

function DisclaimerModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="c-overlay" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()}>
        <h2>⚠️ Disclaimer</h2>
        <div className="c-modal-body">
          <p><strong>Last updated: April 27, 2026</strong></p>
          <p>By accessing this website and participating in the CAPPY NFT mint, you acknowledge and agree to the following:</p>
          <ol>
            <li><strong>No Financial Advice.</strong> Nothing on this website constitutes financial, investment, legal, or tax advice.</li>
            <li><strong>High Risk.</strong> Cryptocurrency and NFTs are highly volatile and speculative. You may lose all funds spent.</li>
            <li><strong>No Guarantees.</strong> The project makes no guarantees regarding token value, liquidity, returns, or market performance.</li>
            <li><strong>Not a Security.</strong> CAPPY NFTs are not securities, investment contracts, or financial instruments. They are digital collectibles.</li>
            <li><strong>Randomized Rarity.</strong> Each CAPPY NFT is assigned a rarity tier (Common 70%, Mythic 25%, Legendary 5%) at mint time using the Geiger Entropy Oracle. Results are unpredictable, provably random, and final.</li>
            <li><strong>Regulatory Risk.</strong> Regulations vary by jurisdiction. Ensure compliance with local laws before participating.</li>
            <li><strong>Smart Contract Risk.</strong> Smart contracts may contain bugs or vulnerabilities. Participation is at your own risk.</li>
            <li><strong>No Refunds.</strong> All mints are final. No refunds once a transaction is confirmed on-chain.</li>
            <li><strong>Independent Project.</strong> CAPPY is not endorsed by, affiliated with, or sponsored by the X1 Network Foundation or any exchange.</li>
            <li><strong>Age Requirement.</strong> You must be at least 18 years old to participate.</li>
            <li><strong>Limitation of Liability.</strong> The creators disclaim all liability for any damages arising from your participation.</li>
          </ol>
          <p>By clicking "I Agree," you confirm that you have read, understood, and accept all terms above.</p>
        </div>
        <div className="c-modal-actions">
          <button className="c-modal-agree" onClick={onClose}>I Agree</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [pubkey, setPubkey] = useState(null);
  const [connected, setConnected] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [agreed, setAgreed] = useState(() => {
    // Check session storage so it doesn't pop up every refresh within same session
    return sessionStorage.getItem('cappy_disclaimer_agreed') === '1';
  });
  const [minting, setMinting] = useState(false);
  const [geiger, setGeiger] = useState(''); // '', 'requesting', 'fulfilling', 'done'
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [reveal, setReveal] = useState(false);

  const conn = new Connection(import.meta.env.VITE_RPC_URL || RPC, 'confirmed');
  const [oraclePDA] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], GEIGER_PROGRAM_ID);
  const [poolPDA]   = PublicKey.findProgramAddressSync([Buffer.from('entropy_pool')], GEIGER_PROGRAM_ID);

  const connect = async (key) => {
    setErr(null);
    if (!agreed) { setShowDisclaimer(true); return; }
    try {
      const prov = getProvider(key);
      if (!prov) throw new Error(`${WALLETS.find(w => w.key === key).name} not found. Install it first.`);
      const resp = await prov.connect();
      setProvider(prov); setPubkey(resp.publicKey); setConnected(true); setShowWallets(false);
    } catch (e) { setErr(e.message); }
  };

  const disconnect = async () => {
    if (provider) try { await provider.disconnect(); } catch (_) {}
    setProvider(null); setPubkey(null); setConnected(false);
  };

  const startMint = async () => {
    if (!connected) { setShowWallets(true); return; }
    setMinting(true); setErr(null); setResult(null); setReveal(false); setGeiger('requesting');
    try {
      const { Keypair } = await import('@solana/web3.js');
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');

      const anchorProv = new anchor.AnchorProvider(conn,
        { publicKey, signTransaction: provider.signTransaction.bind(provider) },
        { commitment: 'confirmed' }
      );
      anchor.setProvider(anchorProv);
      const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProv);

      // 1. Geiger randomness
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
      const bytes = req.result;
      const val = bytes.slice(0, 8).reduce((a, b, i) => a + b * Math.pow(256, -i - 1), 0);

      let tierKey, tier;
      if (val < 0.05)       { tierKey = 'LEGENDARY'; tier = TIERS[2]; }
      else if (val < 0.30)  { tierKey = 'MYTHIC';    tier = TIERS[1]; }
      else                  { tierKey = 'COMMON';    tier = TIERS[0]; }

      setGeiger('done');

      // 2. Mint NFT
      const mintKP = Keypair.generate();
      const mintPk = mintKP.publicKey;
      const lamports = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
      const ata = getAssociatedTokenAddressSync(mintPk, pubkey);
      const [metaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], METADATA_PROGRAM_ID
      );

      // Sequential mint number — use timestamp for uniqueness
      const mintNumber = Date.now().toString(36).toUpperCase().slice(-4);

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
            name: `${tier.emoji} ${COLLECTION.namePrefix} #${mintNumber}`,
            symbol: COLLECTION.symbol,
            uri: `${COLLECTION.baseUri}${mintNumber}.json`,
            sellerFeeBasisPoints: COLLECTION.royalty * 100,
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

      setResult({
        mint: mintPk.toString(),
        txid,
        tierKey,
        tier,
        mintNumber,
        entropy: Buffer.from(bytes).toString('hex').slice(0, 32) + '...',
      });

      setTimeout(() => setReveal(true), 200);
    } catch (e) {
      console.error(e);
      setErr(e.message?.slice(0, 300) || 'Mint failed');
      setGeiger('');
    } finally { setMinting(false); }
  };

  return (
    <div className="c-app">
      {/* Wallet Modal */}
      {showWallets && (
        <div className="c-overlay" onClick={() => setShowWallets(false)}>
          <div className="c-modal" onClick={e => e.stopPropagation()}>
            <h3 className="c-modal-title">Connect Wallet</h3>
            {WALLETS.map(w => (
              <button key={w.key} className="c-wallet-opt" onClick={() => connect(w.key)}>
                <span className="c-wallet-icon">{w.icon}</span>
                <span>{w.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <DisclaimerModal open={showDisclaimer} onClose={() => { setAgreed(true); sessionStorage.setItem('cappy_disclaimer_agreed', '1'); setShowDisclaimer(false); }} />

      {/* Header */}
      <header className="c-header">
        <div className="c-header-brand">
          <span className="c-header-emoji">🦫</span>
          <div>
            <h1 className="c-header-title">CAPPY</h1>
            <p className="c-header-sub">NFT Mint · X1 Network</p>
          </div>
        </div>
        {connected ? (
          <button className="c-wallet-pill" onClick={disconnect}>
            <span className="c-wallet-dot" />
            <span className="c-wallet-addr">{short(pubkey?.toString())}</span>
            <span className="c-wallet-x">✕</span>
          </button>
        ) : (
          <button className="c-header-connect" onClick={() => agreed ? setShowWallets(true) : setShowDisclaimer(true)}>Connect</button>
        )}
      </header>

      {/* Main */}
      <main className="c-main">

        {/* ── Mint Card ────────────────────────────── */}
        <div className="c-mint-area">

          {/* Left: Card Preview */}
          <div className={`c-card-container ${reveal ? 'c-card-revealed' : ''}`}>
            {result && reveal ? (
              <div className="c-result-card" style={{ background: result.tier.bg, borderColor: result.tier.color, boxShadow: result.tier.glow }}>
                <div className="c-result-badge" style={{ color: result.tier.color, borderColor: result.tier.color }}>{result.tier.label.toUpperCase()}</div>
                <div className="c-result-emoji">{result.tier.emoji}</div>
                <div className="c-result-name" style={{ color: result.tier.color }}>{result.tier.emoji} {COLLECTION.namePrefix} #{result.mintNumber}</div>
                <div className="c-result-chance" style={{ color: result.tier.color }}>{result.tier.pct}% chance</div>
                <div className="c-result-meta">
                  <p><span className="c-meta-label">Mint</span> <code>{short(result.mint)}</code></p>
                  <p><span className="c-meta-label">Entropy</span> <code>{result.entropy}</code></p>
                </div>
                <a href={`https://explorer.x1.xyz/tx/${result.txid}`} target="_blank" rel="noopener noreferrer" className="c-result-link" style={{ color: result.tier.color }}>
                  View on X1 Explorer →
                </a>
              </div>
            ) : (
              <div className="c-placeholder-card">
                <div className="c-placeholder-emoji">🦫</div>
                <div className="c-placeholder-text">
                  {minting ? (
                    geiger === 'requesting' ? '☢️ Requesting entropy...' :
                    geiger === 'fulfilling' ? '⚡ Fulfilling randomness...' :
                    '🦫 Minting...'
                  ) : 'Your Cappy appears here'}
                </div>
              </div>
            )}
          </div>

          {/* Right: Action */}
          <div className="c-action-area">
            {/* Tier preview pills */}
            <div className="c-tier-pills">
              {TIERS.map(t => (
                <div key={t.key} className="c-tier-pill" style={{ borderColor: t.color }}>
                  <span className="c-tier-pill-emoji">{t.emoji}</span>
                  <span className="c-tier-pill-name" style={{ color: t.color }}>{t.label}</span>
                  <span className="c-tier-pill-pct">{t.pct}%</span>
                </div>
              ))}
            </div>

            <div className="c-entropy-badge">
              ☢️ Rarity determined by Geiger Entropy Oracle — provably random, on-chain verifiable
            </div>

            {err && <div className="c-err">❌ {err}</div>}

            <button
              className={`c-mint-btn ${connected && !minting ? 'c-mint-btn-active' : ''}`}
              onClick={startMint}
              disabled={minting}
            >
              {minting ? (
                <>
                  <span className="c-mint-spinner" />
                  {geiger === 'requesting' ? 'Requesting Entropy...' : geiger === 'fulfilling' ? 'Fulfilling...' : 'Minting...'}
                </>
              ) : connected ? (
                '🦫 Mint Cappy'
              ) : (
                'Connect Wallet'
              )}
            </button>

            <p className="c-price-note">Mint price: <strong>10 XNT</strong> + network fees</p>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="c-footer">
        <p>Powered by X1 Network · Geiger Entropy Oracle ☢️</p>
        <p><a href="https://github.com/echohound-labs/geiger-entropy-oracle" target="_blank" rel="noopener noreferrer">Docs</a> · <a href="https://explorer.x1.xyz" target="_blank" rel="noopener noreferrer">Explorer</a></p>
        <p className="c-footer-legal">CAPPY NFTs are digital collectibles, not securities. No financial guarantees. Mint at your own risk.</p>
      </footer>
    </div>
  );
}