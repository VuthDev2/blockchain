import { ethers } from "ethers";
import { env } from "../config/env.js";

/**
 * Blockchain layer (CertificateRegistry contract).
 *
 * Hashing is real SHA-256 over a canonical certificate payload, always. When a
 * deployed contract is configured (RPC + private key + address) every issue
 * and revocation is written to it as a real transaction; the public
 * verification flow can also re-read the record from the chain. Without those
 * env vars (local development), a deterministic simulation takes over so the
 * whole flow still works without a wallet or RPC endpoint.
 *
 * The contract source lives in blockchain/contracts/CertificateRegistry.sol.
 */

export function isBlockchainConfigured(): boolean {
  return Boolean(
    env.BLOCKCHAIN_RPC_URL && env.BLOCKCHAIN_PRIVATE_KEY && env.BLOCKCHAIN_CONTRACT_ADDRESS,
  );
}

export const BLOCKCHAIN_NETWORK = isBlockchainConfigured()
  ? env.BLOCKCHAIN_NETWORK_NAME
  : "Ethereum Sepolia (simulated)";

/** Minimal ABI of the deployed CertificateRegistry — enough for issue/revoke/read. */
const CERTIFICATE_REGISTRY_ABI = [
  {
    inputs: [
      { name: "certificateId", type: "string" },
      { name: "certificateHash", type: "bytes32" },
      { name: "expiresAt", type: "uint256" },
    ],
    name: "issueCertificate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "certificateId", type: "string" },
      { name: "reason", type: "string" },
    ],
    name: "revokeCertificate",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "certificateId", type: "string" }],
    name: "getCertificate",
    outputs: [
      { name: "certificateHash", type: "bytes32" },
      { name: "issuedAt", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "issuer", type: "address" },
      { name: "revoked", type: "bool" },
      { name: "revocationReason", type: "string" },
      { name: "revokedBy", type: "address" },
      { name: "revokedAt", type: "uint256" },
      { name: "exists", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

let provider: ethers.JsonRpcProvider | null = null;
let contractPromise: Promise<ethers.Contract> | null = null;
let signerAddressPromise: Promise<string> | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    if (!env.BLOCKCHAIN_RPC_URL) {
      throw new Error("Blockchain is not configured (BLOCKCHAIN_RPC_URL).");
    }
    provider = new ethers.JsonRpcProvider(env.BLOCKCHAIN_RPC_URL);
  }
  return provider;
}

function getSigner(): ethers.Wallet {
  if (!env.BLOCKCHAIN_PRIVATE_KEY) {
    throw new Error("Blockchain is not configured (BLOCKCHAIN_PRIVATE_KEY).");
  }
  return new ethers.Wallet(env.BLOCKCHAIN_PRIVATE_KEY, getProvider());
}

