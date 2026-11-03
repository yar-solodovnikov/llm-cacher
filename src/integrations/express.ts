import type { Request, Response, NextFunction } from 'express'
import { createCachedClientForProvider, type LlmProvider } from '../adapters/auto'
import { buildManager } from '../adapters/shared'
import type { LlmCacheOptions } from '../adapters/base'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      withCache: <T extends object>(client: T, provider?: LlmProvider) => T
    }
  }
}

/**
 * Express middleware that attaches `req.withCache(client)` to every request.
 * Works with OpenAI, Anthropic, Gemini and Mistral clients — the SDK is detected from the
 * client's shape, or pass it explicitly: `req.withCache(client, 'mistral')`.
 *
 * @example
 * app.use(llmCacheMiddleware({ ttl: '24h', storage: 'memory' }))
 *
 * app.post('/chat', async (req, res) => {
 *   const openai = req.withCache(new OpenAI())
 *   const response = await openai.chat.completions.create({ ... })
 *   res.json(response)
 * })
 */
export function llmCacheMiddleware(options: LlmCacheOptions = {}) {
  const manager = buildManager(options)
  return (_req: Request, _res: Response, next: NextFunction): void => {
    _req.withCache = <T extends object>(client: T, provider?: LlmProvider) => createCachedClientForProvider(client, manager, provider)
    next()
  }
}
