import React, { useState, useEffect } from 'react';
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

const WALLETS = [
  { key: 'phantom', name: 'Phantom', icon: '👻' },
  { key: 'backpack', name: 'Backpack', icon: '🎒' },
  { key: 'solflare', name: 'Solflare', icon: '🔥' },
];

function getProvider(key) {
  if (key === 'phantom') return window.phantom?.solana;
  if (key === 'backpack') return window.backpack?.solana;
  if (key === 'solflare') return window.solflare;
  return null;
}

function short(a) { return a ? `${a.slice(0,5)}...${a.slice(-4)}` : ''; }

function DisclaimerModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="cappy-overlay" onClick={onClose}>
      <div className="cappy-modal" onClick={e => e.stopPropagation()}>
        <h2>⚠️ Disclaimer</h2>
        <div className="cappy-modal-body">
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
        <div className="cappy-modal-actions">
          <button className="cappy-modal-agree" onClick={onClose}>I Agree</button>
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
  const [agreed, setAgreed] = useState(false);
  const [form, setForm] = useState({ name: '', symbol: '', uri: '', royalty: 5 });
  const [imgOk, setImgOk] = useState(false);
  const [minting, setMinting] = useState(false);
  const [geiger, setGeiger] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const conn = new Connection(import.meta.env.VITE_RPC_URL || RPC, 'confirmed');
  const [oraclePDA] = PublicKey.findProgramAddressSync([Buffer.from('oracle_state')], GEIGER_PROGRAM_ID);
  const [poolPDA] = PublicKey.findProgramAddressSync([Buffer.from('entropy_pool')], GEIGER_PROGRAM_ID);

  const connect = async (key) => {
    setErr(null);
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

  const onUri = (uri) => {
    setForm(f => ({ ...f, uri }));
    setImgOk(false);
    if (uri) { const img = new Image(); img.onload = () => setImgOk(true); img.src = uri; }
  };

  const mint = async () => {
    if (!connected) { setErr('Connect wallet first'); return; }
    if (!agreed) { setShowDisclaimer(true); return; }
    if (!form.name || !form.symbol || !form.uri) { setErr('Name, symbol, and image URI required'); return; }
    setMinting(true); setErr(null); setResult(null); setGeiger('requesting');
    try {
      const { Keypair } = await import('@solana/web3.js');
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');

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
      const bytes = req.result;
      const val = bytes.slice(0, 8).reduce((a, b, i) => a + b * Math.pow(256, -i - 1), 0);
      let tier, tierConfig;
      if (val < 0.05) { tier = 'LEGENDARY'; tierConfig = { label: 'Legendary', color: '#ffd700', icon: '👑' }; }
      else if (val < 0.30) { tier = 'MYTHIC'; tierConfig = { label: 'Mythic', color: '#ff6b35', icon: '✨' }; }
      else { tier = 'COMMON'; tierConfig = { label: 'Common', color: '#9ca3af', icon: '🦫' }; }

      setGeiger('done');

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
            name: `${tierConfig.icon} ${form.name}`,
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

      setResult({ mint: mintPk.toString(), txid, tier, tierConfig, entropy: Buffer.from(bytes).toString('hex').slice(0, 32) + '...' });
    } catch (e) {
      console.error(e);
      setErr(e.message?.slice(0, 300) || 'Mint failed');
      setGeiger('');
    } finally { setMinting(false); }
  };

  const tc = result?.tierConfig;

  return (
    <div className="cappy-app">
      <div className="cappy-bg" />

      <DisclaimerModal open={showDisclaimer} onClose={() => { setAgreed(true); setShowDisclaimer(false); }} />

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

      {/* Nav */}
      <nav className="cappy-nav">
        <div className="cappy-nav-brand">
          <span className="cappy-nav-logo">🦫</span>
          <span className="cappy-nav-title">CAPPY</span>
        </div>
        {connected ? (
          <button className="cappy-wallet-pill" onClick={disconnect}>
            <span className="cappy-dot" />
            <span className="cappy-addr">{short(pubkey?.toString())}</span>
            <span className="cappy-x">✕</span>
          </button>
        ) : (
          <button className="cappy-nav-connect" onClick={() => setShowWallets(true)}>Connect Wallet</button>
        )}
      </nav>

      {/* Hero */}
      <section className="cappy-hero">
        <div className="cappy-particles">
          {Array.from({ length: 15 }).map((_, i) => (
            <span key={i} className="cappy-particle" style={{
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${4 + Math.random() * 4}s`,
            }} />
          ))}
        </div>
        <div className="cappy-hero-content">
          <span className="cappy-badge">X1 Network · Powered by Geiger Entropy Oracle ☢️</span>
          <h1 className="cappy-hero-title">CAPPY</h1>
          <p className="cappy-hero-desc">Mint unique capybara NFTs with provable on-chain randomness. Every Cappy's rarity is determined at mint time by the Geiger Entropy Oracle — quantum decay, verifiable on-chain.</p>
          <div className="cappy-stats">
            <div className="cappy-stat">
              <div className="cappy-stat-num">3</div>
              <div className="cappy-stat-label">Rarity Tiers</div>
            </div>
            <div className="cappy-stat">
              <div className="cappy-stat-num">5%</div>
              <div className="cappy-stat-label">Legendary</div>
            </div>
            <div className="cappy-stat">
              <div className="cappy-stat-num">☢️</div>
              <div className="cappy-stat-label">Geiger Random</div>
            </div>
          </div>
          <a href="#mint" className="cappy-cta">Mint Your Cappy ↓</a>
        </div>
      </section>

      {/* Tiers */}
      <section className="cappy-tiers" id="tiers">
        <h2>Three Tiers. Three Temperaments.</h2>
        <p className="cappy-section-sub">Every capybara is unique — but some are more legendary than others.</p>
        <div className="cappy-tier-grid">
          <div className="cappy-tier-card cappy-tier-common">
            <div className="cappy-tier-badge" style={{ color: '#9ca3af', borderColor: '#9ca3af' }}>COMMON</div>
            <div className="cappy-tier-emoji">🦫</div>
            <h3 style={{ color: '#9ca3af' }}>COMMON</h3>
            <p className="cappy-tier-desc">The chill capybara. Soaking in the onsen, minding its business. Most will be this — but "common" is relative when every one is unique.</p>
            <div className="cappy-tier-chance">
              <span className="cappy-tier-pct" style={{ color: '#9ca3af' }}>70%</span>
              <span className="cappy-tier-pct-label">chance</span>
            </div>
          </div>
          <div className="cappy-tier-card cappy-tier-mythic">
            <div className="cappy-tier-badge" style={{ color: '#ff6b35', borderColor: '#ff6b35' }}>MYTHIC</div>
            <div className="cappy-tier-emoji">✨</div>
            <h3 style={{ color: '#ff6b35' }}>MYTHIC</h3>
            <p className="cappy-tier-desc">The hot spring boss. Glowing ember markings, rare temperament. 1 in 4 mints — if you're lucky enough to feel the heat.</p>
            <div className="cappy-tier-chance">
              <span className="cappy-tier-pct" style={{ color: '#ff6b35' }}>25%</span>
              <span className="cappy-tier-pct-label">chance</span>
            </div>
          </div>
          <div className="cappy-tier-card cappy-tier-legendary">
            <div className="cappy-tier-badge" style={{ color: '#ffd700', borderColor: '#ffd700' }}>LEGENDARY</div>
            <div className="cappy-tier-emoji">👑</div>
            <h3 style={{ color: '#ffd700' }}>LEGENDARY</h3>
            <p className="cappy-tier-desc">The capybara king. Golden crown, radiant aura, one per twenty. If you see this, you've witnessed something rare.</p>
            <div className="cappy-tier-chance">
              <span className="cappy-tier-pct" style={{ color: '#ffd700' }}>5%</span>
              <span className="cappy-tier-pct-label">chance</span>
            </div>
          </div>
        </div>
        <div className="cappy-entropy-note">
          <span className="cappy-entropy-icon">☢️</span>
          <div>
            <strong>Which one will you get?</strong>
            <p>Rarity is determined by the <a href="https://github.com/echohound-labs/geiger-entropy-oracle" target="_blank" rel="noopener noreferrer">Geiger Entropy Oracle</a> — quantum randomness from radioactive decay, verifiable on-chain. No one can predict, rig, or game which Cappy you get.</p>
          </div>
        </div>
      </section>

      {/* Mint Section */}
      <section className="cappy-mint-section" id="mint">
        <h2>Mint Your Cappy</h2>
        <p className="cappy-section-sub">Provide your NFT details · Rarity assigned by Geiger Oracle ☢️</p>
        <div className="cappy-mint-card">
          {/* Left: Preview */}
          <div className="cappy-mint-preview">
            {form.uri && imgOk ? (
              <img src={form.uri} alt="NFT preview" className="cappy-mint-img" />
            ) : (
              <div className="cappy-mint-placeholder">
                <span className="cappy-mint-placeholder-icon">🦫</span>
                <span>Image preview will appear here</span>
              </div>
            )}
          </div>

          {/* Right: Form */}
          <div className="cappy-mint-form">
            <label className="cappy-label">
              Image URI *
              <input type="url" placeholder="https://arweave.net/... or IPFS URI" value={form.uri} onChange={e => onUri(e.target.value)} className="cappy-input" />
            </label>

            <div className="cappy-row">
              <label className="cappy-label cappy-col">
                Name *
                <input type="text" placeholder="Cappy #001" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="cappy-input" />
              </label>
              <label className="cappy-label cappy-col">
                Symbol *
                <input type="text" placeholder="CAPPY" value={form.symbol} onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} className="cappy-input" />
              </label>
            </div>

            <label className="cappy-label">
              Royalty %
              <input type="number" min="0" max="50" step="0.5" value={form.royalty} onChange={e => setForm(f => ({ ...f, royalty: parseFloat(e.target.value) || 0 }))} className="cappy-input" />
            </label>

            {geiger && (
              <div className={`cappy-status ${geiger === 'done' ? 'cappy-status-ok' : 'cappy-status-geiger'}`}>
                {geiger === 'requesting' && '☢️ Requesting Geiger entropy...'}
                {geiger === 'fulfilling' && '⚡ Fulfilling randomness...'}
                {geiger === 'done' && '✅ Entropy captured!'}
              </div>
            )}

            {err && <div className="cappy-status cappy-status-err">❌ {err}</div>}

            {!agreed ? (
              <div className="cappy-disclaimer-banner">
                <p>⚠️ You must accept the disclaimer before minting.</p>
                <button className="cappy-disclaimer-btn" onClick={() => setShowDisclaimer(true)}>Read Disclaimer</button>
              </div>
            ) : (
              <>
                <div className="cappy-wallet-area">
                  {connected ? (
                    <span className="cappy-wallet-connected">✓ Connected: {short(pubkey?.toString())}</span>
                  ) : (
                    <button className="cappy-connect-form" onClick={() => setShowWallets(true)}>Connect Wallet</button>
                  )}
                </div>
                <button
                  className={`cappy-mint-btn ${connected ? 'cappy-mint-btn-ready' : ''}`}
                  onClick={mint}
                  disabled={!connected || minting || !form.name || !form.symbol || !form.uri}
                >
                  {minting ? '☢️ MINTING...' : connected ? '🦫 MINT CAPPY' : 'CONNECT WALLET'}
                </button>
              </>
            )}

            {result && tc && (
              <div className="cappy-result" style={{ borderColor: tc.color, boxShadow: `0 0 40px ${tc.color}33` }}>
                <div className="cappy-result-header">
                  <span className="cappy-result-icon">{tc.icon}</span>
                  <span className="cappy-result-tier" style={{ color: tc.color }}>{tc.label} Cappy Minted!</span>
                </div>
                <div className="cappy-result-meta">
                  <p><span className="cappy-result-label">Mint:</span> <code>{short(result.mint)}</code></p>
                  <p><span className="cappy-result-label">Entropy:</span> <code>{result.entropy}</code></p>
                </div>
                <a href={`https://explorer.x1.xyz/tx/${result.txid}`} target="_blank" rel="noopener noreferrer" className="cappy-result-link" style={{ color: tc.color }}>
                  View on X1 Explorer →
                </a>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="cappy-footer">
        Powered by X1 Network · Geiger Entropy Oracle ☢️ · <a href="https://github.com/echohound-labs/geiger-entropy-oracle" target="_blank" rel="noopener noreferrer">Docs</a>
        <p className="cappy-footer-disclaimer">CAPPY NFTs are digital collectibles, not securities. No financial guarantees. Mint at your own risk.</p>
      </footer>
    </div>
  );
}