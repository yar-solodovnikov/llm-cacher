import { buildManager, buildCachedCreate, passThrough } from './shared'
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
    get(target, prop) {
      if (prop !== OPENAI_CHAT_PROP) return passThrough(target, prop)

      const chat = Reflect.get(target, prop, target) as Record<string, unknown>
      return new Proxy(chat, {
        get(chatTarget, chatProp) {
          if (chatProp !== OPENAI_COMPLETIONS_PROP) return passThrough(chatTarget, chatProp)

          const completions = Reflect.get(chatTarget, chatProp, chatTarget) as Record<string, unknown>
          return new Proxy(completions, {
            get(compTarget, compProp) {
              if (compProp !== OPENAI_CREATE_PROP) return passThrough(compTarget, compProp)

              const originalCreate = (Reflect.get(compTarget, compProp, compTarget) as (...args: unknown[]) => unknown).bind(compTarget)
              return buildCachedCreate(originalCreate, manager)
            },
          })
        },
      })
    },
  })
}
