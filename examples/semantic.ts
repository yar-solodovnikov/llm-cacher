/**
 * Semantic cache example: similar prompts share the same cache entry
 *
 * Requires: npm install @huggingface/transformers
 * Downloads ~25 MB model on first run (cached locally after that)
 *
 * Run: npx tsx examples/semantic.ts
 * In your own project import from 'llm-cache' instead of '../src/index'
 */
import OpenAI from 'openai'
import { createCachedClient, LocalEmbedder } from '../src/index'

const openai = createCachedClient(new OpenAI(), {
  storage: 'memory',
  ttl: '1h',
  semantic: {
    embedder: new LocalEmbedder(),
    threshold: 0.92,
  },
})

async function ask(question: string) {
  const start = Date.now()
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: question }],
  })
  const elapsed = Date.now() - start
  const source = elapsed < 50 ? 'cache hit ✓' : 'API call'
  console.log(`Q: ${question}`)
  console.log(`A: ${res.choices[0].message.content}`)
  console.log(`   ${elapsed}ms — ${source}\n`)
}

async function main() {
  console.log('Initializing embedder (downloads model on first run)...\n')

  await ask('What is 2+2?')                   // API call — stored in cache
  await ask('What is 2+2?')                   // exact cache hit
  await ask('What does 2 plus 2 equal?')      // semantic hit — different phrasing
  await ask('Calculate two plus two.')        // semantic hit — different phrasing
}

main().catch(console.error)
