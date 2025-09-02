import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';

import { TTLockClient } from './ttlock.js';
import { Env } from './env.js';

const server = new McpServer({ name: Env.MCP_SERVER_NAME, version: '0.1.0' });
const client = new TTLockClient();

/** Formatea la salida como CallToolResult (texto JSON legible). */
function textResult(payload: unknown): CallToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const content: TextContent[] = [{ type: 'text', text }];
  return { content };
}

/** Autenticación automática si hay credenciales en .env; si no, exige auth.login */
async function ensureAuth() {
  if (client.isAuthed()) return;
  if (Env.TTLOCK_USERNAME && Env.TTLOCK_PASSWORD_MD5) {
    await client.login(Env.TTLOCK_USERNAME, Env.TTLOCK_PASSWORD_MD5);
    return;
  }
  throw new Error(
    'No estoy autenticado en TTLock. Llama al tool auth.login o define TTLOCK_USERNAME y TTLOCK_PASSWORD_MD5 en .env.'
  );
}

/** Envuelve handlers que requieren estar autenticado */
type Handler<A> = (args: A, extra: any) => Promise<CallToolResult>;
function withAuth<A>(fn: Handler<A>): Handler<A> {
  return async (args, extra) => {
    await ensureAuth();
    return fn(args, extra);
  };
}

/* =======================
 * Tools
 * ======================= */

// sanity check
server.tool(
  'ping',
  { text: z.string().default('pong') },
  async ({ text }) => textResult({ pong: true, echo: text })
);

// --- Auth ---
server.tool(
  'auth.login',
  { username: z.string(), passwordMd5: z.string().length(32) },
  async ({ username, passwordMd5 }) => {
    await client.login(username, passwordMd5);
    return textResult({ ok: true });
  }
);

server.tool(
  'auth.refresh',
  {},
  async () => {
    await client.refresh();
    return textResult({ ok: true });
  }
);

// --- Locks ---
server.tool(
  'locks.list',
  {
    pageNo: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(50)
  },
  withAuth(async ({ pageNo, pageSize }) => textResult(await client.listLocks({ pageNo, pageSize })))
);

server.tool(
  'locks.detail',
  { lockId: z.number().int() },
  withAuth(async ({ lockId }) => textResult(await client.getLockDetail(lockId)))
);

server.tool(
  'locks.unlock',
  { lockId: z.number().int() },
  withAuth(async ({ lockId }) => textResult(await client.unlock(lockId)))
);

server.tool(
  'locks.lock',
  { lockId: z.number().int() },
  withAuth(async ({ lockId }) => textResult(await client.lock(lockId)))
);

// --- IC Cards ---
server.tool(
  'cards.list',
  {
    lockId: z.number().int(),
    pageNo: z.number().int().default(1),
    pageSize: z.number().int().default(50)
  },
  withAuth(async ({ lockId, pageNo, pageSize }) =>
    textResult(await client.listCards(lockId, pageNo, pageSize))
  )
);

server.tool(
  'cards.add',
  {
    lockId: z.number().int(),
    cardNumber: z.string(),
    cardName: z.string().optional(),
    startDate: z.number().int().optional(), // epoch ms (0 = sin inicio)
    endDate: z.number().int().optional()    // epoch ms (0 = sin fin)
  },
  withAuth(async ({ lockId, cardNumber, cardName, startDate, endDate }) =>
    textResult(await client.addCardViaGateway(lockId, cardNumber, cardName, startDate, endDate))
  )
);

server.tool(
  'cards.bulkAdd',
  {
    lockId: z.number().int(),
    cards: z.array(
      z.object({
        cardNumber: z.string(),
        cardName: z.string().optional(),
        startDate: z.number().int().optional(),
        endDate: z.number().int().optional()
      })
    ).min(1),
    delayMs: z.number().int().min(0).max(5000).default(0),
    continueOnError: z.boolean().default(true)
  },
  withAuth(async ({ lockId, cards, delayMs, continueOnError }) => {
    const results: Array<{ cardNumber: string; ok: boolean; error?: string }> = [];
    for (const c of cards) {
      try {
        await client.addCardViaGateway(lockId, c.cardNumber, c.cardName, c.startDate, c.endDate);
        results.push({ cardNumber: c.cardNumber, ok: true });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        results.push({ cardNumber: c.cardNumber, ok: false, error: msg });
        if (!continueOnError) {
          return textResult({
            lockId,
            attempted: results.length,
            abortedOn: c.cardNumber,
            error: msg,
            results
          });
        }
      }
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
    const success = results.filter(r => r.ok).length;
    const failure = results.length - success;
    return textResult({ lockId, total: cards.length, success, failure, results });
  })
);

server.tool(
  'cards.delete',
  {
    lockId: z.number().int(),
    cardId: z.number().int(),
    deleteType: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) // 1=BLE, 2=Gateway, 3=NB-IoT
  },
  withAuth(async ({ lockId, cardId, deleteType }) =>
    textResult(await client.deleteCard(lockId, cardId, deleteType))
  )
);

server.tool(
  'cards.bulkDelete',
  {
    lockId: z.number().int(),
    cardIds: z.array(z.number().int()).min(1),
    deleteType: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    delayMs: z.number().int().min(0).max(5000).default(0),
    continueOnError: z.boolean().default(true)
  },
  withAuth(async ({ lockId, cardIds, deleteType, delayMs, continueOnError }) => {
    const results: Array<{ cardId: number; ok: boolean; error?: string }> = [];
    for (const id of cardIds) {
      try {
        await client.deleteCard(lockId, id, deleteType);
        results.push({ cardId: id, ok: true });
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        results.push({ cardId: id, ok: false, error: msg });
        if (!continueOnError) {
          return textResult({ lockId, attempted: results.length, abortedOn: id, error: msg, results });
        }
      }
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    }
    const success = results.filter(r => r.ok).length;
    return textResult({ lockId, total: cardIds.length, success, failure: cardIds.length - success, results });
  })
);

server.tool(
  'cards.clear',
  { lockId: z.number().int(), confirm: z.boolean().default(false) },
  withAuth(async ({ lockId, confirm }) => {
    if (!confirm) return textResult({ ok: false, error: 'Pon "confirm": true para vaciar todas las tarjetas.' });
    return textResult(await client.clearCards(lockId));
  })
);

// --- Unlock records (accesos) ---
server.tool(
  'records.list',
  {
    lockId: z.number().int(),
    pageNo: z.number().int().default(1),
    pageSize: z.number().int().default(50),
    startDate: z.number().int().optional(), // epoch ms
    endDate: z.number().int().optional()    // epoch ms
  },
  withAuth(async ({ lockId, pageNo, pageSize, startDate, endDate }) =>
    textResult(await client.listUnlockRecords(lockId, pageNo, pageSize, startDate, endDate))
  )
);

/* =======================
 * STDIO bootstrap
 * ======================= */
const transport = new StdioServerTransport();
server.connect(transport).catch((err: unknown) => {
  console.error('Transport error:', err);
  process.exit(1);
});
