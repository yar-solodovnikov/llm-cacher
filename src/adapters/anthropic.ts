import { buildManager, buildCachedCreate, wrapNamespaceMethods } from './shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from './base'

const ANTHROPIC_MESSAGES_PROP = 'messages'
const ANTHROPIC_CREATE_PROP = 'create'

export function createCachedAnthropicClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  return createCachedAnthropicClientFromManager(client, buildManager(options))
}

export function createCachedAnthropicClientFromManager<T extends object>(client: T, manager: CacheManager): T {
  return wrapNamespaceMethods(client, ANTHROPIC_MESSAGES_PROP, {
    [ANTHROPIC_CREATE_PROP]: original => buildCachedCreate(original, manager),
  })
}
