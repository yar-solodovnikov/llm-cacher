const lib = require('../../dist/index.cjs')
const { GenerateContentResponse } = require('@google/genai')

import('./checks.mjs')
  .then(({ runChecks }) => runChecks(lib, GenerateContentResponse, 'cjs'))
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
