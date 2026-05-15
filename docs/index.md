---
layout: home

hero:
  name: llm-cacher
  text: Cache LLM responses
  tagline: Exact and semantic matching for OpenAI, Anthropic, and more. Cut costs, reduce latency.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quickstart
    - theme: alt
      text: API Reference
      link: /api
    - theme: alt
      text: View on GitHub
      link: https://github.com/yar-solodovnikov/llm-cacher

features:
  - icon: ⚡️
    title: Exact match
    details: SHA-256 hashes every request. Identical calls are served instantly from cache with zero API calls.
  - icon: 🧠
    title: Semantic match
    details: Embed prompts and find similar cached responses using cosine similarity or HNSW. "What is 2+2?" and "What does 2 plus 2 equal?" share the same cache entry.
  - icon: 🗄️
    title: Five storage backends
    details: Memory, file, Redis, SQLite, DynamoDB — pick what fits your infrastructure. All are optional peer dependencies.
  - icon: 🔌
    title: Framework integrations
    details: Drop-in middleware for Express and Hono. NestJS module with dependency injection. Works out of the box.
  - icon: 📦
    title: Transparent proxy
    details: Wrap your existing client with one line of code. No interface changes, full TypeScript types preserved.
  - icon: 🌊
    title: Streaming support
    details: Accumulates stream chunks, stores them, and replays as AsyncGenerator. Your streaming code doesn't change.
---
