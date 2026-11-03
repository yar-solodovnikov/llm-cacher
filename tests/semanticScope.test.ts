import { describe, it, expect, vi } from 'vitest'
import { createCachedClient } from '../src/adapters/openai'
import { createCachedAnthropicClient } from '../src/adapters/anthropic'
import { createCachedGeminiClient } from '../src/adapters/gemini'
import type { IEmbedder } from '../src/embeddings/IEmbedder'

// Paraphrases embed to near-identical vectors, so any lookup across them is a semantic hit candidate
function paraphraseEmbedder(): IEmbedder {
  return {
    dimensions: 3,
    embed: vi.fn(async (text: string) => [1, 0.001 * text.length, 0]),
  }
}

const semantic = () => ({ embedder: paraphraseEmbedder(), threshold: 0.9 })
const ASK = [{ role: 'user', content: 'what is async/await?' }]
const PARAPHRASE = [{ role: 'user', content: 'explain async/await' }]

function openaiClient() {
  const create = vi.fn(async (params: Record<string, unknown>) => ({ model: params.model }))
  return { create, client: { chat: { completions: { create } } } }
}

describe('semantic scope — OpenAI', () => {
  it('still matches a paraphrase with the same model and params', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: semantic() })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: ASK })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE })
    expect(create).toHaveBeenCalledOnce()
  })

  it('does not serve a paraphrase across models', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: semantic() })
    await cached.chat.completions.create({ model: 'gpt-4o-mini', messages: ASK })
    const result = await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE })
    expect(create).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ model: 'gpt-4o' })
  })

  it('does not serve a plain-text answer to a structured-output request', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: semantic() })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: ASK })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE, response_format: { type: 'json_object' } })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not match across different tools', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: semantic() })
    const tool = (name: string) => [{ type: 'function', function: { name, parameters: {} } }]
    await cached.chat.completions.create({ model: 'gpt-4o', messages: ASK, tools: tool('a') })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE, tools: tool('b') })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not match across temperature', async () => {
    const { create, client } = openaiClient()
    const cached = createCachedClient(client, { semantic: semantic() })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: ASK, temperature: 0 })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE, temperature: 1 })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('shares the scope between streaming and non-streaming requests', async () => {
    async function* chunks() { yield { choices: [] } }
    const create = vi.fn(async (params: Record<string, unknown>) => (params.stream ? chunks() : { choices: [] }))
    const cached = createCachedClient({ chat: { completions: { create } } }, { semantic: semantic() })
    for await (const _ of await cached.chat.completions.create({ model: 'gpt-4o', messages: ASK, stream: true }) as AsyncIterable<unknown>) { /* consume */ }
    for await (const _ of await cached.chat.completions.create({ model: 'gpt-4o', messages: PARAPHRASE, stream: true }) as AsyncIterable<unknown>) { /* consume */ }
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('semantic scope — Anthropic', () => {
  it('does not match across different system prompts', async () => {
    const create = vi.fn().mockResolvedValue({ content: [] })
    const cached = createCachedAnthropicClient({ messages: { create } }, { semantic: semantic() })
    const base = { model: 'claude-opus-4-7', max_tokens: 100 }
    await cached.messages.create({ ...base, system: 'Answer in English', messages: ASK })
    await cached.messages.create({ ...base, system: 'Answer in Ukrainian', messages: PARAPHRASE })
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('semantic scope — Gemini', () => {
  function geminiClient() {
    const generateContent = vi.fn().mockResolvedValue({ candidates: [] })
    return { generateContent, client: { models: { generateContent, generateContentStream: vi.fn() } } }
  }

  it('matches a paraphrase with the same model', async () => {
    const { generateContent, client } = geminiClient()
    const cached = createCachedGeminiClient(client, { semantic: semantic() })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'what is async/await?' })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'explain async/await' })
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('does not serve a paraphrase across models', async () => {
    const { generateContent, client } = geminiClient()
    const cached = createCachedGeminiClient(client, { semantic: semantic() })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'what is async/await?' })
    await cached.models.generateContent({ model: 'gemini-2.5-pro', contents: 'explain async/await' })
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('ignores transport-only config when scoping', async () => {
    const { generateContent, client } = geminiClient()
    const cached = createCachedGeminiClient(client, { semantic: semantic() })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'what is async/await?' })
    await cached.models.generateContent({ model: 'gemini-2.5-flash', contents: 'explain async/await', config: { httpOptions: { timeout: 1 } } })
    expect(generateContent).toHaveBeenCalledOnce()
  })
})
