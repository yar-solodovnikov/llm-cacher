# Storage Backends

All storage backends implement the same `IStorage` interface, so you can swap them without touching the rest of your code.

## Memory

Built-in, no extra packages needed. Uses an LRU Map — oldest entries are evicted when `maxSize` is reached. A background sweep runs every 60 s to clean expired entries.

```ts
createCachedClient(client, {
  storage: 'memory',
  maxSize: 500,  // default: 1000
})
```

To configure `sweepIntervalMs`, instantiate directly:

```ts
import { MemoryStorage } from 'llm-cache'

createCachedClient(client, {
  storage: new MemoryStorage({ maxSize: 500, sweepIntervalMs: 30_000 }),
})
```

Best for: development, testing, single-process apps where persistence isn't needed.

## File

Stores entries as a JSON file. Reads and writes on every access — not suitable for high throughput, but great for CLI tools and local scripts.

```ts
createCachedClient(client, {
  storage: 'file',
  storagePath: './llm-cache.json',
})
```

Best for: scripts, CLI tools, one-off jobs.

> **Note:** FileStorage is designed for single-process use. Concurrent writes from multiple processes are not safe — the last write wins and may overwrite changes from another process. Use SQLite or Redis for multi-process environments.

## Redis

```bash
npm install ioredis
```

```ts
import { RedisStorage } from 'llm-cache'
import Redis from 'ioredis'

createCachedClient(client, {
  storage: new RedisStorage({
    client: new Redis(),     // existing ioredis client
    keyPrefix: 'llm:',       // default: 'llm-cache:'
  }),
  ttl: '24h',
})
```

Or connect by URL:

```ts
new RedisStorage({ url: 'redis://localhost:6379' })
```

TTL is set natively via Redis `PX` — no background sweep needed. `clear()` uses `SCAN` internally so it does not block the Redis event loop regardless of dataset size.

Best for: multi-process apps, horizontal scaling, high-throughput services.

## SQLite

```bash
npm install better-sqlite3
```

```ts
import { SQLiteStorage } from 'llm-cache'

createCachedClient(client, {
  storage: new SQLiteStorage({ path: './llm-cache.db' }),
  ttl: '7d',
})
```

Or pass an existing `Database` instance:

```ts
import Database from 'better-sqlite3'
new SQLiteStorage({ db: new Database(':memory:') })
```

Best for: single-process long-running apps, persistent local cache, Electron apps.

## DynamoDB

```bash
npm install @aws-sdk/client-dynamodb
```

```ts
import { DynamoDBStorage } from 'llm-cache'

createCachedClient(client, {
  storage: new DynamoDBStorage({
    tableName: 'llm-cache',
    region: 'us-east-1',
  }),
  ttl: '24h',
})
```

**Table setup:** partition key `pk` (String). To use native DynamoDB TTL, add a Number attribute `ttl` and enable TTL on it in the AWS console. The library also does a client-side TTL check because DynamoDB TTL cleanup is eventual.

Attribute names are configurable:

```ts
new DynamoDBStorage({
  tableName: 'my-table',
  keyAttribute: 'id',      // default: 'pk'
  valueAttribute: 'data',  // default: 'value'
  ttlAttribute: 'expires', // default: 'ttl'
})
```

Best for: serverless (Lambda, ECS), multi-region, when you're already using AWS.

## Storage error handling

If the storage backend is unavailable, you can fall through to the LLM API instead of throwing:

```ts
createCachedClient(client, {
  storage: new RedisStorage({ client }),
  onStorageError: 'throw', // default: 'passthrough'
})
```

## Custom storage

Implement `IStorage` to plug in any backend:

```ts
import type { IStorage, CacheEntry } from 'llm-cache'

class MyStorage implements IStorage {
  async get(key: string): Promise<CacheEntry | null> { ... }
  async set(key: string, entry: CacheEntry): Promise<void> { ... }
  async delete(key: string): Promise<void> { ... }
  async clear(): Promise<void> { ... }
}

createCachedClient(client, { storage: new MyStorage() })
```
