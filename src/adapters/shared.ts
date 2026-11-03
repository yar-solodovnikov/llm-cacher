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

async function* replayStream(chunks: unknown[], hydrate: Hydrate): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield await hydrate(chunk)
}

export function extractMessagesText(params: Record<string, unknown>): string | undefined {
  const messages = params.messages
  if (!Array.isArray(messages) || messages.length === 0) return undefined
  // null/non-object items or non-string content (vision, tool results) → skip semantic indexing
  if ((messages as unknown[]).some(m => m == null || typeof (m as { content: unknown }).content !== 'string')) return undefined
  return (messages as { role: string; content: string }[]).map(m => `${m.role}: ${m.content}`).join('\n')
}

type Params = Record<string, unknown>
type Hydrate = (value: unknown) => unknown
type OriginalMethod = (...args: unknown[]) => unknown

export type CacheMode = typeof ENTRY_TYPE_FULL | typeof ENTRY_TYPE_STREAM

export interface CachedMethodOptions {
  // Text used for semantic matching; undefined disables semantic lookup for the request
  extractText?: (params: Params) => string | undefined
  // Params that form the cache key — lets adapters drop transport-only fields
  keyParams?: (params: Params) => Params
  // Param holding the prompt; everything else (model, temperature, tools...) forms the semantic scope
  textField?: string
  // Restores SDK class instances from plain cached values (getters are lost after JSON roundtrip)
  hydrate?: Hydrate
}

const identity: Hydrate = value => value
const DEFAULT_TEXT_FIELD = 'messages'

// Attribution / tracking params never change the generated answer, so they must not split
// the cache — otherwise apps that pass a per-user id would get a separate cache per user.
export const TRACKING_PARAMS = ['user', 'safety_identifier', 'metadata', 'prompt_cache_key', 'store'] as const

function withoutTrackingParams(params: Params): Params {
  if (!TRACKING_PARAMS.some(field => field in params)) return params
  const rest = { ...params }
  for (const field of TRACKING_PARAMS) delete rest[field]
  return rest
}

// Semantic matches must not cross model or generation params: a prompt sent to another
// model, or with different tools / response_format, can't reuse the cached answer.
function semanticScope(keyParams: Params, textField: string): string {
  const { [textField]: _text, ...rest } = keyParams
  return KeyBuilder.build(rest)
}

// Wraps one SDK method whose mode is fixed by the method itself (e.g. Gemini's
// generateContent vs generateContentStream, Mistral's chat.complete vs chat.stream).
export function buildCachedMethod(
  originalMethod: OriginalMethod,
  manager: CacheManager,
  mode: CacheMode,
  options: CachedMethodOptions = {},
) {
  const extractText = options.extractText ?? extractMessagesText
  const hydrate = options.hydrate ?? identity
  const textField = options.textField ?? DEFAULT_TEXT_FIELD

  return async (params: Params, ...rest: unknown[]) => {
    const baseParams = withoutTrackingParams(params)
    const keyParams = options.keyParams ? options.keyParams(baseParams) : baseParams
    const key = KeyBuilder.build(keyParams)
    const text = extractText(params)
    const scope = text !== undefined ? semanticScope(keyParams, textField) : undefined

    if (mode === ENTRY_TYPE_STREAM) {
      const cached = await manager.get(key, text, scope)
      if (cached?.type === ENTRY_TYPE_STREAM && cached.chunks) return replayStream(cached.chunks, hydrate)

      const stream = (await originalMethod(params, ...rest)) as AsyncIterable<unknown>
      return (async function* () {
        const chunks: unknown[] = []
        for await (const chunk of stream) {
          chunks.push(chunk)
          yield chunk
        }
        // Storage errors after full delivery must not propagate to the consumer
        await manager.set(key, { type: ENTRY_TYPE_STREAM, value: null, chunks }, text, scope).catch(() => undefined)
      })()
    }

    const cached = await manager.get(key, text, scope)
    if (cached?.type === ENTRY_TYPE_FULL) return hydrate(cached.value)

    const response = await originalMethod(params, ...rest)
    // Storage errors must not swallow the response the caller already paid for
    await manager.set(key, { type: ENTRY_TYPE_FULL, value: response }, text, scope).catch(() => undefined)
    return response
  }
}

// OpenAI / Anthropic style: a single create() whose mode is selected by `params.stream`
export function buildCachedCreate(
  originalCreate: OriginalMethod,
  manager: CacheManager,
) {
  const full = buildCachedMethod(originalCreate, manager, ENTRY_TYPE_FULL)
  const stream = buildCachedMethod(originalCreate, manager, ENTRY_TYPE_STREAM)
  return (params: Params, ...rest: unknown[]) => (params.stream ? stream(params, ...rest) : full(params, ...rest))
}

// Proxies `client[namespace][method]` for each method in `wrappers`, passing everything else through
export function wrapNamespaceMethods<T extends object>(
  client: T,
  namespace: string,
  wrappers: Record<string, (original: OriginalMethod) => (params: Params, ...rest: unknown[]) => unknown>,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== namespace) return Reflect.get(target, prop, receiver)

      const ns = Reflect.get(target, prop, receiver) as Record<string, unknown>
      return new Proxy(ns, {
        get(nsTarget, nsProp, nsReceiver) {
          const wrap = typeof nsProp === 'string' && Object.prototype.hasOwnProperty.call(wrappers, nsProp) ? wrappers[nsProp] : undefined
          if (!wrap) return Reflect.get(nsTarget, nsProp, nsReceiver)

          const original = (Reflect.get(nsTarget, nsProp, nsReceiver) as OriginalMethod).bind(nsTarget)
          return wrap(original)
        },
      })
    },
  })
}
