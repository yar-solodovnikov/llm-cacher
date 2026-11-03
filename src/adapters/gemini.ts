import { buildManager, buildCachedMethod, wrapNamespaceMethods } from './shared'
import type { CacheManager } from '../core/CacheManager'
import type { LlmCacheOptions } from './base'
import { ENTRY_TYPE_FULL, ENTRY_TYPE_STREAM } from '../storage/IStorage'
import { importOptional } from '../utils/optionalDeps'

const GEMINI_MODELS_PROP = 'models'
const GEMINI_GENERATE_PROP = 'generateContent'
const GEMINI_GENERATE_STREAM_PROP = 'generateContentStream'
const GEMINI_SDK_MODULE = '@google/genai'
const GEMINI_TEXT_FIELD = 'contents'
const DEFAULT_ROLE = 'user'

// Transport-only config fields — must not split the cache key
const NON_KEY_CONFIG_FIELDS = ['abortSignal', 'httpOptions'] as const

type Params = Record<string, unknown>
type Part = { text?: unknown }
type Content = { role?: unknown; parts?: unknown }

export function createCachedGeminiClient<T extends object>(client: T, options: LlmCacheOptions = {}): T {
  return createCachedGeminiClientFromManager(client, buildManager(options))
}

export function createCachedGeminiClientFromManager<T extends object>(client: T, manager: CacheManager): T {
  const methodOptions = {
    extractText: extractGeminiText,
    keyParams: geminiKeyParams,
    textField: GEMINI_TEXT_FIELD,
    hydrate: hydrateGeminiResponse,
  }
  return wrapNamespaceMethods(client, GEMINI_MODELS_PROP, {
    [GEMINI_GENERATE_PROP]: original => buildCachedMethod(original, manager, ENTRY_TYPE_FULL, methodOptions),
    [GEMINI_GENERATE_STREAM_PROP]: original => buildCachedMethod(original, manager, ENTRY_TYPE_STREAM, methodOptions),
  })
}

export function geminiKeyParams(params: Params): Params {
  const config = params.config
  if (config == null || typeof config !== 'object') return params
  const rest = { ...(config as Params) }
  for (const field of NON_KEY_CONFIG_FIELDS) delete rest[field]
  // A config left empty must hash the same as no config at all
  if (Object.keys(rest).length === 0) {
    const { config: _config, ...withoutConfig } = params
    return withoutConfig
  }
  return { ...params, config: rest }
}

function partsText(parts: unknown): string | undefined {
  const list = Array.isArray(parts) ? parts : [parts]
  if (list.length === 0) return undefined
  const texts: string[] = []
  for (const part of list) {
    if (typeof part === 'string') texts.push(part)
    // non-text parts (inline data, function calls) → skip semantic indexing
    else if (part != null && typeof (part as Part).text === 'string') texts.push((part as Part).text as string)
    else return undefined
  }
  return texts.join('')
}

function isContent(value: unknown): value is Content {
  return value != null && typeof value === 'object' && 'parts' in value
}

// `contents` accepts a string, a Part, a Content, or arrays of Parts/Contents
export function extractGeminiText(params: Params): string | undefined {
  const contents = params.contents
  if (contents == null) return undefined

  const lines: string[] = []
  const system = (params.config as { systemInstruction?: unknown } | undefined)?.systemInstruction
  if (system != null) {
    const text = isContent(system) ? partsText(system.parts) : partsText(system)
    if (text === undefined) return undefined
    lines.push(`system: ${text}`)
  }

  const list = Array.isArray(contents) ? contents : [contents]
  if (list.length === 0) return undefined

  if (list.every(isContent)) {
    for (const content of list) {
      const text = partsText(content.parts)
      if (text === undefined) return undefined
      lines.push(`${typeof content.role === 'string' ? content.role : DEFAULT_ROLE}: ${text}`)
    }
  } else {
    // a bare list of parts is a single user turn
    const text = partsText(list)
    if (text === undefined) return undefined
    lines.push(`${DEFAULT_ROLE}: ${text}`)
  }

  return lines.join('\n')
}

type ResponseClass = new () => object
let responseClassPromise: Promise<ResponseClass | null> | null = null

function loadResponseClass(): Promise<ResponseClass | null> {
  responseClassPromise ??= importOptional<{ GenerateContentResponse?: ResponseClass }>(GEMINI_SDK_MODULE)
    .then(mod => mod.GenerateContentResponse ?? null)
    .catch(() => null)
  return responseClassPromise
}

// GenerateContentResponse exposes `.text`, `.functionCalls` etc. as getters, which do not
// survive serialization — rebuild the instance so cached responses behave like live ones.
export async function hydrateGeminiResponse(value: unknown): Promise<unknown> {
  if (value == null || typeof value !== 'object') return value
  const ResponseClass = await loadResponseClass()
  if (!ResponseClass || value instanceof ResponseClass) return value
  return Object.assign(new ResponseClass(), value)
}
