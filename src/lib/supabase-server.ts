import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client for server code (routes, crons, the bot). Every request
 * goes out with `cache: 'no-store'`: Next.js 14 patches the global `fetch`
 * and, inside a Route Handler that only exports GET (the crons), it keeps
 * the response in its Data Cache indefinitely — even with `dynamic =
 * 'force-dynamic'`, because that setting only skips static rendering and
 * `request.headers` on the raw Request does not mark the route dynamic.
 * That is how the 8:00 list kept showing tasks closed days before (3 nov 2026).
 */
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { fetch: fetchSinCache } }
  )
}

/** `fetch` that never touches the Next.js Data Cache. Use it for any read of an external API. */
export function fetchSinCache(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: 'no-store' })
}
