import type { Config, Context } from '@netlify/functions'
import {
  bucketOf,
  computeStats,
  fail,
  guard,
  isGameSlug,
  isId,
  isPresenceGame,
  json,
  presenceKey,
  readBody,
  registerPlayer,
  store,
} from '../lib/arcade'

/**
 * POST /api/presence `{ sessionId, playerId, game }` → Stats.
 * Each visible tab sends one every 30 s (and right after a route change). The heartbeat writes
 * `<bucket>/<game>/<sessionId>` – a key only this session ever writes – and, on the first visit
 * of a player to a game, the onlyIfNew player keys.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  guard(async () => {
    const read = await readBody(req)
    if (!read.ok) return read.response
    const { sessionId, playerId, game } = read.body
    if (!isId(sessionId)) return fail(400, 'invalid-session', 'Invalid session id.')
    if (!isId(playerId)) return fail(400, 'invalid-player', 'Invalid player id.')
    if (!isPresenceGame(game)) return fail(400, 'invalid-game', 'Unknown game.')

    const bucket = bucketOf(Date.now())
    const [, newPlayer] = await Promise.all([
      store('presence').set(presenceKey(bucket, game, sessionId), '1'),
      isGameSlug(game) ? registerPlayer(playerId, game) : false,
    ])
    return json(await computeStats(context, { self: { bucket, game, sessionId }, freshPlayers: newPlayer }))
  })

export const config: Config = {
  path: '/api/presence',
  method: ['POST'],
}
