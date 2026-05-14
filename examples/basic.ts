/**
 * Basic example: OpenAI + in-memory cache
 *
 * Run: npx tsx examples/basic.ts
 * In your own project import from 'llm-cache' instead of '../src/index'
 */
import OpenAI from 'openai'
import { createCachedClient } from '../src/index'

const openai = createCachedClient(new OpenAI(), {
  ttl: '24h',
  storage: 'memory',
})

async function main() {
  const params = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'What is 2+2? Answer in one word.' }],
  }

  console.log('First call (goes to API)...')
  const start1 = Date.now()
  const res1 = await openai.chat.completions.create(params)
  console.log(`Answer: ${res1.choices[0].message.content}`)
  console.log(`Time:   ${Date.now() - start1}ms\n`)

  console.log('Second identical call (from cache)...')
  const start2 = Date.now()
  const res2 = await openai.chat.completions.create(params)
  console.log(`Answer: ${res2.choices[0].message.content}`)
  console.log(`Time:   ${Date.now() - start2}ms`)
}

main().catch(console.error)
