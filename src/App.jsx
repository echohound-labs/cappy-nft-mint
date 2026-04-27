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

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt918CN2');

function shortenAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function explorerLink(sig) {
  return `https://explorer.x1.xyz/tx/${sig}`;
}

const WALLETS = [
  { key: 'phantom', name: 'Phantom', icon: '👻', check: () => window.phantom?.solana },
  { key: 'backpack', name: 'Backpack', icon: '🎒', check: () => window.backpack?.solana },
  { key: 'solflare', name: 'Solflare', icon: '🔥', check: () => window.solflare },
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
    royaltyPercent: 0,
  });
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const connection = new Connection(
    import.meta.env.VITE_RPC_URL || 'https://rpc.mainnet.x1.xyz',
    'confirmed'
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

  const handleMint = async () => {
    if (!connected) {
      setError('Connect your wallet first');
      return;
    }
    if (!formData.name || !formData.symbol || !formData.uri) {
      setError('Name, symbol, and metadata URI are required');
      return;
    }

    setMinting(true);
    setError(null);
    setResult(null);

    try {
      // Generate mint keypair
      const mintKeypair = await crypto.subtle.generateKey(
        { name: 'Ed25519', namedCurve: 'Ed25519' },
        true,
        ['sign']
      );

      // Use @metaplex-foundation approach
      const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
      const { createSignerFromKeypair, signerIdentity } = await import('@metaplex-foundation/umi');
      const { mplTokenMetadata } = await import('@metaplex-foundation/mpl-token-metadata');

      const umi = createUmi(connection.rpcEndpoint);
      umi.use(mplTokenMetadata());

      // Simple direct mint via web3.js
      const mintKeypairWeb3 = await (async () => {
        const { Keypair } = await import('@solana/web3.js');
        return Keypair.generate();
      })();

      const mintPubkey = mintKeypairWeb3.publicKey;
      const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const associatedTokenAddress = getAssociatedTokenAddressSync(mintPubkey, publicKey);

      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );

      // Build transaction instructions
      const { createCreateMetadataAccountV3Instruction } = await import('@metaplex-foundation/mpl-token-metadata');

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

      // Initialize mint
      transaction.add(
        createInitializeMintInstruction(
          mintPubkey,
          0,
          publicKey,
          publicKey,
          TOKEN_PROGRAM_ID
        )
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

      // Create metadata
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
                name: formData.name,
                symbol: formData.symbol,
                uri: formData.uri,
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

      // Sign with mint keypair
      transaction.partialSign(mintKeypairWeb3);

      // Sign with wallet
      const signed = await provider.signTransaction(transaction);
      const txid = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(txid, 'confirmed');

      setResult({
        mintAddress: mintPubkey.toString(),
        txid,
      });
    } catch (err) {
      console.error('Mint error:', err);
      setError(err.message || 'Mint failed. Check console for details.');
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      {/* Header */}
      <header className="w-full max-w-2xl mb-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-4xl animate-float">🧢</div>
            <div>
              <h1 className="font-orbitron text-3xl font-black tracking-wider"
                  style={{ background: 'linear-gradient(135deg, #00e5ff, #ff6b35)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                CAPPY
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>NFT Mint</p>
            </div>
          </div>

          <div>
            {connected ? (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border transition-all hover:bg-white/5"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              >
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--success)' }}></span>
                <span className="font-mono text-sm">{shortenAddress(publicKey?.toString())}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>✕</span>
              </button>
            ) : (
              <button
                onClick={() => setShowWalletModal(true)}
                className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all animate-glow"
                style={{ background: 'linear-gradient(135deg, #00e5ff, #0088cc)', color: '#000' }}
              >
                CONNECT WALLET
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Wallet Modal */}
      {showWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
             onClick={() => setShowWalletModal(false)}>
          <div className="rounded-2xl p-6 w-80 animate-fade-in"
               style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
               onClick={e => e.stopPropagation()}>
            <h3 className="font-orbitron text-lg font-bold mb-4" style={{ color: 'var(--accent)' }}>Connect Wallet</h3>
            <div className="space-y-3">
              {WALLETS.map(w => (
                <button
                  key={w.key}
                  onClick={() => handleConnect(w.key)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:scale-102"
                  style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                >
                  <span className="text-2xl">{w.icon}</span>
                  <span className="font-semibold">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mint Card */}
      <div className="w-full max-w-2xl rounded-2xl p-8 animate-fade-in"
           style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

        {/* NFT Preview */}
        <div className="mb-8 rounded-xl overflow-hidden"
             style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          {formData.uri ? (
            <img src={formData.uri} alt="NFT Preview" className="w-full h-64 object-cover"
                 onError={e => { e.target.onerror = null; e.target.src = ''; e.target.style.display = 'none'; }} />
          ) : (
            <div className="w-full h-64 flex flex-col items-center justify-center" style={{ color: 'var(--text-secondary)' }}>
              <span className="text-6xl mb-3">🧢</span>
              <span className="font-orbitron text-sm">YOUR NFT PREVIEW</span>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--accent)' }}>Name *</label>
            <input
              type="text"
              placeholder="e.g. CAPPY #001"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all focus:ring-2"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--accent)' }}>Symbol *</label>
            <input
              type="text"
              placeholder="e.g. CAPPY"
              value={formData.symbol}
              onChange={e => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all focus:ring-2"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--accent)' }}>Metadata URI *</label>
            <input
              type="url"
              placeholder="https://... (JSON metadata or image)"
              value={formData.uri}
              onChange={e => setFormData({ ...formData, uri: e.target.value })}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all focus:ring-2"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: 'var(--accent)' }}>Royalty %</label>
            <input
              type="number"
              min="0" max="50" step="0.5"
              value={formData.royaltyPercent}
              onChange={e => setFormData({ ...formData, royaltyPercent: parseFloat(e.target.value) || 0 })}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all focus:ring-2"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Mint Button */}
        <button
          onClick={handleMint}
          disabled={!connected || minting}
          className="w-full mt-8 py-4 rounded-xl font-orbitron font-bold text-lg tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: connected && !minting ? 'linear-gradient(135deg, #00e5ff, #ff6b35)' : 'var(--bg-secondary)',
            color: connected && !minting ? '#000' : 'var(--text-secondary)',
            border: connected ? 'none' : '1px solid var(--border)'
          }}
        >
          {minting ? 'MINTING...' : connected ? '🧢 MINT CAPPY NFT' : 'CONNECT WALLET TO MINT'}
        </button>

        {/* Status Messages */}
        {error && (
          <div className="mt-4 p-4 rounded-xl text-sm" style={{ background: 'rgba(255,68,102,0.1)', border: '1px solid var(--error)', color: 'var(--error)' }}>
            ❌ {error}
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 rounded-xl text-sm space-y-2" style={{ background: 'rgba(0,255,136,0.1)', border: '1px solid var(--success)', color: 'var(--success)' }}>
            <div>✅ <strong>NFT Minted!</strong></div>
            <div className="font-mono text-xs break-all">
              Mint: {result.mintAddress}
            </div>
            <a
              href={explorerLink(result.txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 px-3 py-1 rounded-lg text-xs font-bold"
              style={{ background: 'var(--accent)', color: '#000' }}
            >
              View on Explorer →
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-12 text-center" style={{ color: 'var(--text-secondary)' }}>
        <p className="text-xs">CAPPY NFT Mint • Powered by X1 Network</p>
      </footer>
    </div>
  );
}