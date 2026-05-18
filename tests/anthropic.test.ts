import { describe, it, expect, vi } from 'vitest'
import { createCachedAnthropicClient } from '../src/adapters/anthropic'

const PARAMS = {
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hello' }],
}
const RESPONSE = { id: 'msg-1', content: [{ type: 'text', text: 'Hi!' }] }
const CHUNKS = [
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } },
]

function makeClient(createFn: (...args: unknown[]) => unknown) {
  return { messages: { create: createFn } }
}

describe('createCachedAnthropicClient — full responses', () => {
  it('calls the real client on first request (cache miss)', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedAnthropicClient(makeClient(create))
    const result = await cached.messages.create(PARAMS)
    expect(create).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('returns cached response on second request (cache hit)', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedAnthropicClient(makeClient(create))
    await cached.messages.create(PARAMS)
    const result = await cached.messages.create(PARAMS)
    expect(create).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('calls real client again for different params', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedAnthropicClient(makeClient(create))
    await cached.messages.create({ ...PARAMS, messages: [{ role: 'user', content: 'a' }] })
    await cached.messages.create({ ...PARAMS, messages: [{ role: 'user', content: 'b' }] })
    expect(create).toHaveBeenCalledTimes(2)
  })
})

describe('createCachedAnthropicClient — streaming', () => {
  async function* mockStream() {
    for (const chunk of CHUNKS) yield chunk
  }

  it('streams from real client on first request', async () => {
    const create = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedAnthropicClient(makeClient(create))
    const stream = await cached.messages.create({ ...PARAMS, stream: true })
    const collected = []
    for await (const chunk of stream) collected.push(chunk)
    expect(create).toHaveBeenCalledOnce()
    expect(collected).toEqual(CHUNKS)
  })

  it('replays from cache on second streaming request', async () => {
    const create = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedAnthropicClient(makeClient(create))

    const s1 = await cached.messages.create({ ...PARAMS, stream: true })
    for await (const _ of s1) { /* consume */ }

    const s2 = await cached.messages.create({ ...PARAMS, stream: true })
    const collected = []
    for await (const chunk of s2) collected.push(chunk)

    expect(create).toHaveBeenCalledOnce()
    expect(collected).toEqual(CHUNKS)
  })
})

describe('createCachedAnthropicClient — storage passthrough', () => {
  it('falls through to LLM when storage throws', async () => {
    const create = vi.fn().mockResolvedValue(RESPONSE)
    const brokenStorage = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      delete: vi.fn(),
      clear: vi.fn(),
    }
    const cached = createCachedAnthropicClient(makeClient(create), {
      storage: brokenStorage,
      onStorageError: 'passthrough',
    })
    const result = await cached.messages.create(PARAMS)
    expect(result).toEqual(RESPONSE)
  })
})
