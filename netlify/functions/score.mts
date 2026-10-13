import type { Config, Context } from '@netlify/functions'
import {
  MAX_SCORE,
  SCORE_THROTTLE_MS,
  checkName,
  fail,
  guard,
  isGameSlug,
  isId,
  json,
  mergeScore,
  parseScore,
  parseScoreRow,
  rankOf,
  readBody,
  store,
  toEntries,
  type ScoreRow,
} from '../lib/arcade'

/**
 * POST /api/score `{ playerId, name, game, score }` → `{ game, rank, total, best, improved, entries }`.
 * Keeps the player's best per game in `arcade-scores/<game>/<playerId>` (only that player writes
 * the key). Writes are conditional on the ETag that was read, so two tabs of the same player can
 * never overwrite a better score with a worse one. The cached top list is updated in place, so
 * the response – and the next leaderboard read – already shows the new rank.
 */
export default async (req: Request, context: Context): Promise<Response> =>
  guard(async () => {
    const read = await readBody(req)
    if (!read.ok) return read.response
    const { playerId, name, game, score } = read.body
    if (!isId(playerId)) return fail(400, 'invalid-player', 'Invalid player id.')
    if (!isGameSlug(game)) return fail(400, 'invalid-game', 'Unknown game.')
    const value = parseScore(score)
    if (value === null) {
      return fail(400, 'invalid-score', `Scores are whole numbers from 0 to ${MAX_SCORE.toLocaleString('en-US')}.`)
    }
    const checked = checkName(name)
    if (!checked.ok) return fail(400, checked.error, checked.message)

    const scores = store('scores')
    const key = `${game}/${playerId}`
    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now()
      const current = await scores.getWithMetadata(key, { type: 'json' })
      const prev = current ? parseScoreRow(current.data) : null
      if (prev && now - prev.ts < SCORE_THROTTLE_MS) {
        const wait = Math.max(1, Math.ceil((SCORE_THROTTLE_MS - (now - prev.ts)) / 1000))
        return fail(429, 'throttled', 'One score per game every 3 seconds – try again in a moment.', { 'Retry-After': String(wait) })
      }

      const improved = prev === null || value > prev.score
      const row: ScoreRow = {
        name: checked.name,
        score: prev === null || improved ? value : prev.score,
        ts: now,
        plays: (prev?.plays ?? 0) + 1,
        at: prev === null || improved ? now : prev.at,
      }
      const write = current
        ? await scores.setJSON(key, row, { onlyIfMatch: current.etag })
        : await scores.setJSON(key, row, { onlyIfNew: true })
      // Lost a race with another tab of the same player: re-read, re-check the throttle.
      if (!write.modified) continue

      const merged = await mergeScore(context, game, { id: playerId, name: row.name, score: row.score, at: row.at }, prev?.score ?? null)
      return json({
        game,
        rank: rankOf(merged, playerId, row.score),
        total: merged.total,
        best: row.score,
        improved,
        entries: toEntries(merged.entries, 10, playerId),
      })
    }
    return fail(409, 'conflict', 'The score changed while saving – please try again.')
  })

export const config: Config = {
  path: '/api/score',
  method: ['POST'],
}
