import { buildManager, buildCachedCreate } from './shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from './base'

const ANTHROPIC_MESSAGES_PROP = 'messages'
const ANTHROPIC_CREATE_PROP = 'create'

export function createCachedAnthropicClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  return createCachedAnthropicClientFromManager(client, buildManager(options))
}

export function createCachedAnthropicClientFromManager<T extends object>(client: T, manager: CacheManager): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== ANTHROPIC_MESSAGES_PROP) return Reflect.get(target, prop, receiver)

      const messages = Reflect.get(target, prop, receiver) as Record<string, unknown>
      return new Proxy(messages, {
        get(msgTarget, msgProp, msgReceiver) {
          if (msgProp !== ANTHROPIC_CREATE_PROP) return Reflect.get(msgTarget, msgProp, msgReceiver)

          const originalCreate = (Reflect.get(msgTarget, msgProp, msgReceiver) as (...args: unknown[]) => unknown).bind(msgTarget)
          return buildCachedCreate(originalCreate, manager)
        },
      })
    },
  })
}
