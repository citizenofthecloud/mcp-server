/**
 * Cloud Identity — Ed25519 signing and verification using Node.js crypto.
 * Mirrors the signing protocol from @citizenofthecloud/sdk.
 */

import crypto from "node:crypto";

const HEADER_CLOUD_ID = "X-Cloud-ID";
const HEADER_TIMESTAMP = "X-Cloud-Timestamp";
const HEADER_SIGNATURE = "X-Cloud-Signature";
const HEADER_REQUEST_BOUND = "X-Cloud-Request-Bound";

export interface SignedHeaders {
  "X-Cloud-ID": string;
  "X-Cloud-Timestamp": string;
  "X-Cloud-Signature": string;
  "X-Cloud-Request-Bound"?: string;
}

export interface CloudIdentityConfig {
  cloudId: string;
  privateKey: string;
  registryUrl?: string;
}

export class CloudIdentity {
  readonly cloudId: string;
  readonly registryUrl: string;
  private privateKeyObject: crypto.KeyObject;

  constructor(config: CloudIdentityConfig) {
    if (!config.cloudId) throw new Error("cloudId is required");
    if (!config.privateKey) throw new Error("privateKey is required");

    this.cloudId = config.cloudId;
    this.registryUrl = config.registryUrl ?? "https://www.citizenofthecloud.com";

    this.privateKeyObject = crypto.createPrivateKey({
      key: config.privateKey,
      format: "pem",
      type: "pkcs8",
    });
  }

  sign(): SignedHeaders {
    const timestamp = new Date().toISOString();
    const payload = `${this.cloudId}:${timestamp}`;
    const signature = crypto.sign(null, Buffer.from(payload), this.privateKeyObject);
    const encoded = signature
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return {
      [HEADER_CLOUD_ID]: this.cloudId,
      [HEADER_TIMESTAMP]: timestamp,
      [HEADER_SIGNATURE]: encoded,
    };
  }

  signRequest(url: string, method: string, body = ""): SignedHeaders {
    const timestamp = new Date().toISOString();
    const bodyHash = crypto
      .createHash("sha256")
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const payload = `${this.cloudId}:${timestamp}:${method.toUpperCase()}:${url}:${bodyHash}`;
    const signature = crypto.sign(null, Buffer.from(payload), this.privateKeyObject);
    const encoded = signature
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    return {
      [HEADER_CLOUD_ID]: this.cloudId,
      [HEADER_TIMESTAMP]: timestamp,
      [HEADER_SIGNATURE]: encoded,
      [HEADER_REQUEST_BOUND]: "true",
    };
  }
}

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

export function verifySignature(
  cloudId: string,
  timestamp: string,
  signatureB64url: string,
  publicKeyPem: string,
): boolean {
  try {
    const sig = signatureB64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = sig + "=".repeat((4 - (sig.length % 4)) % 4);
    const sigBuffer = Buffer.from(padded, "base64");

    const payload = `${cloudId}:${timestamp}`;
    const pubKey = crypto.createPublicKey({ key: publicKeyPem, format: "pem", type: "spki" });

    return crypto.verify(null, Buffer.from(payload), pubKey, sigBuffer);
  } catch {
    return false;
  }
}
