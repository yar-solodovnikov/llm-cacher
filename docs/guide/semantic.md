# Semantic Caching

Exact caching only hits when prompts are byte-for-byte identical. Semantic caching goes further â€” it embeds prompts into vectors and finds similar cached responses using cosine similarity.

> "What is 2+2?" and "What does 2 plus 2 equal?" will share the same cache entry.

## How it works

1. On **cache set**: the prompt text is embedded into a vector and stored alongside the response.
2. On **cache get**: the incoming prompt is embedded, then compared against all stored vectors. If the nearest match exceeds the `threshold`, that cached response is returned.

Exact match is always tried first. The semantic search only runs on a miss.

## Scope: only the prompt may differ

Semantic matching compares the prompt text only — `messages` for OpenAI, Anthropic and Mistral, `contents` for Gemini. Every other request parameter must be **identical** for a semantic hit: `model`, `temperature`, `max_tokens`, `tools`, `response_format`, Anthropic's `system`, Gemini's `config`, and so on.

This prevents a cheaper model's answer from being served for a request to a stronger one, and a plain-text answer from being served to a request that expects JSON or a tool call. Streaming and non-streaming requests with the same parameters share a scope.

## Local model (no API key)

```bash
npm install @huggingface/transformers
```

Uses `all-MiniLM-L6-v2` â€” a 384-dimension model (~25 MB), downloaded once and cached locally. No API key or internet connection needed at inference time.

```ts
import { LocalEmbedder } from 'llm-cacher'

createCachedClient(client, {
  storage: 'sqlite',
  semantic: {
    embedder: new LocalEmbedder(),
    threshold: 0.92,  // cosine similarity 0â€“1, higher = stricter
  },
})
```

## OpenAI embeddings

```bash
npm install openai
```

Uses `text-embedding-3-small` â€” 1536 dimensions. Requires an OpenAI API key; each embed call costs a small amount.

```ts
import OpenAI from 'openai'
import { OpenAIEmbedder, RedisStorage } from 'llm-cacher'
import Redis from 'ioredis'

createCachedClient(client, {
  storage: new RedisStorage({ client: new Redis() }),
  semantic: {
    embedder: new OpenAIEmbedder({ client: new OpenAI() }),
    threshold: 0.95,
  },
})
```

## Persistence across restarts

Each entry is stored together with its prompt embedding. The similarity index itself lives in memory, so after a restart it is rebuilt from the storage on the first semantic lookup (via `IStorage.entries()`, implemented by all built-in backends). Entries whose vectors come from an embedder with different dimensions are skipped.

Storing the vector adds roughly 8 KB per entry with `LocalEmbedder` (384 dims) and ~30 KB with `OpenAIEmbedder` (1536 dims).

## HNSW index for large caches

```bash
npm install hnswlib-node
```

By default, the similarity search is **flat** (O(N) brute-force). For caches with more than ~10 000 entries, switch to the **HNSW** index for O(log N) lookup:

```ts
semantic: {
  embedder: new LocalEmbedder(),
  threshold: 0.92,
  indexType: 'hnsw',  // default: 'flat'
}
```

| Index | Complexity | Best for |
|---|---|---|
| `flat` | O(N) | < 10 000 entries |
| `hnsw` | O(log N) | 10 000+ entries |

## Threshold guide

The `threshold` is the minimum cosine similarity (0â€“1) required for a cache hit.

| Threshold | Behaviour |
|---|---|
| `0.99` | Near-identical only |
| `0.95` | Very similar phrasing |
| `0.92` | Default â€” good balance |
| `0.85` | More aggressive matching, higher false-positive risk |

Start at `0.92` and tune based on your use case. For factual Q&A you can go lower; for creative prompts stay higher.

