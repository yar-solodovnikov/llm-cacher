import { buildManager, buildCachedCreate } from './shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from './base'

const OPENAI_CHAT_PROP = 'chat'
const OPENAI_COMPLETIONS_PROP = 'completions'
const OPENAI_CREATE_PROP = 'create'

export function createCachedClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  return createCachedClientFromManager(client, buildManager(options))
}

export function createCachedClientFromManager<T extends object>(client: T, manager: CacheManager): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== OPENAI_CHAT_PROP) return Reflect.get(target, prop, receiver)

      const chat = Reflect.get(target, prop, receiver) as Record<string, unknown>
      return new Proxy(chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== OPENAI_COMPLETIONS_PROP) return Reflect.get(chatTarget, chatProp, chatReceiver)

          const completions = Reflect.get(chatTarget, chatProp, chatReceiver) as Record<string, unknown>
          return new Proxy(completions, {
            get(compTarget, compProp, compReceiver) {
              if (compProp !== OPENAI_CREATE_PROP) return Reflect.get(compTarget, compProp, compReceiver)

              const originalCreate = (Reflect.get(compTarget, compProp, compReceiver) as (...args: unknown[]) => unknown).bind(compTarget)
              return buildCachedCreate(originalCreate, manager)
            },
          })
        },
      })
    },
  })
}
