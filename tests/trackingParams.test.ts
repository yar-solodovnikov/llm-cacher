import { describe, it, expect, vi } from 'vitest'
import { createCachedClient } from '../src/adapters/openai'
import { createCachedAnthropicClient } from '../src/adapters/anthropic'
import { createCachedGeminiClient } from '../src/adapters/gemini'
import type { IEmbedder } from '../src/embeddings/IEmbedder'

const MESSAGES = [{ role: 'user', content: 'hello' }]

function openaiClient() {
  const create = vi.fn().mockResolvedValue({ choices: [] })
  return { create, client: { chat: { completions: { create } } } }
}

describe('tracking params are not part of the cache key', () => {
  it.each([
    ['user', { user: 'user-1' }, { user: 'user-2' }],
    ['safety_identifier', { safety_identifier: 'a' }, { safety_identifier: 'b' }],
    ['metadata', { metadata: { session: '1' } }, { metadata: { session: '2' } }],
    ['prompt_cache_key', { prompt_cache_key: 'a' }, { prompt_cache_key: 'b' }],
    ['store', { store: true }, {}],
  ])('OpenAI: requests differing only in `%s` share a cache entry', async (_name, a, b) => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client)
    await cached.chat.completions.create({ model: 'gpt-4o', messages: MESSAGES, ...a })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: MESSAGES, ...b })
    expect(create).toHaveBeenCalledOnce()
  })

  it('OpenAI: still forwards tracking params to the API', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client)
    const params = { model: 'gpt-4o', messages: MESSAGES, user: 'user-1' }
    await cached.chat.completions.create(params)
    expect(create).toHaveBeenCalledWith(params)
  })

  it('Anthropic: requests differing only in metadata.user_id share a cache entry', async () => {
    const create = vi.fn().mockResolvedValue({ content: [] })
    const cached = createCachedAnthropicClient({ messages: { create } })
    const base = { model: 'claude-opus-4-7', max_tokens: 100, messages: MESSAGES }
    await cached.messages.create({ ...base, metadata: { user_id: 'a' } })
    await cached.messages.create({ ...base, metadata: { user_id: 'b' } })
    expect(create).toHaveBeenCalledOnce()
  })

  it('Gemini: requests differing only in config.labels share a cache entry', async () => {
    const generateContent = vi.fn().mockResolvedValue({ candidates: [] })
    const cached = createCachedGeminiClient({ models: { generateContent, generateContentStream: vi.fn() } })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'hi', config: { labels: { team: 'a' } } })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'hi', config: { labels: { team: 'b' } } })
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('semantic matches cross users', async () => {
    const embedder: IEmbedder = { dimensions: 3, embed: vi.fn(async () => [1, 0, 0]) }
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: { embedder, threshold: 0.9 } })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'what is async/await?' }], user: 'a' })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'explain async/await' }], user: 'b' })
    expect(create).toHaveBeenCalledOnce()
  })

  it('output-affecting params still split the cache', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client)
    await cached.chat.completions.create({ model: 'gpt-4o', messages: MESSAGES, user: 'a', temperature: 0 })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: MESSAGES, user: 'a', temperature: 1 })
    expect(create).toHaveBeenCalledTimes(2)
  })
})
