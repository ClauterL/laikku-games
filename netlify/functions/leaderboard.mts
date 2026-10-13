import type { Config, Context } from '@netlify/functions'
import {
  GAME_SLUGS,
  TOP_SIZE,
  clampInt,
  fail,
  getTopList,
  guard,
  isGameSlug,
  isId,
  json,
  placeRow,
  qualifiesForTop,
  rankOf,
  readOwnRow,
  toEntries,
  type Entry,
} from '../lib/arcade'

/**
 * GET /api/leaderboard?game=<slug>&limit=50&player=<playerId> → `{ game, entries, total, you? }`
 * GET /api/leaderboard?limit=5[&player=<playerId>]             → `{ boards: { <slug>: { entries, total } } }`
 *
 * `player` only marks the viewer's own rows (`you: true`) and adds the `you` row; other players'
 * ids never leave the server.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  guard(async () => {
    const params = new URL(req.url).searchParams
    const game = params.get('game')
    const player = params.get('player')
    if (player !== null && !isId(player)) return fail(400, 'invalid-player', 'Invalid player id.')

    if (game === null || game === '') {
      const limit = clampInt(params.get('limit'), 1, 10, 5)
      const lists = await Promise.all(GAME_SLUGS.map((slug) => getTopList(context, slug)))
      const boards = Object.fromEntries(
        GAME_SLUGS.map((slug, i) => [slug, { entries: toEntries(lists[i].entries, limit, player), total: lists[i].total }]),
      )
      return json({ boards })
    }

    if (!isGameSlug(game)) return fail(400, 'invalid-game', 'Unknown game.')
    const limit = clampInt(params.get('limit'), 1, TOP_SIZE, 50)
    const [top, own] = await Promise.all([getTopList(context, game), player ? readOwnRow(game, player) : null])

    let view = top
    if (own) {
      // The cached list can lag behind the viewer's latest submission (e.g. while a rebuild is
      // under way), so the viewer's own row – read straight from arcade-scores – wins.
      const listed = top.entries.find((e) => e.id === own.id)
      const stale = listed ? listed.score !== own.score || listed.name !== own.name : qualifiesForTop(top, own)
      if (stale) view = placeRow(top, own, null)
    }

    const body: { game: string; entries: Entry[]; total: number; you?: Entry } = {
      game,
      entries: toEntries(view.entries, limit, player),
      total: view.total,
    }
    if (own) body.you = { rank: rankOf(view, own.id, own.score), name: own.name, score: own.score, ts: own.at, you: true }
    return json(body)
  })

export const config: Config = {
  path: '/api/leaderboard',
  method: ['GET'],
}
