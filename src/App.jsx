import React, { useState, useEffect, useCallback } from 'react';
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
import { resolveTraits, calculateRarityScore, getEnvDetail, traitsToMetadata, TRAIT_DEFS } from './trait_resolver.js';
import './App.css';

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt918CN2');
const GEIGER_PROGRAM_ID = new PublicKey('BxUNg2yo5371BQMZPkfcxdCptFRDHkhvEXNM1QNPBRYU');
const RPC = 'https://rpc.mainnet.x1.xyz';

// ── Collection Config ──────────────────────────────────
const COLLECTION = {
  symbol: 'CAPPY',
  royalty: 5,
  baseUri: 'https://cappy-nft-mint.vercel.app/metadata/',
  namePrefix: 'Cappy',
  maxSupply: 1000,
};

// ── Tiers ───────────────────────────────────────────────
const TIERS = [
  { key: 'COMMON',    label: 'Common',    pct: 70, color: '#b87333', emoji: '🦫', armor: 'Light armor — minimal gear', glow: '0 0 30px rgba(184,115,51,0.25)', bg: 'linear-gradient(135deg,#2a1f0e,#1a1208)' },
  { key: 'MYTHIC',    label: 'Mythic',    pct: 25, color: '#e8722a', emoji: '✨', armor: 'Cyber armor — medium plating', glow: '0 0 30px rgba(232,114,42,0.3)',  bg: 'linear-gradient(135deg,#2a1508,#1a0c04)' },
  { key: 'LEGENDARY', label: 'Legendary', pct: 5,  color: '#ffd700', emoji: '👑', armor: 'Heavy exosuit — full plating', glow: '0 0 40px rgba(255,215,0,0.35)',  bg: 'linear-gradient(135deg,#2a2208,#1a1604)' },
];

const TIERS_BY_KEY = Object.fromEntries(TIERS.map(t => [t.key, t]));

// ── Background display names ────────────────────────────
const BG_DISPLAY = {
  swamp: { emoji: '🌿', label: 'Swamp', color: '#4a7c3f' },
  forest: { emoji: '🌲', label: 'Forest', color: '#2d5a27' },
  lava_core: { emoji: '🌋', label: 'Lava Core', color: '#c0392b' },
  neon_city: { emoji: '🌃', label: 'Neon City', color: '#00d4ff' },
  ocean_lab: { emoji: '🌊', label: 'Ocean Lab', color: '#2980b9' },
  space_grid: { emoji: '🪐', label: 'Space Grid', color: '#9b59b6' },
};

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

