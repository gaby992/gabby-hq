import type { Company } from '@/types'

/**
 * Chelsea's manual tasks are ordinary rows in `tasks` whose company is the one
 * named "Chelsea" — there is no separate table and no flag column. The link is
 * the company *name*, so Gabby can create (or rename) it in Settings without a
 * migration; nothing here writes to the inbox-IM schema.
 */
export const CHELSEA_COMPANY_NAME = 'Chelsea'

/** The "Chelsea" company, matched by name case-insensitively. */
export function findChelseaCompany(companies: Company[]): Company | undefined {
  const target = CHELSEA_COMPANY_NAME.toLowerCase()
  return companies.find((c) => c.name.trim().toLowerCase() === target)
}

/** Shown wherever the section depends on that company existing. */
export const CHELSEA_MISSING_HINT = 'Crea la empresa Chelsea en Settings'
