import { Link } from 'react-router-dom'

/** Floating "back to the hub" button, top-left of every game. */
export function HomeButton() {
  return (
    <Link to="/" className="home-btn" aria-label="Back to Havaida Games" title="Back to Havaida Games">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v10h5v-6h4v6h5V10" />
      </svg>
    </Link>
  )
}
