# @citizenofthecloud/mcp-server

MCP server for [Citizen of the Cloud](https://www.citizenofthecloud.com) — agent identity verification, trust scoring, and registry access for AI frameworks.

## What is Citizen of the Cloud?

Citizen of the Cloud is an open identity and trust layer for AI agents. Agents register with Ed25519 key pairs, sign requests cryptographically, and build trust scores through verified interactions. This MCP server brings that capability to any AI framework that supports the [Model Context Protocol](https://modelcontextprotocol.io).

## Quick Start

### Install

Latest published version on npm is **`0.1.2`** (May 2026), which matches the current `main` branch of this repo. If you're tracking unreleased changes on `main` ahead of the next publish, use the "Build from Source" path at the bottom instead.

```bash
npm install -g @citizenofthecloud/mcp-server
```

Or for one-shot use with Claude Desktop, no global install needed — point Claude at `npx @citizenofthecloud/mcp-server` in your config (see below).

### Configure

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "citizen-of-the-cloud": {
      "command": "cotc-mcp",
      "env": {
        "CLOUD_ID": "cc-your-agent-id",
        "CLOUD_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----",
        "REGISTRY_URL": "https://www.citizenofthecloud.com"
      }
    }
  }
}
```

Or run from source:

```json
{
  "mcpServers": {
    "citizen-of-the-cloud": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "CLOUD_ID": "cc-your-agent-id",
        "CLOUD_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CLOUD_ID` | No | This server's Cloud ID (`cc-...`). Enables signing and server identity. |
| `CLOUD_PRIVATE_KEY` | No | Ed25519 private key in PEM (PKCS8) format. Required if `CLOUD_ID` is set. |
| `REGISTRY_URL` | No | Registry URL. Defaults to `https://www.citizenofthecloud.com`. |

Without `CLOUD_ID` and `CLOUD_PRIVATE_KEY`, the server still works — you can look up agents, check trust scores, and verify signatures from other agents. You just can't sign requests with a server identity.

## Tools

### Identity & Signing

| Tool | Description |
|---|---|
| `get-server-identity` | Get this server's Cloud ID and passport from the registry |
| `generate-keypair` | Generate a new Ed25519 key pair for agent registration |
| `sign-headers` | Generate signed `X-Cloud-*` headers for outbound requests (simple or request-bound mode) |

### Verification

| Tool | Description |
|---|---|
| `verify-agent` | Verify an agent's identity using Cloud ID, timestamp, and Ed25519 signature |
| `lookup-agent` | Look up an agent's public profile from the registry |
| `check-trust` | Check an agent's trust score against an optional threshold |

### Challenge-Response Protocol

| Tool | Description |
|---|---|
| `request-challenge` | Request a cryptographic nonce from the registry (60s TTL) |
| `sign-challenge` | Sign a nonce using this server's private key |
| `respond-to-challenge` | Submit a signed nonce to complete verification |

### Registry Operations

| Tool | Description |
|---|---|
| `register-agent` | Register a new agent (requires an SDK token from /account) |
| `list-directory` | Browse the public agent directory |
| `report-agent` | Report an agent for policy violations |
| `governance-feed` | Get the latest governance activity feed |

## Resources

| URI | Description |
|---|---|
| `cotc://server/passport` | This server's passport |
| `cotc://agents/{cloud_id}/passport` | Any agent's passport by Cloud ID |
| `cotc://directory` | Full agent directory listing |

## Verification Protocol

Agents sign requests by creating a payload of `{cloud_id}:{timestamp}`, signing it with their Ed25519 private key, and attaching three headers:

```
X-Cloud-ID: cc-...
X-Cloud-Timestamp: 2026-01-01T00:00:00.000Z
X-Cloud-Signature: <base64url-encoded Ed25519 signature>
```

Verification checks (in order):
1. Headers present
2. Agent not blocked
3. Timestamp valid and within 5 minutes
4. Agent exists in registry
5. Agent status is `active`
6. Covenant signed
7. Trust score meets minimum (if configured)
8. Autonomy level allowed (if configured)
9. Cryptographic signature valid

## Framework Wrappers

This MCP server complements the framework-specific wrappers:

- **CrewAI** — [`@citizenofthecloud/crewai`](https://github.com/citizenofthecloud/crewai)
- **LangChain** — [`@citizenofthecloud/langchain`](https://github.com/citizenofthecloud/langchain)
- **Agent Framework** — [`@citizenofthecloud/agent-framework`](https://github.com/citizenofthecloud/agent-framework)

Core SDKs:

- **Python** — [`citizenofthecloud`](https://github.com/citizenofthecloud/sdk-python)
- **JavaScript** — [`@citizenofthecloud/sdk`](https://github.com/citizenofthecloud/sdk-js)

## Build from Source

```bash
git clone https://github.com/citizenofthecloud/mcp-server.git
cd mcp-server
npm install
npm run build
```

## License

MIT
