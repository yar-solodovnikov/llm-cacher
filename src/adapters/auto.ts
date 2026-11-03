import { createCachedClientFromManager } from './openai'
import { createCachedAnthropicClientFromManager } from './anthropic'
import { createCachedGeminiClientFromManager } from './gemini'
import { createCachedMistralClientFromManager } from './mistral'
import type { CacheManager } from '../core/CacheManager'

export const LLM_PROVIDERS = ['openai', 'anthropic', 'gemini', 'mistral'] as const
export type LlmProvider = typeof LLM_PROVIDERS[number]

const WRAPPERS: Record<LlmProvider, <T extends object>(client: T, manager: CacheManager) => T> = {
  openai: createCachedClientFromManager,
  anthropic: createCachedAnthropicClientFromManager,
  gemini: createCachedGeminiClientFromManager,
  mistral: createCachedMistralClientFromManager,
}

function hasMethod(target: unknown, path: string[]): boolean {
  let current = target
  for (const prop of path) {
    if (current == null || (typeof current !== 'object' && typeof current !== 'function')) return false
    current = (current as Record<string, unknown>)[prop]
  }
  return typeof current === 'function'
}

// Checked in order — OpenAI before Mistral, since both expose a `chat` namespace
const SIGNATURES: [LlmProvider, string[]][] = [
  ['openai', ['chat', 'completions', 'create']],
  ['mistral', ['chat', 'complete']],
  ['anthropic', ['messages', 'create']],
  ['gemini', ['models', 'generateContent']],
]

/** Detects which SDK a client comes from by the methods it exposes. */
export function detectProvider(client: object): LlmProvider | null {
  return SIGNATURES.find(([, path]) => hasMethod(client, path))?.[0] ?? null
}

/**
 * Wraps a client of any supported SDK. Pass `provider` when the client's shape is ambiguous
 * (e.g. an OpenAI-compatible SDK that also exposes other namespaces).
 */
export function createCachedClientForProvider<T extends object>(client: T, manager: CacheManager, provider?: LlmProvider): T {
  const resolved = provider ?? detectProvider(client)
  if (!resolved) {
    // passing the client through uncached would silently cost money — fail loudly instead
    throw new Error(
      `llm-cacher: could not detect the LLM SDK of this client. Pass the provider explicitly: one of ${LLM_PROVIDERS.join(', ')}`,
    )
  }
  return WRAPPERS[resolved](client, manager)
}
