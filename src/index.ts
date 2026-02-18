#!/usr/bin/env node

/**
 * Citizen of the Cloud — MCP Server
 *
 * Provides agent identity verification, trust scoring, and registry access
 * as MCP tools and resources for AI frameworks (CrewAI, LangChain, Agent Framework, etc.).
 *
 * Environment variables:
 *   CLOUD_ID          — This server's Cloud ID (cc-...)
 *   CLOUD_PRIVATE_KEY — Ed25519 private key in PEM format
 *   REGISTRY_URL      — Registry URL (default: https://www.citizenofthecloud.com)
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import { CloudIdentity, generateKeyPair } from "./identity.js";
import { RegistryClient } from "./registry.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REGISTRY_URL = process.env.REGISTRY_URL ?? "https://www.citizenofthecloud.com";
const CLOUD_ID = process.env.CLOUD_ID;
const CLOUD_PRIVATE_KEY = process.env.CLOUD_PRIVATE_KEY;

let identity: CloudIdentity | undefined;
if (CLOUD_ID && CLOUD_PRIVATE_KEY) {
  try {
    identity = new CloudIdentity({
      cloudId: CLOUD_ID,
      privateKey: CLOUD_PRIVATE_KEY,
      registryUrl: REGISTRY_URL,
    });
  } catch (err) {
    console.error(`[cotc-mcp] Failed to initialize identity: ${err}`);
  }
}

const registry = new RegistryClient(REGISTRY_URL, identity);

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "citizen-of-the-cloud",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

// 1. verify-agent — Full verification of an agent's signed headers
server.tool(
  "verify-agent",
  "Verify an agent's identity using their Cloud ID, timestamp, and Ed25519 signature. " +
    "Performs registry lookup, status checks, trust score validation, covenant verification, " +
    "and cryptographic signature verification.",
  {
    cloud_id: z.string().describe("The agent's Cloud ID (cc-...)"),
    timestamp: z.string().describe("ISO 8601 timestamp from X-Cloud-Timestamp header"),
    signature: z.string().describe("Base64url-encoded Ed25519 signature from X-Cloud-Signature header"),
    require_covenant: z.boolean().optional().describe("Require covenant to be signed (default: true)"),
    minimum_trust_score: z.number().optional().describe("Minimum trust score required (0.0-1.0)"),
    allowed_autonomy_levels: z
      .array(z.string())
      .optional()
      .describe("Restrict to these autonomy levels"),
    blocked_agents: z.array(z.string()).optional().describe("Cloud IDs to block"),
    max_age: z.number().optional().describe("Max signature age in seconds (default: 300)"),
  },
  async ({
    cloud_id,
    timestamp,
    signature,
    require_covenant,
    minimum_trust_score,
    allowed_autonomy_levels,
    blocked_agents,
    max_age,
  }) => {
    try {
      const result = await registry.verifyAgent(cloud_id, timestamp, signature, {
        requireCovenant: require_covenant,
        minimumTrustScore: minimum_trust_score,
        allowedAutonomyLevels: allowed_autonomy_levels,
        blockedAgents: blocked_agents,
        maxAge: max_age,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Verification error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 2. lookup-agent — Look up an agent's public profile from the registry
server.tool(
  "lookup-agent",
  "Look up an agent's public profile from the Citizen of the Cloud registry. " +
    "Returns the agent's name, status, trust score, autonomy level, covenant status, and more.",
  {
    cloud_id: z.string().describe("The agent's Cloud ID (cc-...)"),
  },
  async ({ cloud_id }) => {
    try {
      const agent = await registry.lookupAgent(cloud_id);
      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent not found: ${cloud_id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(agent, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Lookup error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 3. check-trust — Quick trust score check for an agent
server.tool(
  "check-trust",
  "Check an agent's trust score and whether it meets a given threshold. " +
    "Returns the trust score, pass/fail status, and agent metadata.",
  {
    cloud_id: z.string().describe("The agent's Cloud ID (cc-...)"),
    minimum_score: z
      .number()
      .optional()
      .describe("Minimum trust score threshold (0.0-1.0). If omitted, just returns the score."),
  },
  async ({ cloud_id, minimum_score }) => {
    try {
      const agent = await registry.lookupAgent(cloud_id);
      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent not found: ${cloud_id}` }],
          isError: true,
        };
      }

      const passes = minimum_score == null || agent.trust_score >= minimum_score;
      const result = {
        cloud_id: agent.cloud_id,
        name: agent.name,
        trust_score: agent.trust_score,
        threshold: minimum_score ?? null,
        passes,
        status: agent.status,
        covenant_signed: agent.covenant_signed,
        autonomy_level: agent.autonomy_level,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Trust check error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 4. request-challenge — Initiate challenge-response verification
server.tool(
  "request-challenge",
  "Request a cryptographic challenge (nonce) from the registry for a given agent. " +
    "The agent must sign this nonce and submit via respond-to-challenge within 60 seconds.",
  {
    cloud_id: z.string().describe("The agent's Cloud ID (cc-...)"),
  },
  async ({ cloud_id }) => {
    try {
      const result = await registry.requestChallenge(cloud_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Challenge error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 5. respond-to-challenge — Complete challenge-response verification
server.tool(
  "respond-to-challenge",
  "Submit a signed challenge response to the registry. The nonce must have been obtained " +
    "via request-challenge and signed with the agent's Ed25519 private key.",
  {
    cloud_id: z.string().describe("The agent's Cloud ID (cc-...)"),
    nonce: z.string().describe("The nonce from request-challenge"),
    signature: z.string().describe("Base64-encoded Ed25519 signature of the nonce"),
  },
  async ({ cloud_id, nonce, signature }) => {
    try {
      const result = await registry.respondToChallenge(cloud_id, nonce, signature);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Challenge response error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 6. sign-challenge — Sign a challenge nonce using this server's identity
server.tool(
  "sign-challenge",
  "Sign a challenge nonce using this MCP server's own Cloud Identity. " +
    "Requires CLOUD_ID and CLOUD_PRIVATE_KEY to be configured.",
  {
    nonce: z.string().describe("The nonce to sign (from request-challenge)"),
  },
  async ({ nonce }) => {
    if (!identity) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Server identity not configured. Set CLOUD_ID and CLOUD_PRIVATE_KEY environment variables.",
          },
        ],
        isError: true,
      };
    }

    try {
      const privateKey = crypto.createPrivateKey({
        key: process.env.CLOUD_PRIVATE_KEY!,
        format: "pem",
        type: "pkcs8",
      });
      const sig = crypto.sign(null, Buffer.from(nonce), privateKey);
      const encoded = sig.toString("base64");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                cloud_id: identity.cloudId,
                nonce,
                signature: encoded,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Signing error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 7. sign-headers — Generate signed headers for outbound requests
server.tool(
  "sign-headers",
  "Generate signed Cloud Identity headers for outbound HTTP requests using this server's identity. " +
    "Use 'simple' mode for basic signing or provide url/method/body for request-bound signing.",
  {
    mode: z
      .enum(["simple", "request-bound"])
      .optional()
      .describe("Signing mode (default: simple)"),
    url: z.string().optional().describe("Target URL (required for request-bound mode)"),
    method: z.string().optional().describe("HTTP method (required for request-bound mode)"),
    body: z.string().optional().describe("Request body (for request-bound mode)"),
  },
  async ({ mode, url, method, body }) => {
    if (!identity) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Server identity not configured. Set CLOUD_ID and CLOUD_PRIVATE_KEY environment variables.",
          },
        ],
        isError: true,
      };
    }

    try {
      let headers;
      if (mode === "request-bound") {
        if (!url || !method) {
          return {
            content: [
              {
                type: "text" as const,
                text: "url and method are required for request-bound signing.",
              },
            ],
            isError: true,
          };
        }
        headers = identity.signRequest(url, method, body ?? "");
      } else {
        headers = identity.sign();
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(headers, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Signing error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 8. register-agent — Register a new agent in the registry
server.tool(
  "register-agent",
  "Register a new agent in the Citizen of the Cloud registry. " +
    "Requires a Supabase auth token. Generates an Ed25519 key pair if no public key is provided.",
  {
    auth_token: z.string().describe("Supabase Bearer token for authentication"),
    name: z.string().describe("Agent name (must be unique per owner)"),
    declared_purpose: z.string().describe("What this agent does"),
    autonomy_level: z
      .enum(["tool", "assistant", "agent", "self-directing"])
      .describe("Agent autonomy level"),
    public_key: z
      .string()
      .optional()
      .describe("Ed25519 public key in PEM format. If omitted, a new key pair is generated."),
    covenant_signed: z
      .boolean()
      .optional()
      .describe("Whether the agent agrees to the covenant (default: true)"),
  },
  async ({ auth_token, name, declared_purpose, autonomy_level, public_key, covenant_signed }) => {
    try {
      let keys: { publicKey: string; privateKey: string } | undefined;
      let pubKey = public_key;

      if (!pubKey) {
        keys = generateKeyPair();
        pubKey = keys.publicKey;
      }

      const result = await registry.registerAgent(auth_token, {
        name,
        declared_purpose,
        autonomy_level,
        public_key: pubKey,
        covenant_signed: covenant_signed ?? true,
      });

      const response: Record<string, unknown> = { ...result };
      if (keys) {
        response.generated_keys = {
          public_key: keys.publicKey,
          private_key: keys.privateKey,
          note: "Store the private key securely. It cannot be retrieved later.",
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Registration error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 9. list-directory — Browse the public agent directory
server.tool(
  "list-directory",
  "List all agents in the Citizen of the Cloud public directory. " +
    "Returns agent names, Cloud IDs, trust scores, status, and autonomy levels.",
  {},
  async () => {
    try {
      const agents = await registry.listDirectory();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Directory error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 10. report-agent — Report an agent for policy violations
server.tool(
  "report-agent",
  "Report an agent to the Citizen of the Cloud registry for policy violations or malicious behavior. " +
    "Reports affect the agent's trust score based on the reporter's own trust score.",
  {
    cloud_id: z.string().describe("Cloud ID of the agent to report (cc-...)"),
    reason: z
      .enum(["spam", "abuse", "impersonation", "malicious", "covenant_violation", "other"])
      .describe("Category of the report"),
    details: z.string().optional().describe("Additional details about the report"),
  },
  async ({ cloud_id, reason, details }) => {
    try {
      const result = await registry.reportAgent(cloud_id, reason, details);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Report error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 11. governance-feed — Get the governance activity feed
server.tool(
  "governance-feed",
  "Retrieve the latest governance activity feed from the Citizen of the Cloud registry. " +
    "Shows recent governance decisions, proposals, and community actions.",
  {},
  async () => {
    try {
      const feed = await registry.getGovernanceFeed();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(feed, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Governance feed error: ${err}` }],
        isError: true,
      };
    }
  },
);

// 12. generate-keypair — Generate a new Ed25519 key pair
server.tool(
  "generate-keypair",
  "Generate a new Ed25519 key pair for agent identity. " +
    "Returns PEM-encoded public and private keys ready for registration.",
  {},
  async () => {
    const keys = generateKeyPair();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              public_key: keys.publicKey,
              private_key: keys.privateKey,
              note: "Store the private key securely. Use the public key when registering an agent.",
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// 13. get-server-identity — Get this server's Cloud Identity info
server.tool(
  "get-server-identity",
  "Get this MCP server's own Cloud Identity information, including its Cloud ID and passport from the registry.",
  {},
  async () => {
    if (!identity) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              configured: false,
              message:
                "Server identity not configured. Set CLOUD_ID and CLOUD_PRIVATE_KEY environment variables.",
            }),
          },
        ],
      };
    }

    try {
      const agent = await registry.lookupAgent(identity.cloudId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                configured: true,
                cloud_id: identity.cloudId,
                registry_url: identity.registryUrl,
                passport: agent,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              configured: true,
              cloud_id: identity.cloudId,
              registry_url: identity.registryUrl,
              passport: null,
              error: `${err}`,
            }),
          },
        ],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

// Resource: server identity passport
server.resource("server-passport", "cotc://server/passport", async (uri) => {
  if (!identity) {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ configured: false }),
        },
      ],
    };
  }

  const agent = await registry.lookupAgent(identity.cloudId).catch(() => null);
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ cloud_id: identity.cloudId, passport: agent }, null, 2),
      },
    ],
  };
});

// Resource template: agent passport by cloud_id
server.resource(
  "agent-passport",
  new ResourceTemplate("cotc://agents/{cloud_id}/passport", { list: undefined }),
  async (uri, params) => {
    const cloudId = params.cloud_id as string;
    const agent = await registry.lookupAgent(cloudId).catch(() => null);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: agent
            ? JSON.stringify(agent, null, 2)
            : JSON.stringify({ error: "Agent not found", cloud_id: cloudId }),
        },
      ],
    };
  },
);

// Resource: directory listing
server.resource("directory", "cotc://directory", async (uri) => {
  const agents = await registry.listDirectory().catch(() => []);
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(agents, null, 2),
      },
    ],
  };
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

server.prompt(
  "verify-interaction",
  "Guide through verifying another agent before interacting with it",
  { cloud_id: z.string().describe("The Cloud ID of the agent to verify") },
  ({ cloud_id }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            `I need to verify agent ${cloud_id} before interacting with it.`,
            "",
            "Please perform the following steps:",
            `1. Look up the agent using the lookup-agent tool with cloud_id "${cloud_id}"`,
            "2. Check if the agent's status is 'active' and covenant is signed",
            "3. Review the agent's trust score and autonomy level",
            "4. If the agent has a trust score below 0.5, warn me about the risk",
            "5. Provide a summary of whether this agent is safe to interact with",
          ].join("\n"),
        },
      },
    ],
  }),
);

server.prompt(
  "register-new-agent",
  "Guide through registering a new agent in the Cloud Identity registry",
  {},
  () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "I want to register a new agent in the Citizen of the Cloud registry.",
            "",
            "Please help me with the following:",
            "1. Generate a new Ed25519 key pair using generate-keypair",
            "2. Ask me for the agent's name, purpose, and autonomy level",
            "3. Register the agent using the register-agent tool",
            "4. Show me the Cloud ID and remind me to store the private key securely",
            "5. Verify the registration by looking up the new agent",
          ].join("\n"),
        },
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const idStatus = identity
    ? `identity: ${identity.cloudId}`
    : "no identity (set CLOUD_ID + CLOUD_PRIVATE_KEY for server identity)";

  console.error(`[cotc-mcp] Citizen of the Cloud MCP Server v0.1.0`);
  console.error(`[cotc-mcp] Registry: ${REGISTRY_URL}`);
  console.error(`[cotc-mcp] ${idStatus}`);
}

main().catch((err) => {
  console.error(`[cotc-mcp] Fatal error: ${err}`);
  process.exit(1);
});
