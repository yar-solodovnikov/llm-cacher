# llm-cacher

[![npm version](https://img.shields.io/npm/v/llm-cacher.svg)](https://www.npmjs.com/package/llm-cacher)
[![npm downloads](https://img.shields.io/npm/dm/llm-cacher.svg)](https://www.npmjs.com/package/llm-cacher)
[![license](https://img.shields.io/npm/l/llm-cacher.svg)](https://github.com/yar-solodovnikov/llm-cacher/blob/main/LICENSE)
[![CI](https://github.com/yar-solodovnikov/llm-cacher/actions/workflows/ci.yml/badge.svg)](https://github.com/yar-solodovnikov/llm-cacher/actions/workflows/ci.yml)

Cache LLM responses with **exact** and **semantic** matching. Works with OpenAI, Anthropic, and any SDK that follows a similar API shape. Supports in-memory, file, Redis, SQLite, and DynamoDB storage backends.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Storage Backends](#storage-backends)
- [Semantic Caching](#semantic-caching)
- [Framework Integrations](#framework-integrations)
  - [Express](#express)
  - [Hono](#hono)
  - [NestJS](#nestjs)
- [CLI](#cli)
- [Examples](#examples)
- [API Reference](#api-reference)
- [Configuration](#configuration)

---

## Installation

```bash
npm install llm-cacher
```

Install the storage backend you need (all are optional peer dependencies):

```bash
# Redis
npm install ioredis

# SQLite
npm install better-sqlite3

# DynamoDB
npm install @aws-sdk/client-dynamodb

# Semantic caching with local model (no API key needed)
npm install @huggingface/transformers

# Semantic caching with OpenAI embeddings
npm install openai

# HNSW index (only needed for 10 000+ cached entries)
npm install hnswlib-node
```

---

## Quick Start

### OpenAI

```ts
import OpenAI from 'openai'
import { createCachedClient } from 'llm-cacher'

const openai = createCachedClient(new OpenAI(), {
  ttl: '24h',
  storage: 'memory',
})

// First call hits the API
const res1 = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
})

// Second identical call is served from cache instantly
const res2 = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
})
```

### Anthropic

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

---

## How It Works

Requests are cached by a **SHA-256 hash** of the request parameters (model, messages, temperature, etc.). The `stream` flag is excluded from the key so streaming and non-streaming calls share the same cache entry.

- **Cache hit**: the response is returned immediately without calling the LLM API.
- **Cache miss**: the request goes to the API, the response is stored, then returned.
- **Streaming**: chunks are accumulated, stored as a list, and replayed as an `AsyncGenerator` on subsequent calls — the caller's code doesn't need to change.

---

## Storage Backends

### Memory (default, no extra deps)

```ts
createCachedClient(client, {
  ttl: '1h',
  storage: 'memory',
  maxSize: 500, // max entries, evicts oldest (LRU), default: 1000
})
```

### File (JSON, useful for local dev and CI)

```ts
createCachedClient(client, {
  storage: 'file',
  storagePath: './llm-cacher.json',
})
```

### Redis

```ts
import { RedisStorage } from 'llm-cacher'
import Redis from 'ioredis'

createCachedClient(client, {
  storage: new RedisStorage({ client: new Redis(), keyPrefix: 'llm:' }),
})
```

### SQLite (great for single-process apps and scripts)

```ts
import { SQLiteStorage } from 'llm-cacher'

createCachedClient(client, {
  storage: new SQLiteStorage({ path: './llm-cacher.db' }),
  ttl: '7d',
})
```

### DynamoDB

```ts
import { DynamoDBStorage } from 'llm-cacher'

createCachedClient(client, {
  storage: new DynamoDBStorage({
    tableName: 'llm-cache',
    region: 'us-east-1',
  }),
  ttl: '24h',
})
```

DynamoDB table requirements: partition key `pk` (String), optional TTL attribute `ttl` (Number). Enable TTL on the `ttl` attribute in the AWS console for automatic expiry.

To use different attribute names, pass `keyAttribute`, `valueAttribute`, or `ttlAttribute` to the constructor:

```ts
new DynamoDBStorage({
  tableName: 'llm-cache',
  region: 'us-east-1',
  keyAttribute: 'cacheKey',   // default: 'pk'
  valueAttribute: 'payload',  // default: 'value'
  ttlAttribute: 'expiresAt',  // default: 'ttl'
})
```

### Error Handling

If the storage backend is unavailable, you can choose to fall through to the LLM API instead of throwing:

```ts
createCachedClient(client, {
  storage: new RedisStorage({ client }),
  onStorageError: 'throw', // default: 'passthrough'
})
```

---

## Semantic Caching

Semantic caching matches **similar** prompts, not just identical ones. "What is 2+2?" and "What does 2 plus 2 equal?" can share the same cache entry.

### Using a local model (no API key)

```ts
import { LocalEmbedder } from 'llm-cacher'

createCachedClient(client, {
  storage: 'sqlite',
  semantic: {
    embedder: new LocalEmbedder(), // downloads ~22MB model on first use
    threshold: 0.92,               // cosine similarity 0–1, higher = stricter
  },
})
```

### Using OpenAI embeddings

```ts
import OpenAI from 'openai'
import Redis from 'ioredis'
import { OpenAIEmbedder, RedisStorage } from 'llm-cacher'

createCachedClient(client, {
  storage: new RedisStorage({ client: new Redis() }),
  semantic: {
    embedder: new OpenAIEmbedder({ client: new OpenAI() }),
    threshold: 0.95,
    indexType: 'hnsw', // 'flat' (default, O(N)) or 'hnsw' (O(log N), needs hnswlib-node)
  },
})
```

`indexType: 'hnsw'` is recommended when you expect more than ~10 000 cached entries.

---

## Framework Integrations

### Express

```ts
import express from 'express'
import OpenAI from 'openai'
import { llmCacheMiddleware } from 'llm-cacher/express'

const app = express()
app.use(llmCacheMiddleware({ ttl: '24h', storage: 'memory' }))

app.post('/chat', async (req, res) => {
  const openai = req.withCache(new OpenAI())
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: req.body.messages,
  })
  res.json(response)
})
```

### Hono

```ts
import { Hono } from 'hono'
import OpenAI from 'openai'
import { llmCacheMiddleware } from 'llm-cacher/hono'

const app = new Hono()
app.use(llmCacheMiddleware({ ttl: '24h', storage: 'sqlite' }))

app.post('/chat', async (c) => {
  const openai = c.get('withCache')(new OpenAI())
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: await c.req.json(),
  })
  return c.json(response)
})
```

### NestJS

```ts
// app.module.ts
import { Module } from '@nestjs/common'
import Redis from 'ioredis'
import { LlmCacheModule } from 'llm-cacher/nestjs'
import { RedisStorage } from 'llm-cacher'

@Module({
  imports: [
    LlmCacheModule.forRoot({
      ttl: '24h',
      storage: new RedisStorage({ client: new Redis() }),
      onStorageError: 'passthrough',
    }),
  ],
})
export class AppModule {}
```

```ts
// chat.service.ts
import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import { LlmCacheService, InjectLlmCache } from 'llm-cacher/nestjs'

@Injectable()
export class ChatService {
  private readonly openai: OpenAI

  constructor(@InjectLlmCache() private readonly llmCache: LlmCacheService) {
    this.openai = this.llmCache.wrap(new OpenAI())
  }

  async chat(messages: OpenAI.ChatCompletionMessageParam[]) {
    return this.openai.chat.completions.create({ model: 'gpt-4o', messages })
  }
}
```

---

## CLI

The CLI lets you inspect and manage cache files without writing code.

```bash
npx llm-cacher --help
```

```
Commands:
  stats   Show cache statistics
  list    List cached entries
  clear   Delete all cached entries

Options:
  --storage  Storage type: file | sqlite (default: sqlite)
  --path     Path to cache file (default: ./llm-cacher.db or ./llm-cacher.json)
  --limit    Max entries to list (default: 20)
```

**Examples:**

```bash
# SQLite stats
npx llm-cacher stats --storage sqlite --path ./llm-cacher.db

# List entries in a JSON cache
npx llm-cacher list --storage file --path ./llm-cacher.json --limit 10

# Clear SQLite cache
npx llm-cacher clear --storage sqlite --path ./llm-cacher.db
```

---

## Examples

Runnable examples are in the [`examples/`](examples/) folder. Requires `OPENAI_API_KEY`.

| File | What it shows |
|---|---|
| [`basic.ts`](examples/basic.ts) | Memory cache — first call vs cached call, timing comparison |
| [`streaming.ts`](examples/streaming.ts) | Streaming request on first call, chunk replay from cache on second |
| [`with-redis.ts`](examples/with-redis.ts) | Redis storage with `onStorageError: 'passthrough'` |
| [`semantic.ts`](examples/semantic.ts) | Local embedder — different phrasings hit the same cache entry |

```bash
npx tsx examples/basic.ts
npx tsx examples/streaming.ts
npx tsx examples/semantic.ts     # needs: npm install @huggingface/transformers
npx tsx examples/with-redis.ts   # needs: Redis on localhost:6379
```

---

## API Reference

### `createCachedClient(client, options?)`

Wraps any OpenAI-compatible client with caching. Returns a `Proxy` with the same TypeScript type as the original.

### `createCachedAnthropicClient(client, options?)`

Same as above but for Anthropic's `messages.create`.

### `LlmCacheOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `ttl` | `string \| number` | `undefined` | Time-to-live. String: `"24h"`, `"30m"`, `"7d"`, `"500ms"`. Number: milliseconds. |
| `storage` | `'memory' \| 'file' \| 'sqlite' \| IStorage` | `'memory'` | Storage backend. Pass an `IStorage` instance for Redis/DynamoDB. |
| `storagePath` | `string` | see below | File path for `'file'` (default `./llm-cacher.json`) or `'sqlite'` (default `./llm-cacher.db`). |
| `maxSize` | `number` | `1000` | Max entries for `'memory'` storage. |
| `onStorageError` | `'throw' \| 'passthrough'` | `'passthrough'` | Behaviour when storage read/write fails. |
| `semantic` | `SemanticOptions` | `undefined` | Enable semantic matching. |

### `SemanticOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `embedder` | `IEmbedder` | required | Embedding model to use. |
| `threshold` | `number` | `0.92` | Minimum cosine similarity (0–1) to count as a cache hit. |
| `indexType` | `'flat' \| 'hnsw'` | `'flat'` | Search index. Use `'hnsw'` for large caches (10k+ entries). |

### Storage classes

| Class | Package | Description |
|---|---|---|
| `MemoryStorage` | built-in | LRU in-memory cache. |
| `FileStorage` | built-in | JSON file. |
| `RedisStorage` | `ioredis` | Redis via ioredis. |
| `SQLiteStorage` | `better-sqlite3` | SQLite file. |
| `DynamoDBStorage` | `@aws-sdk/client-dynamodb` | AWS DynamoDB. |

**Resource cleanup:** Call the appropriate method when your process shuts down to release connections and background timers:

```ts
memoryStorage.destroy()   // stops the expiry sweep timer
sqliteStorage.close()     // closes the SQLite connection
await redisStorage.quit() // disconnects from Redis
```

### Embedders

| Class | Package | Dimensions | Description |
|---|---|---|---|
| `LocalEmbedder` | `@huggingface/transformers` | 384 | `all-MiniLM-L6-v2`, runs locally. |
| `OpenAIEmbedder` | `openai` | 1536 | `text-embedding-3-small`. |

---

## Configuration

### TTL format

| String | Meaning |
|---|---|
| `"500ms"` | 500 milliseconds |
| `"30m"` | 30 minutes |
| `"24h"` | 24 hours |
| `"7d"` | 7 days |

A numeric value is treated as milliseconds.

### Custom storage

Implement `IStorage` to plug in any backend:

```ts
import type { IStorage, CacheEntry } from 'llm-cacher'

class MyStorage implements IStorage {
  async get(key: string): Promise<CacheEntry | null> { ... }
  async set(key: string, entry: CacheEntry): Promise<void> { ... }
  async delete(key: string): Promise<void> { ... }
  async clear(): Promise<void> { ... }
}

createCachedClient(client, { storage: new MyStorage() })
```

---

## License

MIT


