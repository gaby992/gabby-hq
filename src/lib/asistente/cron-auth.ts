// Vercel Cron calls the route with `Authorization: Bearer ${CRON_SECRET}` as
// long as that env var exists in the project. Manual tests (`?test=1`) must
// send the exact same header — there is no second door.

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[asistente] CRON_SECRET no está definido — se rechaza todo')
    return false
  }
  const header = request.headers.get('authorization') ?? ''
  return header === `Bearer ${secret}`
}
