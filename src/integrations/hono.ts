import type { Context, Next } from 'hono'
import { createCachedClientForProvider, type LlmProvider } from '../adapters/auto'
import { buildManager } from '../adapters/shared'
import type { LlmCacheOptions } from '../adapters/base'

const WITH_CACHE_CONTEXT_KEY = 'withCache'

type WithCache = <T extends object>(client: T, provider?: LlmProvider) => T

declare module 'hono' {
  interface ContextVariableMap {
    withCache: WithCache
  }
}

/**
 * Hono middleware that attaches `c.get('withCache')(client)` to every request.
 * Works with OpenAI, Anthropic, Gemini and Mistral clients — the SDK is detected from the
 * client's shape, or pass it explicitly: `c.get('withCache')(client, 'mistral')`.
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
    c.set(WITH_CACHE_CONTEXT_KEY, <T extends object>(client: T, provider?: LlmProvider) => createCachedClientForProvider(client, manager, provider))
    await next()
  }
}
