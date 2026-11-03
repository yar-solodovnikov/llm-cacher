// Smoke checks against the built package — run by smoke.mjs (ESM bundle) and smoke.cjs (CJS bundle).
// Unit tests run the sources through vitest, which hides bundle-only problems such as a bare
// require() in the ESM output, so these checks load dist/ exactly like a user's app does.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const EMBEDDINGS = {
  'user: explain async/await': [1, 0, 0],
  'user: what is async/await?': [0.99, 0.1, 0.05],
}
const fakeEmbedder = { dimensions: 3, embed: async text => EMBEDDINGS[text] ?? [0, 1, 0] }

function countingOpenAI() {
  const client = { calls: 0, chat: { completions: { create: async () => { client.calls++; return { choices: [] } } } } }
  return client
}

export async function runChecks(lib, GenerateContentResponse, format) {
  const dir = mkdtempSync(join(tmpdir(), `llm-cacher-smoke-${format}-`))
  const checks = {
    'SQLiteStorage loads better-sqlite3': async () => {
      const storage = new lib.SQLiteStorage({ path: join(dir, 'direct.db') })
      await storage.set('k', { key: 'k', type: 'full', value: 1, createdAt: 0, expiresAt: null })
      assert.equal((await storage.get('k')).value, 1)
      storage.close()
    },

    "storage: 'sqlite' option": async () => {
      const client = countingOpenAI()
      const cached = lib.createCachedClient(client, { storage: 'sqlite', storagePath: join(dir, 'option.db') })
      const params = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
      await cached.chat.completions.create(params)
      await cached.chat.completions.create(params)
      assert.equal(client.calls, 1)
    },

    'HNSW index loads hnswlib-node': async () => {
      const engine = new lib.SimilarityEngine({ threshold: 0.9, indexType: 'hnsw', dimensions: 3 })
      engine.add('a', [1, 0, 0])
      assert.equal(engine.findSimilar([0.99, 0.1, 0]), 'a')
    },

    'RedisStorage loads ioredis': async () => {
      const storage = new lib.RedisStorage({ options: { lazyConnect: true } })
      await storage.quit().catch(() => undefined)
    },

    'DynamoDBStorage loads @aws-sdk/client-dynamodb': async () => {
      new lib.DynamoDBStorage({ tableName: 't', region: 'us-east-1' })
    },

    'semantic index survives a restart': async () => {
      const path = join(dir, 'semantic.db')
      const opts = { storage: 'sqlite', storagePath: path, semantic: { embedder: fakeEmbedder, threshold: 0.9 } }
      const first = countingOpenAI()
      await lib.createCachedClient(first, opts).chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'explain async/await' }] })
      const second = countingOpenAI()
      await lib.createCachedClient(second, opts).chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'what is async/await?' }] })
      assert.equal(second.calls, 0)
    },

    'Gemini responses are restored as the app’s GenerateContentResponse': async () => {
      const opts = { storage: 'file', storagePath: join(dir, 'gemini.json') }
      const live = { models: { generateContent: async () => Object.assign(new GenerateContentResponse(), { candidates: [{ content: { parts: [{ text: 'Hi!' }] } }] }) } }
      await lib.createCachedGeminiClient(live, opts).models.generateContent({ model: 'm', contents: 'x' })
      const offline = { models: { generateContent: async () => { throw new Error('should be served from cache') } } }
      const res = await lib.createCachedGeminiClient(offline, opts).models.generateContent({ model: 'm', contents: 'x' })
      assert.ok(res instanceof GenerateContentResponse, 'instanceof GenerateContentResponse')
      assert.equal(res.text, 'Hi!')
    },
  }

  let failed = 0
  for (const [name, check] of Object.entries(checks)) {
    try {
      await check()
      console.log(`  ok   [${format}] ${name}`)
    } catch (err) {
      failed++
      console.error(`  FAIL [${format}] ${name}\n       ${err?.message ?? err}`)
    }
  }
  // best effort: on Windows the sqlite files opened via `storage: 'sqlite'` stay locked until exit
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* left for the OS temp cleanup */
  }
  if (failed > 0) process.exitCode = 1
}
