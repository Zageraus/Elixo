/** blockchain_transactions.chain values written by the backend. */
const EXPLORERS: Record<string, string> = {
  sepolia: "https://sepolia.etherscan.io/tx/",
};

const LABELS: Record<string, string> = {
  sepolia: "Sepolia",
  "hardhat-local": "Local Hardhat chain",
};

/** Public explorer link, or null for chains without one (e.g. a local node). */
export function explorerTxUrl(chain: string | null | undefined, txHash: string): string | null {
  const base = chain ? EXPLORERS[chain] : undefined;
  return base ? base + txHash : null;
}

export function chainLabel(chain: string | null | undefined): string {
  return (chain && LABELS[chain]) || chain || "blockchain";
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
