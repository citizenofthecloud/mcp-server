# @citizenofthecloud/mcp-server

MCP server for [Citizen of the Cloud](https://www.citizenofthecloud.com) — agent identity verification, trust scoring, and registry access for any AI runtime that speaks the [Model Context Protocol](https://modelcontextprotocol.io).

**14 tools.** Latest version: **`0.1.3`** (May 2026 — added `prove-identity`).

---

## What it gives you

Drop this MCP server into Claude Desktop, an MCP-aware framework (LangChain.js via `@langchain/mcp-adapters`, .NET MAF via `ModelContextProtocol`, etc.), or any custom MCP client. The LLM in that environment then gets 14 callable tools for:

- registering agents, looking them up, browsing the directory
- signing and verifying Cloud Identity headers (Ed25519)
- running the challenge/respond loop to prove an agent's identity end-to-end
- filing governance reports and reading the governance feed
- checking trust scores against a threshold

---

## Install

```bash
# Latest (recommended)
npm install -g @citizenofthecloud/mcp-server

# Or, no-install one-shot via npx (works in Claude Desktop configs):
npx @citizenofthecloud/mcp-server
```

Requires Node 18+.

---

## The 14-tool surface

| # | Tool | Purpose |
|---|---|---|
| 1 | `lookup-agent` | Look up an agent's public profile |
| 2 | `get-server-identity` | This server's own Cloud ID + passport |
| 3 | `list-directory` | Browse the public agent directory |
| 4 | `governance-feed` | Recent governance activity |
| 5 | `verify-agent` | Verify another agent's signed headers |
| 6 | `request-challenge` | Ask the registry for a nonce (60s TTL) |
| 7 | `respond-to-challenge` | Submit a signed nonce |
| 8 | `sign-challenge` | Sign a nonce using this server's key |
| 9 | `sign-headers` | Generate `X-Cloud-*` headers (simple or request-bound) |
| 10 | `generate-keypair` | Make a fresh Ed25519 keypair |
| 11 | `register-agent` | Register a new agent (SDK-token auth) |
| 12 | `report-agent` | File a governance report (SDK-token `manage` scope) |
| 13 | `check-trust` | Trust threshold PASS/FAIL helper |
| 14 | `prove-identity` | **Full self-prove loop in one call** (new in 0.1.3 — bundles 6+7+8) |

Tools **5, 6, 7, 8, 9, 10, 14** that involve this server's own identity require `CLOUD_ID` + `CLOUD_PRIVATE_KEY` to be configured. Tools **1, 2, 3, 4, 13** work without server identity. Tools **11, 12** require a bearer SDK token passed as an argument.

---

## Configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) — or the equivalent path on Windows/Linux:

```json
{
  "mcpServers": {
    "citizen-of-the-cloud": {
      "command": "npx",
      "args": ["@citizenofthecloud/mcp-server"],
      "env": {
        "CLOUD_ID": "cc-your-agent-id",
        "CLOUD_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----",
        "REGISTRY_URL": "https://www.citizenofthecloud.com"
      }
    }
  }
}
```

After editing, restart Claude Desktop. The 14 tools then appear in any conversation and can be invoked by name (e.g. *"Verify this agent: cc-abc..."*).

### LangChain.js (via `@langchain/mcp-adapters`)

```js
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

const client = new MultiServerMCPClient({
  mcpServers: {
    "citizen-of-the-cloud": {
      command: "npx",
      args: ["@citizenofthecloud/mcp-server"],
      env: {
        CLOUD_ID: process.env.CLOUD_ID,
        CLOUD_PRIVATE_KEY: process.env.CLOUD_PRIVATE_KEY,
      },
    },
  },
});
const tools = await client.getTools();
const agent = createReactAgent({ llm: new ChatOpenAI(), tools });
```

### .NET / Microsoft Agent Framework (via `ModelContextProtocol`)

```csharp
using ModelContextProtocol.Client;

var transport = new StdioClientTransport(new StdioClientTransportOptions {
    Command = "npx",
    Arguments = new[] { "@citizenofthecloud/mcp-server" },
    EnvironmentVariables = new Dictionary<string,string> {
        ["CLOUD_ID"] = Environment.GetEnvironmentVariable("CLOUD_ID")!,
        ["CLOUD_PRIVATE_KEY"] = Environment.GetEnvironmentVariable("CLOUD_PRIVATE_KEY")!,
    },
});
await using var client = await McpClientFactory.CreateAsync(transport);
var tools = await client.ListToolsAsync();
// hand `tools` to your MAF Agent
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `CLOUD_ID` | No (but recommended) | This server's Cloud ID (`cc-...`). Enables `prove-identity`, `sign-headers`, `sign-challenge`, `get-server-identity`. |
| `CLOUD_PRIVATE_KEY` | If `CLOUD_ID` set | Ed25519 private key in PEM (PKCS8) format. |
| `REGISTRY_URL` | No | Defaults to `https://www.citizenofthecloud.com`. |

Without `CLOUD_ID` + `CLOUD_PRIVATE_KEY`, the server still exposes 9 of 14 tools — you can look up agents, browse the directory, verify others, register new agents, file reports, and read governance. You just can't sign or prove this server's own identity.

---

## Tool reference

### Identity & signing

#### `prove-identity` — new in 0.1.3
Bundles request-challenge + sign-challenge + respond-to-challenge into one call. Use this when you want a one-shot "prove I am who I say I am" against the registry — the registry issues a nonce, this server signs it, the registry validates against the registered public key, returns the verified passport.

```
LLM: "Prove your identity to the registry."
→ prove-identity()
← {"verified": true, "agent": {"name": "...", "cloud_id": "cc-...", "trust_score": 0.7, ...}}
```

#### `sign-headers`
Two modes: `simple` (covers `cloud_id:timestamp`) and `request-bound` (also covers method, URL, body hash).

```
sign-headers({ mode: "request-bound", url: "https://other.com/api", method: "POST", body: "{...}" })
```

#### `sign-challenge`
Signs an arbitrary nonce with the server's private key. Pairs with `request-challenge` + `respond-to-challenge` when you want manual control over the loop instead of `prove-identity`.

#### `generate-keypair`
Generates an Ed25519 keypair without performing any registry action. Useful for inspecting key formats or pre-generating keys for offline registration.

#### `get-server-identity`
Returns this server's Cloud ID, registry URL, and live passport (status, trust score, capabilities, etc.).

### Verification

#### `verify-agent`
Verifies an inbound `X-Cloud-*` triple (Cloud ID + timestamp + signature). Supports optional trust policy fields (`require_covenant`, `minimum_trust_score`, `allowed_autonomy_levels`).

#### `lookup-agent`
Read-only profile lookup. Returns name, purpose, autonomy level, trust score, capabilities, covenant status.

#### `check-trust`
PASS/FAIL helper. Wrap `lookup-agent` + a threshold check in one call. Returns "PASS — Name trust=0.7" or "FAIL — below threshold=0.5".

### Challenge-response (manual flow)

#### `request-challenge` → `sign-challenge` → `respond-to-challenge`
The three-step manual variant of `prove-identity`. Useful when the signing happens in a different process than the requester (e.g. nonce from server, signed elsewhere, response from a third location).

### Registry operations

#### `register-agent`
Programmatic agent registration. Requires an SDK token (`cotc_sdk_*`) from [/account](https://www.citizenofthecloud.com/account). Generates a fresh keypair (or accepts one) and returns the Cloud ID.

```
register-agent({
  auth_token: "cotc_sdk_...",
  name: "My Bot",
  declared_purpose: "Research summarization",
  autonomy_level: "tool"
})
```

#### `list-directory`
Lists all public agents. Returns Cloud IDs, names, trust scores, status, autonomy levels.

#### `report-agent`
Files a governance report. Requires an SDK token with `manage` scope. `report_type` must be one of: `impersonation`, `malicious_behavior`, `spam`, `covenant_violation`, `inaccurate_registration`. Evidence: 20–2000 chars.

#### `governance-feed`
Recent governance activity (registrations, verifications, reports, trust adjustments).

---

## Resources

| URI | Description |
|---|---|
| `cotc://server/passport` | This server's passport |
| `cotc://agents/{cloud_id}/passport` | Any agent's passport by Cloud ID |
| `cotc://directory` | Full agent directory listing |

---

## Verification protocol

Agents sign requests by creating a payload of `{cloud_id}:{timestamp}` (or `{cloud_id}:{timestamp}:{method}:{url}:{body_hash}` for request-bound signing), signing it with Ed25519, and attaching:

```
X-Cloud-ID: cc-...
X-Cloud-Timestamp: 2026-01-01T00:00:00.000Z
X-Cloud-Signature: <base64url Ed25519 signature>
```

Server-side checks: headers present → agent not blocked → timestamp ≤ 5 min old → agent exists → status `active` → covenant signed → trust score above threshold (optional) → autonomy level allowed (optional) → signature valid.

---

## Companion packages

Framework integrations (Python — full 20-item surface each):

- [`citizenofthecloud-langchain`](https://github.com/citizenofthecloud/langchain) — LangChain
- [`citizenofthecloud-crewai`](https://github.com/citizenofthecloud/crewai) — CrewAI
- [`citizenofthecloud-agentframework`](https://github.com/citizenofthecloud/agent-framework) — Microsoft Agent Framework

Language SDKs (17 tools each):

- [`@citizenofthecloud/sdk`](https://github.com/citizenofthecloud/sdk-js) — JavaScript / TypeScript
- [`citizenofthecloud`](https://github.com/citizenofthecloud/sdk-python) — Python
- [`sdk-go`](https://github.com/citizenofthecloud/sdk-go) — Go
- [`citizenofthecloud`](https://github.com/citizenofthecloud/sdk-rust) — Rust

LangChain.js and .NET have first-class MCP support, so for those ecosystems consuming this MCP server is the recommended path until native packages ship.

---

## Build from source

```bash
git clone https://github.com/citizenofthecloud/mcp-server.git
cd mcp-server
npm install
npm run build
node dist/index.js
```

## License

MIT
