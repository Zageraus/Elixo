import { Contract, JsonRpcProvider, Wallet, id } from "ethers";
import { createHash } from "crypto";
import { supabaseAdmin } from "../config/supabase.js";

const ABI = [
  "function anchorRecord(bytes32 recordId, bytes32 dataHash, string recordType) external",
  "function verifyRecord(bytes32 recordId, bytes32 dataHash) external view returns (bool)",
  "function getRecord(bytes32 recordId) external view returns (tuple(bytes32 dataHash, address submittedBy, uint256 timestamp, string recordType))",
  "event RecordAnchored(bytes32 indexed recordId, bytes32 dataHash, string recordType, uint256 timestamp)",
];

/** Stored in blockchain_transactions.chain; the frontend maps it to an explorer. */
const CHAIN_NAMES: Record<string, string> = {
  "31337": "hardhat-local",
  "11155111": "sepolia",
};

function getContract() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.AUDIT_SIGNER_PRIVATE_KEY;
  const contractAddress = process.env.AUDIT_CONTRACT_ADDRESS;

  if (!rpcUrl) {
    throw new Error("Missing SEPOLIA_RPC_URL environment variable");
  }

  if (!privateKey) {
    throw new Error("Missing AUDIT_SIGNER_PRIVATE_KEY environment variable");
  }

  if (!contractAddress) {
    throw new Error("Missing AUDIT_CONTRACT_ADDRESS environment variable");
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(privateKey, provider);

  return { provider, contractAddress, contract: new Contract(contractAddress, ABI, signer) };
}

/**
 * Connects to the chain and checks the contract is deployed there. A local
 * Hardhat chain starts empty after every restart, so a stale address is a
 * common, explainable failure.
 */
async function connect() {
  const { provider, contractAddress, contract } = getContract();
  let chainId: bigint;
  try {
    chainId = (await provider.getNetwork()).chainId;
  } catch {
    throw new Error("Can't reach the blockchain node. Is the chain running?");
  }
  if ((await provider.getCode(contractAddress)) === "0x") {
    throw new Error(
      "The audit contract isn't deployed on the current chain. If you restarted the local chain, run `npm --prefix contracts run setup:local` and restart the backend."
    );
  }
  const chain = CHAIN_NAMES[chainId.toString()] ?? `chain-${chainId}`;
  return { contract, chain };
}

/**
 * Calculate the SHA-256 hash of a file buffer.
 * The hash can be stored with the off-chain medical report.
 */
export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Hash of a prescription's medications with a fixed key order, so the same
 * prescription always hashes the same way when it's anchored and when it's
 * verified later from the database (jsonb doesn't keep key order).
 */
export function hashPrescription(
  medications: { name: string; dosage: string; frequency: string; duration_days: number }[]
): string {
  const canonical = medications.map((m) => [m.name, m.dosage, m.frequency, m.duration_days]);
  return sha256Hex(Buffer.from(JSON.stringify(canonical)));
}

/**
 * Anchor a medical report or prescription hash on-chain.
 *
 * The document itself is not stored on-chain. Earlier unconfirmed attempts
 * for the same record are replaced, so retries don't pile up.
 */
export async function anchorHashOnChain(params: {
  recordId: string;
  fileHashHex: string;
  recordType: "report" | "prescription";
}) {
  const { recordId, fileHashHex, recordType } = params;

  // Validate the hash before interacting with the database or blockchain.
  if (!/^[0-9a-fA-F]{64}$/.test(fileHashHex)) {
    throw new Error("Invalid file hash: expected a 64-character SHA-256 hex digest");
  }

  const { contract, chain } = await connect();

  const targetColumn =
    recordType === "report" ? "report_id" : "prescription_id";

  await supabaseAdmin
    .from("blockchain_transactions")
    .delete()
    .eq(targetColumn, recordId)
    .neq("status", "confirmed");

  const { data: txRow, error: insertErr } = await supabaseAdmin
    .from("blockchain_transactions")
    .insert({
      [targetColumn]: recordId,
      chain,
      tx_hash: `pending-${recordId}-${Date.now()}`,
      data_hash: fileHashHex,
      status: "pending",
    })
    .select()
    .single();

  if (insertErr) {
    throw insertErr;
  }

  try {
    // Convert the UUID string to a deterministic bytes32 identifier.
    const recordIdBytes32 = id(recordId);
    const dataHashBytes32 = `0x${fileHashHex}`;

    const tx = await contract.anchorRecord(
      recordIdBytes32,
      dataHashBytes32,
      recordType
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("Blockchain transaction was not confirmed successfully");
    }

    const { error: updateErr } = await supabaseAdmin
      .from("blockchain_transactions")
      .update({
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
        status: "confirmed",
        gas_used: receipt.gasUsed?.toString(),
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", txRow.id);

    if (updateErr) {
      throw updateErr;
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      chain,
    };
  } catch (err) {
    // Preserve the existing failed-transaction status update.
    await supabaseAdmin
      .from("blockchain_transactions")
      .update({ status: "failed" })
      .eq("id", txRow.id);

    throw err;
  }
}

export type OnChainCheck =
  | { status: "verified"; anchoredAt: string }
  | { status: "mismatch"; anchoredAt: string }
  | { status: "not_anchored" };

/**
 * Compare a hash with what the contract holds for this record:
 * verified (same hash), mismatch (different hash: the document changed),
 * or not_anchored (the chain has no record for it).
 */
export async function verifyOnChain(recordId: string, fileHashHex: string): Promise<OnChainCheck> {
  if (!/^[0-9a-fA-F]{64}$/.test(fileHashHex)) {
    throw new Error("Invalid file hash: expected a 64-character SHA-256 hex digest");
  }

  const { contract } = await connect();
  const record = await contract.getRecord(id(recordId));
  if (record.timestamp === 0n) return { status: "not_anchored" };

  const anchoredAt = new Date(Number(record.timestamp) * 1000).toISOString();
  return record.dataHash.toLowerCase() === `0x${fileHashHex.toLowerCase()}`
    ? { status: "verified", anchoredAt }
    : { status: "mismatch", anchoredAt };
}

/** verifyOnChain for API responses: never throws, reports why a check couldn't run. */
export async function checkOnChain(
  recordId: string,
  fileHashHex: string
): Promise<OnChainCheck | { status: "disabled" } | { status: "unavailable"; error: string }> {
  if (process.env.BLOCKCHAIN_ENABLED !== "true") return { status: "disabled" };
  try {
    return await verifyOnChain(recordId, fileHashHex);
  } catch (e: any) {
    return { status: "unavailable", error: e?.message ?? "Blockchain check failed." };
  }
}
