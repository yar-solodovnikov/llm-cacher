import { GenerateContentResponse } from '@google/genai'
import * as lib from '../../dist/index.js'
import { runChecks } from './checks.mjs'

await runChecks(lib, GenerateContentResponse, 'esm')
