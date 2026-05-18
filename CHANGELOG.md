# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.7] - 2026-05-18

### Fixed
- DynamoDB invalid-type test was a false positive — rewrote test to mock `GetItemCommand` response directly so the type guard is exercised correctly

### Tests
- Expanded coverage across all storage backends: stream entry roundtrips, invalid-type guards, expired-entry skips, JSON corruption handling
- Added `CacheManager` edge-case tests: TTL propagation, embedder error passthrough/rethrow, storage error on `set`
- Added `SimilarityEngine` no-op guard tests for removing non-existent keys
- Added Anthropic adapter storage-error passthrough test
- Added `OpenAIEmbedder` test for completely missing `data` property in API response

## [1.0.6] - 2026-05-18

No functional changes. Version bump to resolve a publish conflict.

## [1.0.5] - 2026-05-17

### Fixed
- `OpenAIEmbedder` — safe optional chaining on `response.data` prevents a crash when the OpenAI API returns an unexpected shape
- `DynamoDBStorage.get()` — TTL expiry now checked against millisecond-precise `expiresAt` field; DynamoDB's native TTL cleanup is eventual and seconds-rounded, so stale entries could be returned for up to 999 ms after expiry
- `DynamoDBStorage.get()` — corrected `ExpressionAttributeNames` mapping that caused a query error when the key attribute name is a reserved word
- `DynamoDBStorage.clear()` — fixed deletion logic that left entries behind
- `buildCachedCreate` (shared adapter) — storage errors after a response or stream has already been delivered are now swallowed instead of propagating to the caller
- `extractText` — tightened type guard to reject non-array `messages` fields before accessing elements
- `SimilarityEngine` — `remove()` now safely no-ops when the key does not exist in the index
- `LocalEmbedder` — improved error handling for model load and inference failures

### Added
- GitHub Actions CI workflow (`ci.yml`)
- Docker Compose setup for local Redis and DynamoDB integration testing
- Integration tests for `RedisStorage` and `DynamoDBStorage` (opt-in via separate vitest config)
- Unit tests: `LocalEmbedder`, `OpenAIEmbedder`, `DynamoDBStorage`, `SimilarityEngine`, OpenAI adapter, semantic cache flow

### Security
- Updated dependencies to resolve Dependabot alerts (esbuild, vite, and related tooling)

## [1.0.4] - 2026-05-16

### Docs
- Improved README examples and storage backend documentation

## [1.0.3] - 2026-05-15

### Fixed
- CLI binary shebang (`#!/usr/bin/env node`) was not written to the built output; fixed via a `tsup` `onSuccess` hook that patches the file after compilation — ensures `npx llm-cacher` and global installs work correctly

## [1.0.2] - 2026-05-15

### Fixed
- Initial attempt to fix CLI shebang for npm global installs

## [1.0.1] - 2026-05-15

### Changed
- Renamed package and repository to `llm-cacher`
- Added npm publish GitHub Actions workflow
- Added README badges (npm version, license, CI status)

## [1.0.0] - 2026-05-14

### Added
- **Exact caching** — SHA-256 keyed cache for identical prompts; zero-latency replay for both full responses and streaming chunks
- **Semantic caching** — cosine similarity (flat) and HNSW index modes; configurable similarity threshold; embedding-based deduplication of near-identical prompts
- **Storage backends**
  - `MemoryStorage` — in-process LRU cache with configurable max size
  - `FileStorage` — JSON file persistence, no external dependencies
  - `SQLiteStorage` — embedded SQLite via `better-sqlite3`
  - `RedisStorage` — Redis via `ioredis`
  - `DynamoDBStorage` — AWS DynamoDB with native TTL support
- **AI provider adapters**
  - `createCachedClient` — transparent proxy wrapper for the OpenAI SDK
  - `createCachedAnthropicClient` — transparent proxy wrapper for the Anthropic SDK
- **Embeddings**
  - `LocalEmbedder` — on-device embeddings via `@huggingface/transformers` (no API key required)
  - `OpenAIEmbedder` — embeddings via the OpenAI embeddings API
- **Framework integrations**
  - `llmCacheMiddleware` for Express
  - `llmCacheMiddleware` for Hono
  - `LlmCacheModule` for NestJS
- **CLI** — `llm-cacher stats | list | clear` with `--storage` and `--path` flags
- **TTL** — flexible TTL configuration: number (ms), string (`'1h'`, `'30m'`, `'7d'`), or disabled
- **Error strategy** — `onStorageError: 'passthrough'` (default) silently falls through to the LLM; `'throw'` surfaces storage errors to the caller
- TypeScript-first with full type exports and dual CJS/ESM build

[1.0.7]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/yar-solodovnikov/llm-cacher/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yar-solodovnikov/llm-cacher/releases/tag/v1.0.0
