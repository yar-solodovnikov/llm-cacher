# Quick Start

## Installation

```bash
npm install llm-cacher
```

Install the storage backend you need â€” all are optional:

```bash
npm install ioredis              # Redis
npm install better-sqlite3       # SQLite
npm install @aws-sdk/client-dynamodb  # DynamoDB

# Semantic caching â€” local model (no API key)
npm install @huggingface/transformers hnswlib-node

# Semantic caching â€” OpenAI embeddings
npm install openai hnswlib-node
```

## OpenAI

```ts
import OpenAI from 'openai'
import { createCachedClient } from 'llm-cacher'

const openai = createCachedClient(new OpenAI(), {
  ttl: '24h',
  storage: 'memory',
})

// First call â€” hits the API
const res1 = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
})

// Second identical call â€” served from cache instantly
const res2 = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
})
```

## Anthropic

```ts
import Anthropic from '@anthropic-ai/sdk'
import { createCachedAnthropicClient } from 'llm-cacher'

const anthropic = createCachedAnthropicClient(new Anthropic(), {
  ttl: '12h',
  storage: 'sqlite',
})

const msg = await anthropic.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
})
```

## Gemini

```bash
npm install @google/genai
```

```ts
import { GoogleGenAI } from '@google/genai'
import { createCachedGeminiClient } from 'llm-cacher'

const ai = createCachedGeminiClient(new GoogleGenAI({}), {
  ttl: '24h',
  storage: 'sqlite',
})

const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Hello!',
})
console.log(res.text)

// Streaming is cached too
for await (const chunk of await ai.models.generateContentStream({ model: 'gemini-2.5-flash', contents: 'Hello!' })) {
  process.stdout.write(chunk.text ?? '')
}
```

Cached responses are restored as `GenerateContentResponse` instances, so `.text`, `.functionCalls` and the other getters work on cache hits from any storage backend. `config.httpOptions` and `config.abortSignal` are not part of the cache key.

## Mistral

```bash
npm install @mistralai/mistralai
```

```ts
import { Mistral } from '@mistralai/mistralai'
import { createCachedMistralClient } from 'llm-cacher'

const mistral = createCachedMistralClient(new Mistral({ apiKey: process.env.MISTRAL_API_KEY }), {
  ttl: '24h',
  storage: 'sqlite',
})

const res = await mistral.chat.complete({
  model: 'mistral-large-latest',
  messages: [{ role: 'user', content: 'Hello!' }],
})

for await (const event of await mistral.chat.stream({ model: 'mistral-large-latest', messages: [{ role: 'user', content: 'Hello!' }] })) {
  process.stdout.write(String(event.data.choices[0]?.delta.content ?? ''))
}
```

`chat.stream()` returns an async iterable you consume with `for await` — the `ReadableStream` methods of the original `EventStream` are not available on the cached result.

## How it works

Every request is cached by a **SHA-256 hash** of the parameters (model, messages, temperature, etc.). The `stream` flag is excluded so streaming and non-streaming calls share the same entry. Attribution params that don't affect the answer — `user`, `safety_identifier`, `metadata`, `prompt_cache_key`, `store` (and Gemini's `config.labels`) — are excluded too, so a per-user id doesn't split the cache.

- **Cache hit** â€” response returned immediately, no API call made.
- **Cache miss** â€” request goes to the API, response is stored, then returned.
- **Streaming** â€” chunks are accumulated and stored, then replayed as `AsyncGenerator` on cache hits.

## Running the examples

The repository includes runnable examples in the [`examples/`](https://github.com/yar-solodovnikov/llm-cacher/tree/main/examples) folder. Requires `OPENAI_API_KEY`.

```bash
git clone https://github.com/yar-solodovnikov/llm-cacher
cd llm-cacher && npm install

npx tsx examples/basic.ts       # memory cache, timing comparison
npx tsx examples/streaming.ts   # streaming + cache replay
npx tsx examples/with-redis.ts  # Redis storage
npx tsx examples/semantic.ts    # semantic matching with local embedder
```

## TTL format

| Value | Meaning |
|---|---|
| `"500ms"` | 500 milliseconds |
| `"30m"` | 30 minutes |
| `"24h"` | 24 hours |
| `"7d"` | 7 days |
| `60000` | 60 000 ms (number = milliseconds) |



