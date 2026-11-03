import { buildManager, buildCachedMethod, wrapNamespaceMethods } from './shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from './base'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from '../storage/IStorage'

const MISTRAL_CHAT_PROP = 'chat'
const MISTRAL_COMPLETE_PROP = 'complete'
const MISTRAL_STREAM_PROP = 'stream'

export function createCachedMistralClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  return createCachedMistralClientFromManager(client, buildManager(options))
}

export function createCachedMistralClientFromManager<T extends object>(client: T, manager: CacheManager): T {
  return wrapNamespaceMethods(client, MISTRAL_CHAT_PROP, {
    [MISTRAL_COMPLETE_PROP]: original => buildCachedMethod(original, manager, ENTRY_TYPE_FULL),
    [MISTRAL_STREAM_PROP]: original => buildCachedMethod(original, manager, ENTRY_TYPE_STREAM),
  })
}
