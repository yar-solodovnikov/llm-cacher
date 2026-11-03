# Limitations

What llm-cacher does **not** do, and where a cached client behaves differently from the plain SDK.

## Which methods are cached

Only these methods go through the cache:

| SDK | Cached methods |
|---|---|
| OpenAI | `chat.completions.create` |
| Anthropic | `messages.create` |
| Gemini (`@google/genai`) | `models.generateContent`, `models.generateContentStream` |
| Mistral | `chat.complete`, `chat.stream` |

Everything else on the client works exactly as in the plain SDK, **uncached**. This includes:

- OpenAI's helpers `chat.completions.parse()`, `.stream()` and `.runTools()`, and the Responses API (`responses.create`)
- Anthropic's `messages.stream()` helper, `messages.batches`, and `beta.messages`
- Gemini's chat sessions (`ai.chats.create(...).sendMessage()`). A chat session holds its own reference to the unwrapped `models`, so call `models.generateContent` with the full history if you want caching.
- Mistral's `chat.parse()` and `chat.parseStream()`

## Return types of cached methods

A cached method returns the response **data**, not the SDK's wrapper objects:

- **OpenAI / Anthropic `create()`** returns a plain `Promise`, not the SDK's `APIPromise`. That means `.withResponse()` and `.asResponse()` are not available, and you can't read HTTP headers (request id, rate limits) on cached calls.
- **Streaming** (`stream: true`, `generateContentStream`, Mistral `chat.stream`) returns an `AsyncGenerator` that yields the same chunks. Consume it with `for await`. The SDK stream classes' extra members are not available: OpenAI/Anthropic `Stream` (`.controller`, `.toReadableStream()`, `.tee()`) and Mistral's `EventStream` (which is a `ReadableStream`, so no `.getReader()` either).

Recreating `APIPromise` and the stream classes would mean depending on SDK internals that change between versions, so llm-cacher deliberately returns plain values. If you need headers or the stream helpers, call those methods on an unwrapped client.

## Cached responses are replayed as-is

- A cache hit returns the original response unchanged, including its `id`, `created` timestamp and `usage`. `usage` reports the tokens of the original call, even though the hit cost nothing.
- With `storage: 'memory'`, a hit returns **the same object** that was cached. If you mutate a response, the cached entry changes too. Clone it first if you need to modify it.
- Gemini responses are restored as `GenerateContentResponse` instances, so `.text`, `.functionCalls` and the other getters work. Other SDKs' responses are plain objects in the first place.

## Streaming

- A stream is cached only after it has been **fully consumed**. Breaking out of the `for await` loop early, or an error mid-stream, leaves nothing cached.
- A streaming and a non-streaming request with the same parameters share one cache key, but each needs its own entry type. If you alternate between the two for the same request, each call is a miss that replaces the other's entry.

## Concurrency

Identical requests issued at the same time all miss, and each one calls the API. Requests are not coalesced.

## Semantic caching

- Only text prompts are semantically indexed. A request with images, files, tool calls or tool results in its messages is cached by exact match only.
- A semantic hit requires the same `model` and the same other parameters; only the prompt may differ. See [Scope](./semantic#scope-only-the-prompt-may-differ).
- **Privacy.** A semantic hit serves an answer generated for a *different* prompt, which may come from a different user. Don't enable semantic caching for prompts that contain personal data, or use a separate storage or `keyPrefix` per user or tenant.
- The similarity index is held in memory. After a restart it is rebuilt from the storage on the first semantic lookup. Entries written by llm-cacher versions without this feature have no stored embedding and are found by exact match only.
- That rebuild reads **every stored entry once**: the first semantic lookup after a start is slower for a large cache, and on DynamoDB it is a full table `Scan` billed as read capacity. Use `semantic.restoreLimit` to cap it or `semantic.restore: false` to skip it.
- **Several instances sharing one storage** don't see each other's new entries semantically. Each instance restores the index once, at its first semantic lookup; entries that other instances write after that are found by exact match only until this instance restarts.

## Framework integrations

`withCache` / `wrap` detect the SDK from the client's shape. An OpenAI-compatible SDK that also exposes other namespaces may need the provider passed explicitly, for example `req.withCache(client, 'openai')`.
