import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'llm-cacher',
  description: 'Cache LLM responses with exact and semantic matching',
  base: '/llm-cacher/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/quickstart' },
      { text: 'API', link: '/api' },
      { text: 'GitHub', link: 'https://github.com/yar-solodovnikov/llm-cacher' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Quick Start', link: '/guide/quickstart' },
        ],
      },
      {
        text: 'Storage',
        items: [
          { text: 'Storage Backends', link: '/guide/storage' },
        ],
      },
      {
        text: 'Semantic Caching',
        items: [
          { text: 'Semantic Cache', link: '/guide/semantic' },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'Express / Hono / NestJS', link: '/guide/integrations' },
          { text: 'CLI', link: '/guide/cli' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Limitations', link: '/guide/limitations' },
        ],
      },
      { text: 'API Reference', link: '/api' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/yar-solodovnikov/llm-cacher' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
})


