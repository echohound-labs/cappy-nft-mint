const metadataCids = require('../../public/metadata-cids.json');

module.exports = async function handler(req, res) {
  const { id } = req.query;
  const num = parseInt(id);
  if (isNaN(num) || num < 1 || num > 500) {
    return res.status(404).json({ error: 'Not found' });
  }
  const cid = metadataCids[String(num)];
  if (!cid) return res.status(404).json({ error: 'CID not found' });
  try {
    const response = await fetch(`https://gateway.lighthouse.storage/ipfs/${cid}`);
    const metadata = await response.json();
    res.setHeader('Cache-Control', 's-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(metadata);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
