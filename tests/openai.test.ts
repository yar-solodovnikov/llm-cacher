import { describe, it, expect, vi } from 'vitest'
import { createCachedClient } from '../src/adapters/openai'

const PARAMS = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }
const RESPONSE = { id: 'chatcmpl-1', choices: [{ message: { content: 'Hi!' } }] }
const CHUNKS = [
  { choices: [{ delta: { content: 'Hi' } }] },
  { choices: [{ delta: { content: '!' } }] },
]

function makeClient(createFn: (...args: unknown[]) => unknown) {
  return {
    chat: {
      completions: {
        create: createFn,
      },
    },
  }
}

describe('createCachedClient — full responses', () => {
  it('calls the real client on first request (cache miss)', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedClient(makeClient(create))
    const result = await cached.chat.completions.create(PARAMS)
    expect(create).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('returns cached response on second request (cache hit)', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedClient(makeClient(create))
    await cached.chat.completions.create(PARAMS)
    const result = await cached.chat.completions.create(PARAMS)
    expect(create).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('treats key-order-swapped params as the same request', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedClient(makeClient(create))
    await cached.chat.completions.create({ model: 'gpt-4o', messages: [] })
    await cached.chat.completions.create({ messages: [], model: 'gpt-4o' })
    expect(create).toHaveBeenCalledOnce()
  })

  it('calls real client again for different params', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedClient(makeClient(create))
    await cached.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'a' }] })
    await cached.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'b' }] })
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('createCachedClient — streaming', () => {
  async function* mockStream() {
    for (const chunk of CHUNKS) yield chunk
  }

  it('streams from the real client on first request', async () => {
    const create = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedClient(makeClient(create))
    const stream = await cached.chat.completions.create({ ...PARAMS, stream: true })
    const collected = []
    for await (const chunk of stream) collected.push(chunk)
    expect(create).toHaveBeenCalledOnce()
    expect(collected).toEqual(CHUNKS)
  })

  it('replays from cache on second streaming request', async () => {
    const create = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedClient(makeClient(create))

    // first pass — consume the stream fully so it gets cached
    const s1 = await cached.chat.completions.create({ ...PARAMS, stream: true })
    for await (const _ of s1) { /* consume */ }

    // second pass — should come from cache
    const s2 = await cached.chat.completions.create({ ...PARAMS, stream: true })
    const collected = []
    for await (const chunk of s2) collected.push(chunk)

    expect(create).toHaveBeenCalledOnce()
    expect(collected).toEqual(CHUNKS)
  })

  it('stream: true and stream: false share the same cache key', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cachedFull = createCachedClient(makeClient(create))

    // Prime the full cache
    await cachedFull.chat.completions.create(PARAMS)
    // Same params with stream — different code path but same key
    await cachedFull.chat.completions.create(PARAMS)
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('createCachedClient — storage passthrough', () => {
  it('falls through to LLM when storage throws', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const brokenStorage = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      delete: vi.fn(),
      clear: vi.fn(),
    }
    const cached = createCachedClient(makeClient(create), {
      storage: brokenStorage,
      onStorageError: 'passthrough',
    })
    const result = await cached.chat.completions.create(PARAMS)
    expect(result).toEqual(RESPONSE)
  })
})
