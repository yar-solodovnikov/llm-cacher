import { MemoryStorage } from '../storage/MemoryStorage'
import { FileStorage } from '../storage/FileStorage'
import { SQLiteStorage } from '../storage/SQLiteStorage'
import { CacheManager } from '../core/CacheManager'
import { KeyBuilder } from '../core/KeyBuilder'
import type { IStorage } from '../storage/IStorage'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from '../storage/IStorage'
import type { LlmCacheOptions } from './base'
import { DEFAULT_FILE_PATH, DEFAULT_SQLITE_PATH, STORAGE_TYPE_MEMORY, STORAGE_TYPE_FILE, STORAGE_TYPE_SQLITE } from '../constants'

export function resolveStorage(opts: LlmCacheOptions): IStorage {
  const s = opts.storage
  if (!s || s === STORAGE_TYPE_MEMORY) return new MemoryStorage({ maxSize: opts.maxSize })
  if (s === STORAGE_TYPE_FILE) return new FileStorage({ path: opts.storagePath ?? DEFAULT_FILE_PATH })
  if (s === STORAGE_TYPE_SQLITE) return new SQLiteStorage({ path: opts.storagePath ?? DEFAULT_SQLITE_PATH })
  return s
}

export function buildManager(options: LlmCacheOptions): CacheManager {
  return new CacheManager({
    storage: resolveStorage(options),
    ttl: options.ttl,
    onStorageError: options.onStorageError,
    semantic: options.semantic,
  })
}

export async function* replayStream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield chunk
}

export function extractText(params: Record<string, unknown>): string | undefined {
  const messages = params.messages as { role: string; content: unknown }[] | undefined
  if (!messages?.length) return undefined
  // non-string content (vision, tool results) → skip semantic indexing
  if (messages.some(m => typeof m.content !== 'string')) return undefined
  return messages.map(m => `${m.role}: ${m.content as string}`).join('\n')
}

export function buildCachedCreate(
  originalCreate: (...args: unknown[]) => unknown,
  manager: CacheManager,
) {
  return async (params: Record<string, unknown>) => {
    const key = KeyBuilder.build(params)
    const text = extractText(params)

    if (params.stream) {
      const cached = await manager.get(key, text)
      if (cached?.type === ENTRY_TYPE_STREAM && cached.chunks) return replayStream(cached.chunks)

      const stream = (await originalCreate(params)) as AsyncIterable<unknown>
      return (async function* () {
        const chunks: unknown[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
          yield chunk
        }
        await manager.set(key, { type: ENTRY_TYPE_STREAM, value: null, chunks }, text)
      })()
    }

    const cached = await manager.get(key, text)
    if (cached?.type === ENTRY_TYPE_FULL) return cached.value

    const response = await originalCreate(params)
    await manager.set(key, { type: ENTRY_TYPE_FULL, value: response }, text)
    return response
  }
}
