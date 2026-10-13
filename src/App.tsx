import { Suspense, lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Hub } from './hub/Hub'
import { PresenceTracker } from './shared/PresenceTracker'
import { ScoreToast } from './shared/ScoreToast'

// Each game is its own lazy chunk so the hub loads instantly.
const TicketSlash = lazy(() => import('./games/ticket-slash/TicketSlash'))
const NetworkConnect = lazy(() => import('./games/network-connect/NetworkConnect'))
const AccessCrossing = lazy(() => import('./games/access-crossing/AccessCrossing'))
const SignalCommand = lazy(() => import('./games/signal-command/SignalCommand'))
const BugBreaker = lazy(() => import('./games/bug-breaker/BugBreaker'))
const UptimeKeeper = lazy(() => import('./games/uptime-keeper/UptimeKeeper'))

function Loading() {
  return <div className="loading-screen">Loading…</div>
}

export default function App() {
  return (
    <HashRouter>
      {/* online layer (docs/ONLINE.md): heartbeat + leaderboard toast, both silent when offline */}
      <PresenceTracker />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Hub />} />
          <Route path="/leaderboard/:game?" element={<Hub />} />
          <Route path="/ticket-slash" element={<TicketSlash />} />
          <Route path="/network-connect" element={<NetworkConnect />} />
          <Route path="/access-crossing" element={<AccessCrossing />} />
          <Route path="/signal-command" element={<SignalCommand />} />
          <Route path="/command-base" element={<Navigate to="/signal-command" replace />} />
          <Route path="/bug-breaker" element={<BugBreaker />} />
          <Route path="/uptime-keeper" element={<UptimeKeeper />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ScoreToast />
    </HashRouter>
  )
}
