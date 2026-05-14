/**
 * Streaming example: chunks are accumulated on first call and replayed from cache
 *
 * Run: npx tsx examples/streaming.ts
 * In your own project import from 'llm-cache' instead of '../src/index'
 */
import OpenAI from 'openai'
import { createCachedClient } from '../src/index'

const openai = createCachedClient(new OpenAI(), {
  ttl: '1h',
  storage: 'memory',
})

async function printStream(label: string, stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
  process.stdout.write(`${label}: `)
  const start = Date.now()
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? '')
  }
  console.log(`\n(${Date.now() - start}ms)\n`)
}

async function main() {
  const params = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'Count from 1 to 5, one number per line.' }],
    stream: true as const,
  }

  const stream1 = await openai.chat.completions.create(params)
  await printStream('First call  (API, streams live)', stream1)

  const stream2 = await openai.chat.completions.create(params)
  await printStream('Second call (cache replay)', stream2)
}

main().catch(console.error)
