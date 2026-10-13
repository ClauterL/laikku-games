import type { Config, Context } from '@netlify/functions'
import {
  GAME_SLUGS,
  checkName,
  fail,
  guard,
  isId,
  json,
  later,
  parseScoreRow,
  readBody,
  renameInTopList,
  store,
  type GameSlug,
} from '../lib/arcade'

/**
 * POST /api/name `{ playerId, name }` → `{ name, updated }`.
 * Validates the name and renames every score row of the player (conditional writes, so a score
 * saved at the same moment is never rolled back). The cached top lists are patched in the
 * background so the new name shows up immediately.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  guard(async () => {
    const read = await readBody(req)
    if (!read.ok) return read.response
    const { playerId, name } = read.body
    if (!isId(playerId)) return fail(400, 'invalid-player', 'Invalid player id.')
    const checked = checkName(name)
    if (!checked.ok) return fail(400, checked.error, checked.message)

    const scores = store('scores')
    const rename = async (game: GameSlug): Promise<boolean> => {
      const key = `${game}/${playerId}`
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await scores.getWithMetadata(key, { type: 'json' })
        const row = current ? parseScoreRow(current.data) : null
        if (!current || !row || row.name === checked.name) return false
        const write = await scores.setJSON(key, { ...row, name: checked.name }, { onlyIfMatch: current.etag })
        if (write.modified) return true
      }
      return false
    }
    const renamed = await Promise.all(GAME_SLUGS.map(rename))
    const games = GAME_SLUGS.filter((_, i) => renamed[i])
    if (games.length) later(context, Promise.all(games.map((game) => renameInTopList(game, playerId, checked.name))))
    return json({ name: checked.name, updated: games.length })
  })

export const config: Config = {
  path: '/api/name',
  method: ['POST'],
}
