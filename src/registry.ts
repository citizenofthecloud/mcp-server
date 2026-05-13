/**
 * Registry client — communicates with the Citizen of the Cloud registry API.
 */

import { CloudIdentity } from "./identity.js";

export interface AgentRecord {
  cloud_id: string;
  name: string;
  status: string;
  trust_score: number;
  autonomy_level: string;
  covenant_signed: boolean;
  public_key: string;
  declared_purpose?: string;
  owner_id?: string;
  created_at?: string;
  last_verified?: string;
  [key: string]: unknown;
}

export interface VerificationResult {
  verified: boolean;
  reason?: string;
  agent?: AgentRecord;
  timestamp?: string;
  latency?: number;
}

export interface ChallengeResult {
  nonce: string;
  expires_in: number;
}

export interface ChallengeResponseResult {
  verified: boolean;
  agent?: AgentRecord;
  error?: string;
}

// In-memory cache for agent lookups
const agentCache = new Map<string, { agent: AgentRecord; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function clearExpired() {
  const now = Date.now();
  for (const [key, entry] of agentCache) {
    if (entry.expires < now) agentCache.delete(key);
  }
}

export class RegistryClient {
  private registryUrl: string;
  private identity?: CloudIdentity;

  constructor(registryUrl: string, identity?: CloudIdentity) {
    this.registryUrl = registryUrl.replace(/\/$/, "");
    this.identity = identity;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.registryUrl}${path}`;

    if (this.identity && options.method && options.method !== "GET") {
      const body = typeof options.body === "string" ? options.body : "";
      const signedHeaders = this.identity.signRequest(url, options.method, body);
      options.headers = { ...options.headers, ...signedHeaders };
    }

    return globalThis.fetch(url, options);
  }

  async lookupAgent(cloudId: string): Promise<AgentRecord | null> {
    clearExpired();

    const cached = agentCache.get(cloudId);
    if (cached && cached.expires > Date.now()) {
      return cached.agent;
    }

    const res = await this.fetch(`/api/verify?cloud_id=${encodeURIComponent(cloudId)}`);
    if (!res.ok) return null;

    const data = await res.json();
    const agent = data.agent ?? data;

    if (agent?.cloud_id) {
      agentCache.set(cloudId, { agent, expires: Date.now() + CACHE_TTL });
    }

    return agent?.cloud_id ? agent : null;
  }

  async requestChallenge(cloudId: string): Promise<ChallengeResult> {
    const res = await this.fetch("/api/verify/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cloud_id: cloudId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Challenge request failed: ${(err as Record<string, string>).error ?? res.statusText}`);
    }

    return res.json() as Promise<ChallengeResult>;
  }

  async respondToChallenge(
    cloudId: string,
    nonce: string,
    signature: string,
  ): Promise<ChallengeResponseResult> {
    const res = await this.fetch("/api/verify/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cloud_id: cloudId, nonce, signature }),
    });

    return res.json() as Promise<ChallengeResponseResult>;
  }

  async verifyAgent(
    cloudId: string,
    timestamp: string,
    signature: string,
    options: {
      requireCovenant?: boolean;
      minimumTrustScore?: number;
      allowedAutonomyLevels?: string[];
      blockedAgents?: string[];
      maxAge?: number;
    } = {},
  ): Promise<VerificationResult> {
    const start = Date.now();
    const {
      requireCovenant = true,
      minimumTrustScore,
      allowedAutonomyLevels,
      blockedAgents = [],
      maxAge = 300,
    } = options;

    // Check blocked
    if (blockedAgents.includes(cloudId)) {
      return { verified: false, reason: "agent_blocked", latency: Date.now() - start };
    }

    // Check timestamp
    let ts: Date;
    try {
      ts = new Date(timestamp);
      if (isNaN(ts.getTime())) throw new Error();
    } catch {
      return { verified: false, reason: "invalid_timestamp", latency: Date.now() - start };
    }

    const age = (Date.now() - ts.getTime()) / 1000;
    if (age > maxAge) {
      return { verified: false, reason: "timestamp_expired", latency: Date.now() - start };
    }
    if (age < -30) {
      return { verified: false, reason: "timestamp_future", latency: Date.now() - start };
    }

    // Lookup agent
    let agent: AgentRecord | null;
    try {
      agent = await this.lookupAgent(cloudId);
    } catch {
      return { verified: false, reason: "registry_unreachable", latency: Date.now() - start };
    }

    if (!agent) {
      return { verified: false, reason: "invalid_cloud_id", latency: Date.now() - start };
    }

    // Status
    if (agent.status !== "active") {
      return { verified: false, reason: "agent_suspended", agent, latency: Date.now() - start };
    }

    // Covenant
    if (requireCovenant && !agent.covenant_signed) {
      return { verified: false, reason: "covenant_unsigned", agent, latency: Date.now() - start };
    }

    // Trust score
    if (minimumTrustScore != null && agent.trust_score < minimumTrustScore) {
      return { verified: false, reason: "trust_score_insufficient", agent, latency: Date.now() - start };
    }

    // Autonomy level
    if (allowedAutonomyLevels && !allowedAutonomyLevels.includes(agent.autonomy_level)) {
      return { verified: false, reason: "autonomy_level_restricted", agent, latency: Date.now() - start };
    }

    // Cryptographic verification
    const { verifySignature } = await import("./identity.js");
    const valid = verifySignature(cloudId, timestamp, signature, agent.public_key);
    if (!valid) {
      return { verified: false, reason: "invalid_signature", agent, latency: Date.now() - start };
    }

    // Log verification (fire-and-forget). Uses "success" to match the
    // /api/verify/log validResults whitelist — passing "verified" silently
    // got rejected with 400 for a long time and the catch swallowed it.
    this.logVerification(cloudId, "success", Date.now() - start).catch(() => {});

    return { verified: true, agent, timestamp, latency: Date.now() - start };
  }

  async logVerification(cloudId: string, result: string, latencyMs: number): Promise<void> {
    await this.fetch("/api/verify/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cloud_id: cloudId,
        result,
        latency: latencyMs,
        verifier_id: this.identity?.cloudId ?? "mcp-server",
      }),
    }).catch(() => {});
  }

  async listDirectory(): Promise<AgentRecord[]> {
    const res = await this.fetch("/api/directory");
    if (!res.ok) throw new Error(`Directory request failed: ${res.statusText}`);
    const data = await res.json();
    return (data as { agents?: AgentRecord[] }).agents ?? (data as AgentRecord[]);
  }

  async reportAgent(
    token: string,
    cloudId: string,
    reportType: string,
    evidence: string,
  ): Promise<{ success: boolean; error?: string }> {
    const res = await globalThis.fetch(`${this.registryUrl}/api/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        cloud_id: cloudId,
        report_type: reportType,
        evidence,
      }),
    });
    return res.json() as Promise<{ success: boolean; error?: string }>;
  }

  async getGovernanceFeed(): Promise<unknown[]> {
    const res = await this.fetch("/api/governance/feed");
    if (!res.ok) throw new Error(`Governance feed request failed: ${res.statusText}`);
    const data = await res.json();
    return (data as { feed?: unknown[] }).feed ?? (data as unknown[]);
  }

  async registerAgent(
    token: string,
    agentData: {
      name: string;
      declared_purpose: string;
      autonomy_level: string;
      public_key: string;
      covenant_signed: boolean;
    },
  ): Promise<{ cloud_id: string; [key: string]: unknown }> {
    const res = await globalThis.fetch(`${this.registryUrl}/api/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(agentData),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Registration failed: ${(err as Record<string, string>).error ?? res.statusText}`);
    }

    return res.json() as Promise<{ cloud_id: string }>;
  }

  clearCache() {
    agentCache.clear();
  }
}
