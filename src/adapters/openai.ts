import { MemoryStorage } from '../storage/MemoryStorage'
import { CacheManager } from '../core/CacheManager'
import { KeyBuilder } from '../core/KeyBuilder'
import type { IStorage } from '../storage/IStorage'
import type { LlmCacheOptions } from './base'

function resolveStorage(opts: LlmCacheOptions): IStorage {
  if (!opts.storage || opts.storage === 'memory') {
    return new MemoryStorage({ maxSize: opts.maxSize })
  }
  return opts.storage
}

async function* replayStream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk
  }
}

function buildCachedCreate(
  originalCreate: (...args: unknown[]) => unknown,
  manager: CacheManager,
) {
  return async (params: Record<string, unknown>) => {
    const key = KeyBuilder.build(params)

    if (params.stream) {
      const cached = await manager.get(key)
      if (cached?.type === 'stream' && cached.chunks) {
        return replayStream(cached.chunks)
      }

      const stream = (await originalCreate(params)) as AsyncIterable<unknown>

      // Intercept the stream: yield chunks to caller while accumulating for cache
      return (async function* () {
        const chunks: unknown[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
          yield chunk
        }
        await manager.set(key, { type: 'stream', value: null, chunks })
      })()
    }

    const cached = await manager.get(key)
    if (cached?.type === 'full') return cached.value

    const response = await originalCreate(params)
    await manager.set(key, { type: 'full', value: response })
    return response
  }
}

export function createCachedClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  const storage = resolveStorage(options)
  const manager = new CacheManager({
    storage,
    ttl: options.ttl,
    onStorageError: options.onStorageError,
  })

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'chat') return Reflect.get(target, prop, receiver)

      const chat = Reflect.get(target, prop, receiver) as Record<string, unknown>
      return new Proxy(chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== 'completions') return Reflect.get(chatTarget, chatProp, chatReceiver)

          const completions = Reflect.get(chatTarget, chatProp, chatReceiver) as Record<string, unknown>
          return new Proxy(completions, {
            get(compTarget, compProp, compReceiver) {
              if (compProp !== 'create') return Reflect.get(compTarget, compProp, compReceiver)

              const originalCreate = (Reflect.get(compTarget, compProp, compReceiver) as (...args: unknown[]) => unknown).bind(compTarget)
              return buildCachedCreate(originalCreate, manager)
            },
          })
        },
      })
    },
  })
}
