import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { GAMES } from '../games'
import { setPresenceGame, startPresence } from './online'

/** Game slug for game routes, `hub` for everything else (hub, leaderboard). */
function presenceGameFor(pathname: string): string {
  const slug = pathname.split('/')[1] ?? ''
  return GAMES.some((g) => g.slug === slug) ? slug : 'hub'
}

/**
 * Keeps the presence heartbeat running while the app is open (paused in hidden tabs) and tells
 * it which game the player is on. Mounted once inside the router; renders nothing.
 */
export function PresenceTracker() {
  const { pathname } = useLocation()
  useEffect(() => startPresence(), [])
  useEffect(() => setPresenceGame(presenceGameFor(pathname)), [pathname])
  return null
}
