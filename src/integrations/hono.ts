import type { Context, Next } from 'hono'
import { createCachedClientFromManager } from '../adapters/openai'
import { buildManager } from '../adapters/shared'
import type { LlmCacheOptions } from '../adapters/base'

const WITH_CACHE_CONTEXT_KEY = 'withCache'

type WithCache = <T extends object>(client: T) => T

declare module 'hono' {
  interface ContextVariableMap {
    withCache: WithCache
  }
}

/**
 * Hono middleware that attaches `c.get('withCache')(client)` to every request.
 *
 * @example
 * app.use(llmCacheMiddleware({ ttl: '24h', storage: 'memory' }))
 *
 * app.post('/chat', async (c) => {
 *   const openai = c.get('withCache')(new OpenAI())
 *   const response = await openai.chat.completions.create({ ... })
 *   return c.json(response)
 * })
 */
export function llmCacheMiddleware(options: LlmCacheOptions = {}) {
  const manager = buildManager(options)
  return async (c: Context, next: Next): Promise<void> => {
    c.set(WITH_CACHE_CONTEXT_KEY, <T extends object>(client: T) => createCachedClientFromManager(client, manager))
    await next()
  }
}
