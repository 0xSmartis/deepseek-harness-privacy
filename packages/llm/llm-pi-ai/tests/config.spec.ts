import { describe, expect, it } from 'vitest'
import { assertServiceable, Config, resolveProfiles } from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Config) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('credential header configuration', () => {
  it('resolves only credential references and non-secret schemes', () => {
    const profile = resolveProfiles({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        credentialHeaders: {
          Authorization: { credentialEnv: 'ACME_ACCESS_TOKEN', scheme: 'Bearer' },
          'api-key': { credentialEnv: 'ACME_API_KEY' },
        },
        emptyHeaders: ['x-sdk-default'],
      },
    }).get('acme-gateway')

    expect(profile?.credentialHeaders).toEqual({
      Authorization: { credentialEnv: 'ACME_ACCESS_TOKEN', scheme: 'Bearer' },
      'api-key': { credentialEnv: 'ACME_API_KEY' },
    })
    expect(profile?.emptyHeaders).toEqual(['x-sdk-default'])
  })

  it.each([
    [{ apiKey: 'secret' }, /literal apiKey, which was removed; store the value through the credentials service/],
    [
      { headers: { Authorization: 'Bearer secret' } },
      /literal headers, which were removed; store each value through the credentials service/,
    ],
  ] as const)('rejects removed literal credentials with migration guidance', (fields, message) => {
    expect(() => resolveProfiles({ 'acme-gateway': fields as never })).toThrow(message)
  })

  it.each([
    ['an invalid header name', { credentialHeaders: { 'bad header': { credentialEnv: 'ACME_KEY' } } }, /invalid credentialHeaders name/],
    ['an invalid scheme', { credentialHeaders: { Authorization: { credentialEnv: 'ACME_KEY', scheme: 'Bearer token' } } }, /invalid HTTP scheme/],
    ['a Harness-owned header', { credentialHeaders: { 'user-agent': { credentialEnv: 'ACME_KEY' } } }, /cannot replace Harness-owned header/],
    ['case-insensitive duplicates', {
      credentialHeaders: { Authorization: { credentialEnv: 'ACME_KEY' } },
      emptyHeaders: ['authorization'],
    }, /repeats request header/],
  ] as const)('rejects %s', (_label, fields, message) => {
    expect(() => resolveProfiles({
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...fields,
      } as never,
    })).toThrow(message)
  })
})
