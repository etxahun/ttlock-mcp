# 🔒 TTLock MCP

An **MCP (Model Context Protocol)** server to access and manage **TTLock** data from MCP-compatible clients (VS Code, MCP Inspector, etc.).  
It supports OAuth, lock management, IC card operations (add/delete/list, bulk), and reading unlock records.

---

## 📁 Table of Contents

- [Architecture & Repository Layout](#architecture--repository-layout)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
  - [.env](#env)
  - [VS Code (`.vscode/mcp.json`)](#vs-code-vscodemcpjson)
- [NPM Scripts](#npm-scripts)
- [Run & Test](#run--test)
  - [MCP Inspector](#mcp-inspector)
  - [VS Code](#vs-code)
- [Tools Catalog (MCP)](#tools-catalog-mcp)
- [TTLock Integration Notes](#ttlock-integration-notes)
- [Troubleshooting](#troubleshooting)
- [Security & Best Practices](#security--best-practices)
- [Roadmap](#roadmap)
- [License](#license)

---

## 🏗️ Architecture & Repository Layout

```
ttlock-mcp/
├─ src/
│  ├─ env.ts          # Loads/validates environment variables (.env) with zod
│  ├─ server.ts       # MCP server (STDIO) + tool definitions (with auth guard)
│  └─ ttlock.ts       # TTLock HTTP client (OAuth + v3 endpoints)
├─ dist/              # Compiled output (tsc)
├─ .vscode/
│  └─ mcp.json        # VS Code config to launch the MCP server
├─ .env               # Local environment variables (DO NOT commit)
├─ package.json
├─ tsconfig.json
└─ README.md          # This document
```

**Tech highlights**

- **Node.js 20+** with **ESM** (`moduleResolution: "NodeNext"`)
- **TypeScript**
- **@modelcontextprotocol/sdk** (STDIO server)
- **axios**, **qs**, **zod**, **dotenv**
- *(optional)* **dotenv-cli** to load `.env` for the Inspector command

> **NodeNext/ESM note:** use **`.js` extension** in **relative imports** even in `.ts` files  
> (e.g. `import { Env } from './env.js'`).

---

## 📋 Requirements

- Node.js **>= 20**
- TTLock Cloud credentials: `clientId`, `clientSecret`
- A TTLock **gateway online** for remote operations (unlock/lock and IC card add/delete)

---

## 🛠️ Installation

```bash
# 1) Install deps
npm install

# 2) (optional) Convenient for Inspector to auto-load .env
npm i -D dotenv-cli

# 3) Build once
npm run build
```

---

## ⚙️ Configuration

### 🔐 `.env`

Create a `.env` file at the repo root:

```ini
TTLOCK_CLIENT_ID=xxxxxxxx
TTLOCK_CLIENT_SECRET=xxxxxxxx
TTLOCK_API_BASE=https://api.sciener.com
MCP_SERVER_NAME=ttlock-mcp

# Optional: auto-login on first use
TTLOCK_USERNAME=your_ttat_account_or_email
TTLOCK_PASSWORD_MD5=32_char_lowercase_md5_of_your_password
```

> Get MD5 on Linux:
>
> ```bash
> echo -n 'your_password' | md5sum | awk '{print $1}'
> ```

### 💻 VS Code (`.vscode/mcp.json`)

Recommended workspace configuration:

```json
{
  "servers": {
    "ttlock-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/server.js"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

This lets VS Code start the server and load your `.env` automatically.

---

## 📜 NPM Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "watch": "tsc -w",
    "inspect": "dotenv -e .env -- npx @modelcontextprotocol/inspector node dist/server.js"
  }
}
```

> If you don’t use `dotenv-cli`, pass your variables via the Inspector UI or your shell environment.

---

## 🧪 Run & Test

### 🔍 MCP Inspector

```bash
npm run build
npm run inspect
```

Inspector UI settings:

- **Transport Type:** `STDIO`
- **Command:** `node`
- **Arguments:** `dist/server.js`

Quick tests:

1. **ping**
   ```json
   { "text": "hello" }
   ```
2. **auth.login** (if you didn’t configure auto-login):
   ```json
   { "username": "YOUR_EMAIL", "passwordMd5": "32_char_lowercase_md5" }
   ```
3. **locks.list**
   ```json
   { "pageNo": 1, "pageSize": 50 }
   ```

### 💻 VS Code

- Open the project (WSL or local) with `code .`.
- With the `mcp.json` above, open the **Chat** view (Copilot).  
  The **ttlock-mcp** server appears and tools are available.  
- Invoke tools directly (e.g., select `locks.list` or type `#locks.list`).

---

## 🧪 Tools Catalog (MCP)

> All handlers return `CallToolResult` (`{ content: [{ type: "text", text }] }`).  
> Tools marked with 🔒 require authentication (auto-login if `TTLOCK_USERNAME` and `TTLOCK_PASSWORD_MD5` are present in `.env`).

### 🔑 Auth

- **`auth.login`** `{ username: string, passwordMd5: string }`
- **`auth.refresh`** `{}`

### 🔒 Locks

- 🔒 **`locks.list`** `{ pageNo?: number=1, pageSize?: number=50 }`
- 🔒 **`locks.detail`** `{ lockId: number }`
- 🔒 **`locks.unlock`** `{ lockId: number }` *(requires gateway online)*
- 🔒 **`locks.lock`** `{ lockId: number }` *(requires gateway online)*

### 🪪 IC Cards

- 🔒 **`cards.list`** `{ lockId: number, pageNo?: number=1, pageSize?: number=50 }`
- 🔒 **`cards.add`** `{ lockId: number, cardNumber: string, cardName?: string, startDate?: ms, endDate?: ms }`  
  If `startDate`/`endDate` are omitted (or `0`), the card is permanent.
- 🔒 **`cards.bulkAdd`**  
  `{ lockId: number, cards: Array<{cardNumber, cardName?, startDate?, endDate?}>, delayMs?: 0–5000, continueOnError?: boolean }`
- 🔒 **`cards.delete`** `{ lockId: number, cardId: number, deleteType?: 1|2|3=2 }`
- 🔒 **`cards.bulkDelete`** `{ lockId: number, cardIds: number[], deleteType?: 1|2|3=2, delayMs?: 0–5000, continueOnError?: boolean }`
- 🔒 **`cards.clear`** `{ lockId: number, confirm?: boolean=false }`  
  ⚠️ Deletes **all** cards on the lock.

> **cardId vs cardNumber:** deleting requires **`cardId`** (fetch it via `cards.list`).  
> `deleteType`: `2` = **Gateway** (remote) is most useful; `1` = BLE; `3` = NB-IoT (if applicable).

### 📋 Unlock Records (Access Logs)

- 🔒 **`records.list`**  
  `{ lockId: number, pageNo?: number=1, pageSize?: number=50, startDate?: ms, endDate?: ms }`

**Time format:** `startDate`/`endDate` are **epoch milliseconds (UTC)**.  
Example (Madrid CEST, today 06:00–10:00): `startDate=1756699200000`, `endDate=1756713600000`.

---

## 🔗 TTLock Integration Notes

- **OAuth:** login uses `username` + `passwordMd5` (32 chars, lowercase).
- **`date` parameter (v3 APIs):** each call sends `date = Date.now()`. TTLock servers accept roughly ±5 minutes.  
  If you see `date must be current time, in 5 minutes`, sync your system clock (NTP).  
  The client also supports a retry with server time offset (from HTTP `Date` header) to mitigate small drifts.
- **Gateway:** remote operations (unlock/lock, add/delete card) need a compatible **gateway online**.
- **ESM:** keep relative imports ending with `.js`.

---

## 🧯 Troubleshooting

- **`date must be current time, in 5 minutes`**  
  Your machine clock is off. Enable NTP:
  ```bash
  timedatectl set-ntp true
  sudo systemctl restart systemd-timesyncd
  ```
- **Not authenticated**  
  Run `auth.login` or set `TTLOCK_USERNAME` and `TTLOCK_PASSWORD_MD5` in `.env`.
- **Gateway offline / Not support**  
  Ensure your lock/gateway supports the operation and is online.
- **Inspector “Command not found”**  
  Check **Command** = `node`, **Arguments** = `dist/server.js`, and that you built the project.
- **ESM import errors**  
  Ensure relative imports end with `.js` and `tsconfig.json` uses `moduleResolution: "NodeNext"`.

---

## 🗺️ Roadmap

- Persist/rotate tokens on disk (cache).
- Webhook **Lock Records Notify** for real-time events.
- More management endpoints (rename card, change validity window, etc.).
- Tests and linting (Vitest/ESLint).

---

## 📄 License

This project is licensed under Apache-2.0.
