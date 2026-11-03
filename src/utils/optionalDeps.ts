import { createRequire } from 'module'

// Replaced at build time by tsup (true in the ESM bundle, false in CJS) and by vitest (true)
declare const __ESM_BUILD__: boolean

// The ESM bundle has no native `require`, so optional peer deps are loaded through
// createRequire there; the CJS bundle uses its own `require`.
export const requireOptional: NodeRequire = __ESM_BUILD__ ? createRequire(import.meta.url) : require

// Loads a peer dep in the same module format the user loads it in, so classes from it
// are identical to the user's (`instanceof` checks keep working).
export function importOptional<T>(name: string): Promise<T> {
  return __ESM_BUILD__ ? (import(name) as Promise<T>) : Promise.resolve(requireOptional(name) as T)
}
