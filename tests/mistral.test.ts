import { describe, it, expect, vi } from 'vitest'
import { createCachedMistralClient } from '../src/adapters/mistral'

const PARAMS = { model: 'mistral-large-latest', messages: [{ role: 'user', content: 'hello' }] }
const RESPONSE = { id: 'cmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: 'Hi!' } }] }
const EVENTS = [
  { data: { id: 'cmpl-1', choices: [{ index: 0, delta: { content: 'Hi' } }] } },
  { data: { id: 'cmpl-1', choices: [{ index: 0, delta: { content: '!' } }] } },
]

function makeClient(complete: (...args: unknown[]) => unknown, stream: (...args: unknown[]) => unknown = vi.fn()) {
  return { chat: { complete, stream } }
}

describe('createCachedMistralClient — chat.complete', () => {
  it('calls the real client on first request (cache miss)', async () => {
    const complete = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedMistralClient(makeClient(complete))
    const result = await cached.chat.complete(PARAMS)
    expect(complete).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('returns cached response on second request (cache hit)', async () => {
    const complete = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedMistralClient(makeClient(complete))
    await cached.chat.complete(PARAMS)
    const result = await cached.chat.complete(PARAMS)
    expect(complete).toHaveBeenCalledOnce()
    expect(result).toEqual(RESPONSE)
  })

  it('calls real client again for different params', async () => {
    const complete = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedMistralClient(makeClient(complete))
    await cached.chat.complete({ ...PARAMS, messages: [{ role: 'user', content: 'a' }] })
    await cached.chat.complete({ ...PARAMS, messages: [{ role: 'user', content: 'b' }] })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('forwards request options to the real client', async () => {
    const complete = vi.fn().mockResolvedValue(RESPONSE)
    const cached = createCachedMistralClient(makeClient(complete))
    const options = { timeoutMs: 5000 }
    await cached.chat.complete(PARAMS, options)
    expect(complete).toHaveBeenCalledWith(PARAMS, options)
  })

  it('keeps `this` bound for class-based SDK methods', async () => {
    class Chat {
      private readonly response = RESPONSE
      async complete(_params: unknown) { return this.response }
      async stream(_params: unknown) { return [] }
    }
    const cached = createCachedMistralClient({ chat: new Chat() })
    await expect(cached.chat.complete(PARAMS)).resolves.toEqual(RESPONSE)
  })
})

describe('createCachedMistralClient — chat.stream', () => {
  async function* mockStream() {
    for (const event of EVENTS) yield event
  }

  it('streams from real client on first request', async () => {
    const stream = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedMistralClient(makeClient(vi.fn(), stream))
    const collected = []
    for await (const event of (await cached.chat.stream(PARAMS)) as AsyncIterable<unknown>) collected.push(event)
    expect(stream).toHaveBeenCalledOnce()
    expect(collected).toEqual(EVENTS)
  })

  it('replays from cache on second streaming request', async () => {
    const stream = vi.fn().mockResolvedValue(mockStream())
    const cached = createCachedMistralClient(makeClient(vi.fn(), stream))

    for await (const _ of (await cached.chat.stream(PARAMS)) as AsyncIterable<unknown>) { /* consume */ }

    const collected = []
    for await (const event of (await cached.chat.stream(PARAMS)) as AsyncIterable<unknown>) collected.push(event)

    expect(stream).toHaveBeenCalledOnce()
    expect(collected).toEqual(EVENTS)
  })
})

describe('createCachedMistralClient — storage passthrough', () => {
  it('falls through to LLM when storage throws', async () => {
    const complete = vi.fn().mockResolvedValue(RESPONSE)
    const brokenStorage = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      delete: vi.fn(),
      clear: vi.fn(),
    }
    const cached = createCachedMistralClient(makeClient(complete), {
      storage: brokenStorage,
      onStorageError: 'passthrough',
    })
    const result = await cached.chat.complete(PARAMS)
    expect(result).toEqual(RESPONSE)
  })
})
