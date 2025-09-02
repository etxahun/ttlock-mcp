import 'dotenv/config';
import { z } from 'zod';

export const Env = z.object({
  TTLOCK_CLIENT_ID: z.string().min(1),
  TTLOCK_CLIENT_SECRET: z.string().min(1),
  TTLOCK_USERNAME: z.string().optional(),
  TTLOCK_PASSWORD_MD5: z.string().length(32).optional(),
  TTLOCK_API_BASE: z.string().default('https://api.sciener.com'),
  MCP_SERVER_NAME: z.string().default('ttlock-mcp'),
}).parse(process.env);
