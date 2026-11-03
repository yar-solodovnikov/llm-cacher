# API Reference

## `createCachedClient(client, options?)`

Wraps any OpenAI-compatible client with caching via JavaScript `Proxy`. Returns a value with the same TypeScript type as the original client.

```ts
import { createCachedClient } from 'llm-cacher'

const openai = createCachedClient(new OpenAI(), { ttl: '24h' })
```

## `createCachedAnthropicClient(client, options?)`

Same as `createCachedClient` but intercepts `client.messages.create`.

```ts
import { createCachedAnthropicClient } from 'llm-cacher'

const anthropic = createCachedAnthropicClient(new Anthropic(), { ttl: '24h' })
```

## `createCachedGeminiClient(client, options?)`

Wraps a `GoogleGenAI` client from `@google/genai`. Intercepts `client.models.generateContent` and `client.models.generateContentStream`. Cached responses are restored as `GenerateContentResponse` instances so getters like `.text` keep working.

```ts
import { createCachedGeminiClient } from 'llm-cacher'

const ai = createCachedGeminiClient(new GoogleGenAI({}), { ttl: '24h' })
```

## `createCachedMistralClient(client, options?)`

Wraps a `Mistral` client from `@mistralai/mistralai`. Intercepts `client.chat.complete` and `client.chat.stream`.

```ts
import { createCachedMistralClient } from 'llm-cacher'

const mistral = createCachedMistralClient(new Mistral({ apiKey }), { ttl: '24h' })
```

## `LlmCacheOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `ttl` | `string \| number` | `undefined` | Time-to-live. String: `"24h"`, `"30m"`, `"7d"`, `"500ms"`. Number: milliseconds. No TTL means entries never expire. |
| `storage` | `'memory' \| 'file' \| 'sqlite' \| IStorage` | `'memory'` | Storage backend. `'file'` and `'sqlite'` use `storagePath` for the file location. Pass an `IStorage` instance for Redis/DynamoDB. |
| `storagePath` | `string` | see below | Path used when `storage` is `'file'` (default `./llm-cacher.json`) or `'sqlite'` (default `./llm-cacher.db`). |
| `maxSize` | `number` | `1000` | Max entries for `'memory'` storage. Ignored for other backends. |
| `onStorageError` | `'throw' \| 'passthrough'` | `'passthrough'` | What to do when storage read/write fails. `'passthrough'` falls through to the LLM silently. |
| `semantic` | `SemanticOptions` | `undefined` | Enable semantic (vector) matching. |

## `SemanticOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `embedder` | `IEmbedder` | required | The embedding model to use. |
| `threshold` | `number` | `0.92` | Minimum cosine similarity (0â€“1) to count as a hit. |
| `indexType` | `'flat' \| 'hnsw'` | `'flat'` | Search index. Use `'hnsw'` for 10k+ entries. |
| `restore` | `boolean` | `true` | Rebuild the in-memory index from the storage on the first semantic lookup. Reads every stored entry once — see [Limitations](./guide/limitations#semantic-caching). |
| `restoreLimit` | `number` | unlimited | Stop restoring after this many entries (in no particular order). |

## Storage classes

### `MemoryStorage`

```ts
new MemoryStorage({ maxSize?: number, sweepIntervalMs?: number })
```

| Option | Default | Description |
|---|---|---|
| `maxSize` | `1000` | Max entries. Oldest entry is evicted when full (LRU). |
| `sweepIntervalMs` | `60000` | How often to run expired-entry cleanup (ms). |

### `FileStorage`

```ts
new FileStorage({ path: string })
```

### `RedisStorage`

```ts
new RedisStorage({ client?: Redis, url?: string, options?: RedisOptions, keyPrefix?: string })
```

| Option | Default | Description |
|---|---|---|
| `keyPrefix` | `'llm-cacher:'` | Prefix applied to every Redis key. |

### `SQLiteStorage`

```ts
new SQLiteStorage({ path?: string, db?: Database, tableName?: string })
```

| Option | Default | Description |
|---|---|---|
| `path` | `'llm-cacher.db'` | Path to the SQLite file. |
| `tableName` | `'llm_cache'` | Table name used inside the database. |

### `DynamoDBStorage`

```ts
new DynamoDBStorage({
  tableName: string,
  region?: string,
  client?: DynamoDBClient,
  config?: DynamoDBClientConfig,
  keyAttribute?: string,
  valueAttribute?: string,
  ttlAttribute?: string,
})
```

| Option | Default | Description |
|---|---|---|
| `keyAttribute` | `'pk'` | Partition key attribute name. |
| `valueAttribute` | `'value'` | Attribute used to store the serialized entry. |
| `ttlAttribute` | `'ttl'` | Attribute used for DynamoDB native TTL. |

## Embedders

### `LocalEmbedder`

```ts
new LocalEmbedder({ model?: string })
```

| Option | Default | Description |
|---|---|---|
| `model` | `'Xenova/all-MiniLM-L6-v2'` | HuggingFace model ID. |

`dimensions`: `384`

### `OpenAIEmbedder`

```ts
new OpenAIEmbedder({ client: OpenAI, model?: string, dimensions?: number })
```

| Option | Default | Description |
|---|---|---|
| `model` | `'text-embedding-3-small'` | OpenAI embedding model. |
| `dimensions` | `1536` | Output dimensions. |

## `IStorage` interface

```ts
interface IStorage {
  get(key: string): Promise<CacheEntry | null>
  set(key: string, entry: CacheEntry): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

## `CacheEntry`

```ts
interface CacheEntry {
  key: string
  type: 'full' | 'stream'
  value: unknown
  chunks?: unknown[]
  createdAt: number   // ms timestamp
  expiresAt: number | null
}
```

## `IEmbedder` interface

```ts
interface IEmbedder {
  readonly dimensions: number
  embed(text: string): Promise<number[]>
}
```


