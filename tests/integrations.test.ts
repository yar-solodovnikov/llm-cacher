import { describe, it, expect, vi } from 'vitest'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { Mistral } from '@mistralai/mistralai'
import { Hono } from 'hono'
import type { Request, Response } from 'express'
import { detectProvider, createCachedClientForProvider } from '../src/adapters/auto'
import { CacheManager } from '../src/core/CacheManager'
import { MemoryStorage } from '../src/storage/MemoryStorage'
import { llmCacheMiddleware as expressMiddleware } from '../src/integrations/express'
import { llmCacheMiddleware as honoMiddleware } from '../src/integrations/hono'
import { LlmCacheService, LlmCacheModule } from '../src/integrations/nestjs'

const MESSAGES = [{ role: 'user', content: 'hello' }]

function fakeClients() {
  const calls = { openai: vi.fn(), anthropic: vi.fn(), gemini: vi.fn(), mistral: vi.fn() }
  return {
    calls,
    openai: { chat: { completions: { create: async (p: unknown) => { calls.openai(p); return { choices: [] } } } } },
    anthropic: { messages: { create: async (p: unknown) => { calls.anthropic(p); return { content: [] } } } },
    gemini: { models: { generateContent: async (p: unknown) => { calls.gemini(p); return { candidates: [] } }, generateContentStream: vi.fn() } },
    mistral: { chat: { complete: async (p: unknown) => { calls.mistral(p); return { choices: [] } }, stream: vi.fn() } },
  }
}

// One request per provider, issued twice — each SDK must hit its API exactly once
async function callEachTwice(wrap: <T extends object>(client: T) => T, clients: ReturnType<typeof fakeClients>) {
  for (let i = 0; i < 2; i++) {
    await wrap(clients.openai).chat.completions.create({ model: 'gpt-4o', messages: MESSAGES })
    await wrap(clients.anthropic).messages.create({ model: 'claude-opus-4-7', max_tokens: 10, messages: MESSAGES })
    await wrap(clients.gemini).models.generateContent({ model: 'gemini-2.5-flash', contents: 'hello' })
    await wrap(clients.mistral).chat.complete({ model: 'mistral-large-latest', messages: MESSAGES })
  }
}

function expectEachCalledOnce(clients: ReturnType<typeof fakeClients>) {
  for (const call of Object.values(clients.calls)) expect(call).toHaveBeenCalledOnce()
}

describe('detectProvider', () => {
  it.each([
    ['openai', () => new OpenAI({ apiKey: 'test' })],
    ['anthropic', () => new Anthropic({ apiKey: 'test' })],
    ['gemini', () => new GoogleGenAI({ apiKey: 'test' })],
    ['mistral', () => new Mistral({ apiKey: 'test' })],
  ])('recognizes a real %s client', (provider, make) => {
    expect(detectProvider(make())).toBe(provider)
  })

  it('returns null for an unknown client', () => {
    expect(detectProvider({ completions: { create: vi.fn() } })).toBeNull()
  })

  it('does not throw on clients with null namespaces', () => {
    expect(detectProvider({ chat: null, messages: undefined })).toBeNull()
  })
})

describe('createCachedClientForProvider', () => {
  const manager = () => new CacheManager({ storage: new MemoryStorage({ sweepIntervalMs: 999_999 }) })

  it('throws for an unknown client instead of passing it through uncached', () => {
    expect(() => createCachedClientForProvider({ foo: {} }, manager())).toThrow(/could not detect/)
  })

  it('uses an explicit provider over detection', async () => {
    // exposes both shapes; explicit 'anthropic' must win over the detected 'openai'
    const create = vi.fn().mockResolvedValue({})
    const client = { chat: { completions: { create: vi.fn() } }, messages: { create } }
    const cached = createCachedClientForProvider(client, manager(), 'anthropic')
    await cached.messages.create({ model: 'm', messages: MESSAGES })
    await cached.messages.create({ model: 'm', messages: MESSAGES })
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('Express integration', () => {
  it('caches every supported SDK through req.withCache', async () => {
    const middleware = expressMiddleware()
    const clients = fakeClients()
    const req = {} as Request
    const next = vi.fn()
    middleware(req, {} as Response, next)
    expect(next).toHaveBeenCalledOnce()
    await callEachTwice(client => req.withCache(client), clients)
    expectEachCalledOnce(clients)
  })

  it('shares the cache across requests', async () => {
    const middleware = expressMiddleware()
    const create = vi.fn().mockResolvedValue({ content: [] })
    for (let i = 0; i < 2; i++) {
      const req = {} as Request
      middleware(req, {} as Response, vi.fn())
      await req.withCache({ messages: { create } }).messages.create({ model: 'm', messages: MESSAGES })
    }
    expect(create).toHaveBeenCalledOnce()
  })
})

describe('Hono integration', () => {
  it('caches every supported SDK through c.get("withCache") across requests', async () => {
    const clients = fakeClients()
    const app = new Hono()
    app.use(honoMiddleware())
    app.post('/chat', async (c) => {
      const withCache = c.get('withCache')
      await withCache(clients.openai).chat.completions.create({ model: 'gpt-4o', messages: MESSAGES })
      await withCache(clients.anthropic).messages.create({ model: 'claude-opus-4-7', max_tokens: 10, messages: MESSAGES })
      await withCache(clients.gemini).models.generateContent({ model: 'gemini-2.5-flash', contents: 'hello' })
      await withCache(clients.mistral).chat.complete({ model: 'mistral-large-latest', messages: MESSAGES })
      return c.json({ ok: true })
    })

    expect((await app.request('/chat', { method: 'POST' })).status).toBe(200)
    expect((await app.request('/chat', { method: 'POST' })).status).toBe(200)
    expectEachCalledOnce(clients)
  })

  it('surfaces an unknown client as an error', async () => {
    const app = new Hono()
    app.use(honoMiddleware())
    app.get('/', (c) => c.json(c.get('withCache')({ foo: {} })))
    expect((await app.request('/')).status).toBe(500)
  })
})

describe('NestJS integration', () => {
  it('LlmCacheService.wrap caches every supported SDK', async () => {
    const service = new LlmCacheService({})
    const clients = fakeClients()
    await callEachTwice(client => service.wrap(client), clients)
    expectEachCalledOnce(clients)
  })

  it('LlmCacheService.wrap accepts an explicit provider', async () => {
    const service = new LlmCacheService({})
    const complete = vi.fn().mockResolvedValue({})
    const cached = service.wrap({ chat: { complete, stream: vi.fn() } }, 'mistral')
    await cached.chat.complete({ model: 'm', messages: MESSAGES })
    await cached.chat.complete({ model: 'm', messages: MESSAGES })
    expect(complete).toHaveBeenCalledOnce()
  })

  it('forRoot registers a global module exporting the service', () => {
    const mod = LlmCacheModule.forRoot({ ttl: '1h' })
    expect(mod.global).toBe(true)
    expect(mod.exports).toContain(LlmCacheService)
  })
})