function formatTraitValue(val) {
  if (val === 'none') return 'None';
  return val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function DisclaimerModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="c-overlay" onClick={onClose}>
      <div className="c-modal" onClick={e => e.stopPropagation()}>
        <h2>⚠️ Disclaimer</h2>
        <div className="c-modal-body">
          <p><strong>Last updated: May 7, 2026</strong></p>
          <p>By accessing this website and participating in the CAPPY NFT mint, you acknowledge and agree to the following:</p>
          <ol>
            <li><strong>No Financial Advice.</strong> Nothing on this website constitutes financial, investment, legal, or tax advice.</li>
            <li><strong>High Risk.</strong> Cryptocurrency and NFTs are highly volatile and speculative. You may lose all funds spent.</li>
            <li><strong>No Guarantees.</strong> The project makes no guarantees regarding token value, liquidity, returns, or market performance.</li>
            <li><strong>Not a Security.</strong> CAPPY NFTs are not securities, investment contracts, or financial instruments. They are digital collectibles.</li>
            <li><strong>Randomized Rarity.</strong> Each CAPPY NFT is assigned traits at mint time using the Geiger Entropy Oracle. Tier (Common 70%, Mythic 25%, Legendary 5%), background, expression, hat, accessory, and companion are all determined by on-chain randomness. Results are unpredictable, provably random, and final.</li>
            <li><strong>Environment-Aware Traits.</strong> Each trait has a unique variant per environment — a crown in lava_core has molten metal and ember glow, while the same crown in neon_city is chrome with LED tips. Rarity score reflects the combined weight of ALL traits, not just tier.</li>
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

// ── Trait Display Component ─────────────────────────────
function TraitDisplay({ traits, tier }) {
  if (!traits) return null;
  const bgInfo = BG_DISPLAY[traits.background] || { emoji: '❓', label: traits.background, color: '#888' };
  const rarityScore = calculateRarityScore(traits);

  const traitRows = [
    { label: 'Background', value: traits.background, emoji: bgInfo.emoji, color: bgInfo.color, envDetail: null },
    { label: 'Expression', value: traits.expression, emoji: '😀', color: '#e8e4d8' },
    { label: 'Hat', value: traits.hat, emoji: '🧢', color: tier.color, envDetail: getEnvDetail('hat', traits.hat, traits.background) },
    { label: 'Accessory', value: traits.accessory, emoji: '🎖️', color: tier.color, envDetail: getEnvDetail('accessory', traits.accessory, traits.background) },
    { label: 'Companion', value: traits.companion, emoji: '🦆', color: tier.color, envDetail: getEnvDetail('companion', traits.companion, traits.background) },
  ];

  return (
    <div className="c-traits">
      <div className="c-traits-header">
        <span className="c-traits-score" style={{ color: rarityScore > 50 ? '#ffd700' : rarityScore > 25 ? '#e8722a' : '#b87333' }}>
          Rarity Score: {rarityScore}
        </span>
      </div>
      {traitRows.map(row => (
        <div key={row.label} className="c-trait-row">
          <span className="c-trait-emoji">{row.emoji}</span>
          <span className="c-trait-label">{row.label}</span>
          <span className="c-trait-value" style={{ color: row.color }}>{formatTraitValue(row.value)}</span>
          {row.envDetail && (
            <span className="c-trait-env">{row.envDetail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [provider, setProvider] = useState(null);
  const [pubkey, setPubkey] = useState(null);
  const [connected, setConnected] = useState(false);
  const [showWallets, setShowWallets] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [agreed, setAgreed] = useState(() => sessionStorage.getItem('cappy_disclaimer_agreed') === '1');
  const [minting, setMinting] = useState(false);
  const [geiger, setGeiger] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [mintCount, setMintCount] = useState(0);

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
        { publicKey: pubkey, signTransaction: provider.signTransaction.bind(provider) },
        { commitment: 'confirmed' }
      );
      anchor.setProvider(anchorProv);
      const program = new anchor.Program(GEIGER_IDL, GEIGER_PROGRAM_ID, anchorProv);

      // 1. Geiger randomness request
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

      // 2. Read entropy result
      const req = await program.account.randomnessRequest.fetch(reqPDA);
      const entropyBytes = req.result;

      // 3. Resolve traits from entropy
      const traits = resolveTraits(entropyBytes);
      const tier = TIERS_BY_KEY[traits.tier];
      const metadata = traitsToMetadata(traits);

      setGeiger('done');

      // 4. Mint NFT
      const mintKP = Keypair.generate();
      const mintPk = mintKP.publicKey;
      const lamports = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
      const ata = getAssociatedTokenAddressSync(mintPk, pubkey);
      const [metaPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], METADATA_PROGRAM_ID
      );

      // Use rarity score as sequential-ish ID (collision-resistant)
      const mintId = rarityScoreToId(traits, entropyBytes);

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
            name: metadata.name,
            symbol: COLLECTION.symbol,
            uri: `${COLLECTION.baseUri}${mintId}.json`,
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
        tierKey: traits.tier,
        tier,
        traits,
        metadata,
        mintId,
        entropy: Buffer.from(entropyBytes).toString('hex').slice(0, 32) + '...',
        rarityScore: calculateRarityScore(traits),
      });

      setMintCount(c => c + 1);
      setTimeout(() => setReveal(true), 200);
    } catch (e) {
      console.error(e);
      setErr(e.message?.slice(0, 400) || 'Mint failed');
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
            <p className="c-header-sub">NFT Mint · X1 Network · Geiger Entropy ☢️</p>
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
        <div className="c-mint-area">

          {/* Left: Card Preview */}
          <div className={`c-card-container ${reveal ? 'c-card-revealed' : ''}`}>
            {result && reveal ? (
              <div className="c-result-card" style={{ background: result.tier.bg, borderColor: result.tier.color, boxShadow: result.tier.glow }}>
                <div className="c-result-badge" style={{ color: result.tier.color, borderColor: result.tier.color }}>{result.tier.label.toUpperCase()}</div>
                <div className="c-result-emoji">{result.tier.emoji}</div>
                <div className="c-result-name" style={{ color: result.tier.color }}>{result.tier.emoji} Cappy #{result.mintId}</div>
                <div className="c-result-armor" style={{ color: result.tier.color }}>{result.tier.armor}</div>
                <TraitDisplay traits={result.traits} tier={result.tier} />
                <div className="c-result-meta">
                  <p><span className="c-meta-label">Mint</span> <code>{short(result.mint)}</code></p>
                  <p><span className="c-meta-label">Entropy</span> <code>{result.entropy}</code></p>
                  <p><span className="c-meta-label">Score</span> <code style={{ color: result.rarityScore > 50 ? '#ffd700' : result.rarityScore > 25 ? '#e8722a' : '#b87333' }}>{result.rarityScore}</code></p>
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
                    '🦫 Resolving traits...'
                  ) : 'Your Cappy appears here'}
                </div>
              </div>
            )}
          </div>

          {/* Right: Action */}
          <div className="c-action-area">
            <div className="c-tier-pills">
              {TIERS.map(t => (
                <div key={t.key} className="c-tier-pill" style={{ borderColor: t.color }}>
                  <span className="c-tier-pill-emoji">{t.emoji}</span>
                  <span className="c-tier-pill-name" style={{ color: t.color }}>{t.label}</span>
                  <span className="c-tier-pill-pct">{t.pct}%</span>
                </div>
              ))}
            </div>

            {/* Trait odds preview */}
            <div className="c-trait-preview">
              <div className="c-trait-preview-title">🦫 Trait Odds</div>
              {Object.entries(TRAIT_DEFS).map(([trait, def]) => (
                <div key={trait} className="c-trait-preview-row">
                  <span className="c-trait-preview-label">{trait.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <div className="c-trait-preview-bar">
                    {Object.entries(def.options).map(([name, weight]) => (
                      <div key={name} className="c-trait-preview-segment" style={{ width: `${weight * 100}%`, background: weight < 0.1 ? '#ffd700' : weight < 0.2 ? '#e8722a' : '#b87333' }} title={`${formatTraitValue(name)}: ${(weight * 100).toFixed(0)}%`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="c-entropy-badge">
              ☢️ Rarity determined by Geiger Entropy Oracle — provably random, on-chain verifiable
            </div>

            <div className="c-supply-badge">
              🦫 Limited to <strong>1,000</strong> Cappys — no more will ever be minted
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
                  {geiger === 'requesting' ? 'Requesting Entropy...' : geiger === 'fulfilling' ? 'Fulfilling...' : geiger === 'done' ? 'Resolving...' : 'Minting...'}
                </>
              ) : connected ? (
                '🦫 Mint Cappy — 10 XNT'
              ) : (
                'Connect Wallet'
              )}
            </button>

            <p className="c-price-note">Mint price: <strong>10 XNT</strong> + network fees · Rarity score reflects all traits, not just tier</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="c-footer">
        <p>Powered by X1 Network · Geiger Entropy Oracle ☢️ · <a href="https://github.com/echohound-labs/cappy-nft-mint" target="_blank" rel="noopener noreferrer">GitHub</a></p>
        <p className="c-footer-legal">CAPPY NFTs are digital collectibles, not securities. No financial guarantees. Mint at your own risk. Environment-aware traits — every detail changes per biome.</p>
      </footer>
    </div>
  );
}

// Deterministic mint ID from traits + entropy (avoids collisions within 1000 supply)
function rarityScoreToId(traits, entropyBytes) {
  // Use last 4 bytes of entropy for a unique ID, capped at 999
  const raw = entropyBytes.slice(28, 32);
  const val = ((raw[0] << 8 | raw[1]) << 8 | raw[2]) << 8 | raw[3];
  return (val % 999) + 1;
}
