import { describe, it, expect, vi } from 'vitest'
import { GenerateContentResponse } from '@google/genai'
import { createCachedGeminiClient, extractGeminiText, geminiKeyParams } from '../src/adapters/gemini'
import type { IStorage, CacheEntry } from '../src/storage/IStorage'

const PARAMS = { model: 'gemini-2.5-flash', contents: 'hello' }
const RESPONSE_DATA = { candidates: [{ content: { role: 'model', parts: [{ text: 'Hi!' }] } }] }
const CHUNKS_DATA = [
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Hi' }] } }] },
  { candidates: [{ content: { role: 'model', parts: [{ text: '!' }] } }] },
]

function toResponse(data: object): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), data)
}

function makeClient(generateContent: (...args: unknown[]) => unknown, generateContentStream: (...args: unknown[]) => unknown = vi.fn()) {
  return { models: { generateContent, generateContentStream } }
}

// Simulates a persistent backend (file/sqlite/redis): values lose their prototype on the way through
function jsonStorage(): IStorage {
  const map = new Map<string, string>()
  return {
    get: async (key: string) => (map.has(key) ? (JSON.parse(map.get(key)!) as CacheEntry) : null),
    set: async (key: string, entry: CacheEntry) => { map.set(key, JSON.stringify(entry)) },
    delete: async (key: string) => { map.delete(key) },
    clear: async () => map.clear(),
  }
}

describe('createCachedGeminiClient — generateContent', () => {
  it('calls the real client on first request (cache miss)', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate))
    const result = await cached.models.generateContent(PARAMS) as GenerateContentResponse
    expect(generate).toHaveBeenCalledOnce()
    expect(result.text).toBe('Hi!')
  })

  it('returns cached response on second request (cache hit)', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate))
    await cached.models.generateContent(PARAMS)
    const result = await cached.models.generateContent(PARAMS) as GenerateContentResponse
    expect(generate).toHaveBeenCalledOnce()
    expect(result.text).toBe('Hi!')
  })

  it('restores GenerateContentResponse getters after a serializing storage roundtrip', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate), { storage: jsonStorage() })
    await cached.models.generateContent(PARAMS)
    const result = await cached.models.generateContent(PARAMS) as GenerateContentResponse
    expect(generate).toHaveBeenCalledOnce()
    expect(result).toBeInstanceOf(GenerateContentResponse)
    expect(result.text).toBe('Hi!')
  })

  it('calls real client again for different contents', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate))
    await cached.models.generateContent({ ...PARAMS, contents: 'a' })
    await cached.models.generateContent({ ...PARAMS, contents: 'b' })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('ignores transport-only config fields in the cache key', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate))
    await cached.models.generateContent({ ...PARAMS, config: { temperature: 0, httpOptions: { timeout: 1000 } } })
    await cached.models.generateContent({ ...PARAMS, config: { temperature: 0, abortSignal: new AbortController().signal } })
    expect(generate).toHaveBeenCalledOnce()
  })

  it('treats generation config as part of the cache key', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const cached = createCachedGeminiClient(makeClient(generate))
    await cached.models.generateContent({ ...PARAMS, config: { temperature: 0 } })
    await cached.models.generateContent({ ...PARAMS, config: { temperature: 1 } })
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('passes other properties of the client through untouched', () => {
    const client = { files: { list: vi.fn() }, models: { generateContent: vi.fn(), generateContentStream: vi.fn(), countTokens: vi.fn() } }
    const cached = createCachedGeminiClient(client)
    expect(cached.files).toBe(client.files)
    expect(cached.models.countTokens).toBe(client.models.countTokens)
  })
})

describe('createCachedGeminiClient — generateContentStream', () => {
  async function* mockStream() {
    for (const chunk of CHUNKS_DATA) yield toResponse(chunk)
  }

  async function collectText(stream: unknown) {
    const texts: (string | undefined)[] = []
    for await (const chunk of stream as AsyncIterable<GenerateContentResponse>) texts.push(chunk.text)
    return texts
  }

  it('streams from real client on first request', async () => {
    const stream = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedGeminiClient(makeClient(vi.fn(), stream))
    const texts = await collectText(await cached.models.generateContentStream(PARAMS))
    expect(stream).toHaveBeenCalledOnce()
    expect(texts).toEqual(['Hi', '!'])
  })

  it('replays hydrated chunks from cache on second streaming request', async () => {
    const stream = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedGeminiClient(makeClient(vi.fn(), stream), { storage: jsonStorage() })
    await collectText(await cached.models.generateContentStream(PARAMS))
    const texts = await collectText(await cached.models.generateContentStream(PARAMS))
    expect(stream).toHaveBeenCalledOnce()
    expect(texts).toEqual(['Hi', '!'])
  })

  it('does not serve a stream entry to generateContent', async () => {
    const generate = vi.fn().mockResolvedValue(toResponse(RESPONSE_DATA))
    const stream = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedGeminiClient(makeClient(generate, stream))
    await collectText(await cached.models.generateContentStream(PARAMS))
    const result = await cached.models.generateContent(PARAMS) as GenerateContentResponse
    expect(generate).toHaveBeenCalledOnce()
    expect(result.text).toBe('Hi!')
  })
})

describe('extractGeminiText', () => {
  it('handles a plain string', () => {
    expect(extractGeminiText({ contents: 'hello' })).toBe('user: hello')
  })

  it('handles a list of string parts as one user turn', () => {
    expect(extractGeminiText({ contents: ['hello ', 'world'] })).toBe('user: hello world')
  })

  it('handles multi-turn Content[]', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] },
      { role: 'user', parts: [{ text: 'how are you?' }] },
    ]
    expect(extractGeminiText({ contents })).toBe('user: hi\nmodel: hello\nuser: how are you?')
  })

  it('includes a string system instruction', () => {
    expect(extractGeminiText({ contents: 'hi', config: { systemInstruction: 'be brief' } })).toBe('system: be brief\nuser: hi')
  })

  it('includes a Content system instruction', () => {
    const config = { systemInstruction: { parts: [{ text: 'be brief' }] } }
    expect(extractGeminiText({ contents: 'hi', config })).toBe('system: be brief\nuser: hi')
  })

  it('returns undefined for non-text parts', () => {
    const contents = [{ role: 'user', parts: [{ text: 'what is this?' }, { inlineData: { mimeType: 'image/png', data: '...' } }] }]
    expect(extractGeminiText({ contents })).toBeUndefined()
  })

  it('returns undefined for missing or empty contents', () => {
    expect(extractGeminiText({})).toBeUndefined()
    expect(extractGeminiText({ contents: [] })).toBeUndefined()
  })
})

describe('geminiKeyParams', () => {
  it('returns params unchanged when there is no config', () => {
    expect(geminiKeyParams(PARAMS)).toBe(PARAMS)
  })

  it('does not mutate the caller config', () => {
    const config = { temperature: 0, httpOptions: { timeout: 1 } }
    geminiKeyParams({ ...PARAMS, config })
    expect(config.httpOptions).toEqual({ timeout: 1 })
  })
})
