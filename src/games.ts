/**
 * The five games of the series. Used by the hub page and the router.
 * Keep `slug` in sync with the folder name under src/games/.
 */
export interface GameMeta {
  slug: string
  company: string
  title: string
  /** The classic game the mechanics are inspired by. */
  inspiredBy: string
  tagline: string
  /** One sentence that explains the game in ten seconds. */
  howto: string
  accent: string
  accent2: string
  bg: string
}

export const GAMES: GameMeta[] = [
  {
    slug: 'ticket-slash',
    company: 'Topteam IT',
    title: 'Ticket Slash',
    inspiredBy: 'Fruit Ninja',
    tagline: 'Triage. Swipe. Solve. Keep it moving.',
    howto: 'Flick each flying IT ticket into the matching solution bin. Chain correct ones for combos – and never miss a P1.',
    accent: '#2f80ff',
    accent2: '#ffb020',
    bg: '#0f1b3d',
  },
  {
    slug: 'network-connect',
    company: 'C2',
    title: 'Network Connect',
    inspiredBy: 'Flow Free',
    tagline: 'Connect. Secure. Solve. Level up.',
    howto: 'Drag glowing data paths from USER to CLOUD through every tile without crossing. Power-ups clear firewalls and packet loss.',
    accent: '#2fa8ff',
    accent2: '#ffd43b',
    bg: '#0b1736',
  },
  {
    slug: 'access-crossing',
    company: 'Hansab',
    title: 'Access Crossing',
    inspiredBy: 'Subway Surfers',
    tagline: 'Right people. Right access. A safer tomorrow.',
    howto: 'Run through the smart building: switch lanes to the gate your badge opens, jump and slide past obstacles, dodge camera sweeps, ride the elevator up.',
    accent: '#1b5fd1',
    accent2: '#2bb673',
    bg: '#dbe7f5',
  },
  {
    slug: 'signal-command',
    company: 'Puolustusvoimat',
    title: 'Signal Command',
    inspiredBy: 'Helldivers 2 – Stratagem Hero',
    tagline: 'Communications · Networks · People.',
    howto: 'Incidents hit the command network across Finland. Enter each command code – a sequence of arrows – before the wave timer runs out. Wrong arrow resets the code; flawless chains build your combo.',
    accent: '#19c8ff',
    accent2: '#36ff6a',
    bg: '#06101a',
  },
  {
    slug: 'bug-breaker',
    company: 'Infomaatti',
    title: 'Bug Breaker',
    inspiredBy: 'Angry Birds',
    tagline: 'Launch code. Break bugs. Build a cleaner world!',
    howto: 'Pull back the slingshot and fire code blocks at the bug towers. Each language has its own special move.',
    accent: '#ff7a1a',
    accent2: '#ffd400',
    bg: '#5ec8ff',
  },
  {
    slug: 'uptime-keeper',
    company: 'Ficolo',
    title: 'Uptime Keeper',
    inspiredBy: 'Overcooked-style arcade',
    tagline: 'Keep the hall alive. 99.999 %.',
    howto: 'Run between the racks: cool what overheats, repair what breaks, upgrade what you can – and keep uptime as close to 100 % as possible.',
    accent: '#e8102a',
    accent2: '#1ec8ff',
    bg: '#0d1016',
  },
]

export const gameBySlug = (slug: string) => GAMES.find((g) => g.slug === slug)
