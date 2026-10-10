import type { BinDef, Category, TicketDef } from './types'

/** The six solution bins, left to right, with their colours and icons (spec order). */
export const BINS: readonly BinDef[] = [
  { category: 'vpn', label: 'VPN', short: 'VPN', color: '#2f80ff', icon: 'globe' },
  { category: 'email', label: 'EMAIL', short: 'MAIL', color: '#8a3ffc', icon: 'envelope' },
  { category: 'mfa', label: 'MFA', short: 'MFA', color: '#2ecc71', icon: 'shield' },
  { category: 'printer', label: 'PRINTER', short: 'PRINT', color: '#f5a623', icon: 'printer' },
  { category: 'backup', label: 'BACKUP', short: 'BACKUP', color: '#ff4d4f', icon: 'database' },
  { category: 'ad', label: 'ACTIVE\nDIRECTORY', short: 'AD', color: '#4cc3ff', icon: 'people' },
]

export const binDef = (category: Category): BinDef => BINS.find((b) => b.category === category)!

const t = (category: Category, title: string, problem: string): TicketDef => ({ category, title, problem, p1: false })

/** Regular tickets – each title/problem pair points unambiguously to one bin. */
export const TICKETS: readonly TicketDef[] = [
  t('vpn', 'VPN', 'Not Connecting'),
  t('vpn', 'VPN', 'Drops every 5 min'),
  t('vpn', 'VPN', 'No intranet access'),
  t('email', 'Outlook', 'Not receiving email'),
  t('email', 'Outlook', 'Mailbox full'),
  t('email', 'Email', 'Shared mailbox missing'),
  t('mfa', 'MFA', 'Not working'),
  t('mfa', 'MFA', 'New phone, no codes'),
  t('mfa', 'MFA', 'Code rejected'),
  t('printer', 'Printer', 'Not working'),
  t('printer', 'Printer', 'Queue stuck'),
  t('printer', 'Printer', 'Toner empty'),
  t('backup', 'Backup', 'Failed'),
  t('backup', 'Backup', 'Restore request'),
  t('backup', 'Backup', 'Job overdue'),
  t('ad', 'AD', 'Access issue'),
  t('ad', 'AD', 'Group missing'),
  t('ad', 'AD', 'New starter account'),
]

/** P1 CRITICAL tickets – one per category. `title` is the headline on the red card. */
export const P1_TICKETS: readonly TicketDef[] = [
  { category: 'ad', title: 'User Locked Out!', problem: 'Active Directory', p1: true },
  { category: 'vpn', title: 'VPN gateway down!', problem: 'VPN', p1: true },
  { category: 'email', title: 'Mail server down!', problem: 'Email', p1: true },
  { category: 'mfa', title: 'MFA outage!', problem: 'MFA', p1: true },
  { category: 'backup', title: 'Backup server offline!', problem: 'Backup', p1: true },
  { category: 'printer', title: 'Print server down!', problem: 'Printer', p1: true },
]

/** Tuning constants (CSS px / seconds). */
export const RULES = {
  roundSeconds: 60,
  lives: 3,
  gravity: 900,
  spawnStart: 1.6,
  spawnEnd: 0.7,
  doubleAfter: 20,
  flickMinSpeed: 600,
  flickSpeedMin: 900,
  flickSpeedMax: 2200,
  comboMax: 8,
  ticketPoints: 100,
  p1Points: 500,
  p1First: 12,
  p1EveryMin: 14,
  p1EveryMax: 20,
  p1Seconds: 5,
  maxTickets: 6,
} as const