function getContract(): Promise<ethers.Contract> {
  if (!contractPromise) {
    if (!env.BLOCKCHAIN_CONTRACT_ADDRESS) {
      throw new Error("Blockchain is not configured (BLOCKCHAIN_CONTRACT_ADDRESS).");
    }
    contractPromise = Promise.resolve(
      new ethers.Contract(env.BLOCKCHAIN_CONTRACT_ADDRESS, CERTIFICATE_REGISTRY_ABI, getSigner()),
    );
  }
  return contractPromise;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface CanonicalCertificate {
  certificateId: string;
  recipientName: string;
  certificateTitle: string;
  course: string;
  issueDate: string;
  expirationDate: string | null;
}

/** FR-05 — canonical representation hashed into the certificate fingerprint. */
export function canonicalPayload(cert: CanonicalCertificate): string {
  return [
    cert.certificateId,
    cert.recipientName.trim(),
    cert.certificateTitle.trim(),
    cert.course.trim(),
    cert.issueDate,
    cert.expirationDate ?? "none",
  ].join("|");
}

export function certificateHash(cert: CanonicalCertificate): Promise<string> {
  return sha256Hex(canonicalPayload(cert));
}

/** Wallet/derived address that signs issuance transactions for a user. */
export async function issuerAddress(userId: string): Promise<string> {
  if (isBlockchainConfigured()) {
    if (!signerAddressPromise) signerAddressPromise = getSigner().getAddress();
    return signerAddressPromise;
  }
  // Simulated fallback — deterministic per user.
  const digest = await sha256Hex(`issuer:${userId}`);
  return `0x${digest.slice(0, 40)}`;
}

export interface ChainReceipt {
  transactionHash: string;
  blockNumber: number;
  issuerAddress: string;
  network: string;
}

/** FR-06 — issueCertificate() on the registry contract (or simulated). */
export async function submitIssueTransaction(params: {
  certificateId: string;
  hash: string;
  issuer: string;
  /** Unix seconds; 0 = never expires. Mirrors the contract's expiresAt. */
  expiresAt: number;
}): Promise<ChainReceipt> {
  if (isBlockchainConfigured()) {
    const contract = await getContract();
    const tx = await contract.issueCertificate(
      params.certificateId,
      ethers.getBytes(`0x${params.hash}`),
      params.expiresAt,
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction was dropped; no receipt returned.");
    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      issuerAddress: params.issuer,
      network: BLOCKCHAIN_NETWORK,
    };
  }

  const digest = await sha256Hex(`issue:${params.certificateId}:${params.hash}:${params.issuer}`);
  return {
    transactionHash: `0x${digest}`.slice(0, 66),
    blockNumber: 6_500_000 + (parseInt(digest.slice(0, 6), 16) % 250_000),
    issuerAddress: params.issuer,
    network: BLOCKCHAIN_NETWORK,
  };
}

/** FR-15 — revokeCertificate() on the registry contract (or simulated). */
export async function submitRevokeTransaction(params: {
  certificateId: string;
  reason: string;
  issuer: string;
}): Promise<{ transactionHash: string }> {
  if (isBlockchainConfigured()) {
    const contract = await getContract();
    const tx = await contract.revokeCertificate(params.certificateId, params.reason);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction was dropped; no receipt returned.");
    return { transactionHash: receipt.hash };
  }

  const digest = await sha256Hex(
    `revoke:${params.certificateId}:${params.reason}:${params.issuer}:${Date.now()}`,
  );
  return { transactionHash: `0x${digest}`.slice(0, 66) };
}

export interface OnChainRecord {
  exists: boolean;
  certificateHash: string | null;
  issuedAt: number | null;
  expiresAt: number | null;
  issuer: string | null;
  revoked: boolean;
  revocationReason: string | null;
}

/**
 * Read a certificate straight from the deployed contract. Used by the public
 * verification flow so the result reflects the chain, not just the database.
 * Fail-soft: returns null when blockchain isn't configured or the RPC errors.
 */
export async function getOnChainRecord(certificateId: string): Promise<OnChainRecord | null> {
  if (!isBlockchainConfigured()) return null;
  try {
    const contract = await getContract();
    const record = await contract.getCertificate(certificateId);
    if (!record.exists) {
      return {
        exists: false,
        certificateHash: null,
        issuedAt: null,
        expiresAt: null,
        issuer: null,
        revoked: false,
        revocationReason: null,
      };
    }
    return {
      exists: true,
      certificateHash: String(record.certificateHash),
      issuedAt: Number(record.issuedAt),
      expiresAt: Number(record.expiresAt),
      issuer: String(record.issuer),
      revoked: Boolean(record.revoked),
      revocationReason: String(record.revocationReason),
    };
  } catch (error) {
    console.error(
      "[blockchain] On-chain record lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export function explorerUrl(transactionHash: string | null | undefined): string | null {
  if (!transactionHash) return null;
  return `https://sepolia.etherscan.io/tx/${transactionHash}`;
}
