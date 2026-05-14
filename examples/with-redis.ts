/**
 * Production example: OpenAI + Redis
 *
 * Requires Redis running on localhost:6379
 * Run: npx tsx examples/with-redis.ts
 * In your own project import from 'llm-cache' instead of '../src/index'
 */
import OpenAI from 'openai'
import Redis from 'ioredis'
import { createCachedClient, RedisStorage } from '../src/index'

const redis = new Redis()

const openai = createCachedClient(new OpenAI(), {
  ttl: '24h',
  storage: new RedisStorage({ client: redis, keyPrefix: 'example:' }),
  onStorageError: 'passthrough', // if Redis is down — fall through to the API
})

async function main() {
  const params = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user' as const, content: 'Name 3 benefits of caching LLM responses.' }],
  }

  console.log('First call...')
  const start1 = Date.now()
  const res1 = await openai.chat.completions.create(params)
  console.log(res1.choices[0].message.content)
  console.log(`Time: ${Date.now() - start1}ms\n`)

  console.log('Second call (Redis cache)...')
  const start2 = Date.now()
  const res2 = await openai.chat.completions.create(params)
  console.log(res2.choices[0].message.content)
  console.log(`Time: ${Date.now() - start2}ms`)

  await redis.quit()
}

main().catch(console.error)
