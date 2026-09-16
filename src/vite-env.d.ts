/**
 * The two model entry files reach the browser bundle as strings through Vite's
 * `?raw` suffix, so the solver ships inside the build and is precached like
 * any other module rather than fetched at runtime (CLAUDE.md: no network).
 */
declare module '*.mzn?raw' {
  const source: string
  export default source
}
