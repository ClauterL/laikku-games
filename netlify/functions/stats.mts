import type { Config, Context } from '@netlify/functions'
import { computeStats, guard, json } from '../lib/arcade'

/** GET /api/stats → Stats (online now, players so far – totals and per game). Read-only. */
export default async (_req: Request, context: Context): Promise<Response> =>
  guard(async () => json(await computeStats(context)))

export const config: Config = {
  path: '/api/stats',
  method: ['GET'],
}
