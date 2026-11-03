import { describe, it, expect, vi } from 'vitest'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { createCachedClient } from '../src/adapters/openai'
import { createCachedAnthropicClient } from '../src/adapters/anthropic'

// Real SDK clients over a fake fetch — exercises the SDKs' own helper methods end to end

function sse(events: { event?: string; data: unknown }[]): Response {
  const body = events.map(e => `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}

const ANTHROPIC_MESSAGE = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-4-7',
  content: [{ type: 'text', text: 'Hi!' }], stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}

function anthropicStreamEvents() {
  return [
    { event: 'message_start', data: { type: 'message_start', message: { ...ANTHROPIC_MESSAGE, content: [] } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi!' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]
}

const OPENAI_COMPLETION = {
  id: 'chatcmpl-1', object: 'chat.completion', created: 0, model: 'gpt-4o',
  choices: [{ index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'Hi!', refusal: null } }],
}

const PARAMS = { model: 'claude-opus-4-7', max_tokens: 10, messages: [{ role: 'user' as const, content: 'hello' }] }

describe('Anthropic SDK helpers on a cached client', () => {
  it('messages.stream() works (runs uncached against the real client)', async () => {
    const fetch = vi.fn(async () => sse(anthropicStreamEvents()))
    const cached = createCachedAnthropicClient(new Anthropic({ apiKey: 'test', fetch }))
    const message = await cached.messages.stream(PARAMS).finalMessage()
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'Hi!' })
  })

  it('messages.create() is still cached', async () => {
    const fetch = vi.fn(async () => json(ANTHROPIC_MESSAGE))
    const cached = createCachedAnthropicClient(new Anthropic({ apiKey: 'test', fetch }))
    await cached.messages.create(PARAMS)
    const second = await cached.messages.create(PARAMS)
    expect(fetch).toHaveBeenCalledOnce()
    expect(second.content[0]).toMatchObject({ type: 'text', text: 'Hi!' })
  })
})

describe('OpenAI SDK helpers on a cached client', () => {
  const messages = [{ role: 'user' as const, content: 'hello' }]

  it('chat.completions.parse() works', async () => {
    const fetch = vi.fn(async () => json(OPENAI_COMPLETION))
    const cached = createCachedClient(new OpenAI({ apiKey: 'test', fetch }))
    const result = await cached.chat.completions.parse({ model: 'gpt-4o', messages })
    expect(result.choices[0].message.content).toBe('Hi!')
  })

  it('chat.completions.stream() works', async () => {
    const chunk = (delta: object, finish: string | null = null) => ({
      data: { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }] },
    })
    const fetch = vi.fn(async () => {
      const body = [chunk({ role: 'assistant', content: 'Hi!' }), chunk({}, 'stop')]
        .map(e => `data: ${JSON.stringify(e.data)}\n\n`).join('') + 'data: [DONE]\n\n'
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })
    const cached = createCachedClient(new OpenAI({ apiKey: 'test', fetch }))
    const completion = await cached.chat.completions.stream({ model: 'gpt-4o', messages }).finalChatCompletion()
    expect(completion.choices[0].message.content).toBe('Hi!')
  })

  it('chat.completions.create() is still cached', async () => {
    const fetch = vi.fn(async () => json(OPENAI_COMPLETION))
    const cached = createCachedClient(new OpenAI({ apiKey: 'test', fetch }))
    await cached.chat.completions.create({ model: 'gpt-4o', messages })
    await cached.chat.completions.create({ model: 'gpt-4o', messages })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
