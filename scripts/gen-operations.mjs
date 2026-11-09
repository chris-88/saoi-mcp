#!/usr/bin/env node
/**
 * Generates src/generated/operations.ts from saoi-api's OpenAPI document: for each saoi-api
 * operation an MCP tool or resource wraps, its method, path, summary, description and the JSON
 * Schema of its input, with every $ref inlined.
 *
 * Tool input schemas and descriptions come from here and nowhere else, so a change to a route
 * in saoi is one `npm run gen` away from the tools.
 *
 * Two adjustments, both because MCP hosts need them:
 * - A request body that is a top-level oneOf (the mortgage calculation, by `mode`) is flattened
 *   into one object: many hosts reject a top-level oneOf. saoi-api still validates the variant.
 * - Fields the adapter sets itself (`client` on a saved plan) are removed from the input.
 *
 * Usage: node scripts/gen-operations.mjs [url-or-file]  (default $SAOI_OPENAPI_URL or the live API)
 */
import { readFile, writeFile } from 'node:fs/promises'

const source = process.argv[2] ?? process.env.SAOI_OPENAPI_URL ?? 'https://api.saoi.ie/api/openapi.json'
const out = new URL('../src/generated/operations.ts', import.meta.url)

/** Tool or resource name → the saoi-api operation it wraps, and fields the adapter fills. */
const OPERATIONS = {
  saoi_review_situation: { method: 'post', path: '/api/calc/review-situation' },
  saoi_search_products: { method: 'post', path: '/api/market/search' },
  saoi_product: { method: 'get', path: '/api/market/products/{id}' },
  saoi_savings_projection: { method: 'post', path: '/api/calc/savings-projection' },
  saoi_mortgage: { method: 'post', path: '/api/calc/mortgage' },
  saoi_debt: { method: 'post', path: '/api/calc/debt' },
  saoi_build_plan: { method: 'post', path: '/api/calc/build-plan' },
  saoi_first_home: { method: 'post', path: '/api/calc/first-home' },
  saoi_save_plan: { method: 'post', path: '/api/plans', omit: ['client'] },
  about: { method: 'get', path: '/api/market/about/{topic}' },
}

const doc = JSON.parse(
  /^https?:/.test(source) ? await (await fetch(source)).text() : await readFile(source, 'utf8'),
)

function deref(node, seen = []) {
  if (Array.isArray(node)) return node.map((item) => deref(item, seen))
  if (node === null || typeof node !== 'object') return node
  if (typeof node.$ref === 'string') {
    const name = node.$ref.replace('#/components/schemas/', '')
    if (seen.includes(name)) throw new Error(`recursive schema ${name}`)
    const target = doc.components?.schemas?.[name]
    if (target === undefined) throw new Error(`no schema ${name}`)
    const { $ref: _ref, ...rest } = node
    return { ...deref(target, [...seen, name]), ...deref(rest, seen) }
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, deref(value, seen)]))
}

/** OpenAPI 3.0 spellings to JSON Schema 2020-12: numeric exclusive bounds, `nullable`, no `example`. */
function jsonSchema(node) {
  if (Array.isArray(node)) return node.map(jsonSchema)
  if (node === null || typeof node !== 'object') return node
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'example' || key === 'examples') continue
    out[key] =
      key === 'properties'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSchema(v)]))
        : jsonSchema(value)
  }
  if (out.exclusiveMinimum === true) {
    out.exclusiveMinimum = out.minimum
    delete out.minimum
  } else if (out.exclusiveMinimum === false) delete out.exclusiveMinimum
  if (out.exclusiveMaximum === true) {
    out.exclusiveMaximum = out.maximum
    delete out.maximum
  } else if (out.exclusiveMaximum === false) delete out.exclusiveMaximum
  // `nullable: true` is OpenAPI 3.0 only; JSON Schema spells it as a `null` type.
  if ('nullable' in out) {
    const nullable = out.nullable === true
    delete out.nullable
    if (nullable && typeof out.type === 'string') {
      out.type = [out.type, 'null']
      if (Array.isArray(out.enum)) out.enum = [...out.enum, null]
    } else if (nullable) return { anyOf: [out, { type: 'null' }] }
  }
  return out
}

/** One object out of a top-level oneOf/anyOf: every variant's properties, the shared required. */
function flatten(schema) {
  const variants = schema.oneOf ?? schema.anyOf
  if (!Array.isArray(variants)) return schema
  const properties = {}
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.properties ?? {})) {
      const existing = properties[key]
      // A discriminator (`const` or a one-value `enum`) in each variant becomes one enum.
      const choices = (schema) => ('const' in schema ? [schema.const] : schema.enum)
      if (existing !== undefined && Array.isArray(choices(existing)) && Array.isArray(choices(value))) {
        properties[key] = {
          type: 'string',
          enum: [...new Set([...choices(existing), ...choices(value)])],
          ...(existing.description === undefined ? {} : { description: existing.description }),
        }
      } else if (existing === undefined) properties[key] = value
    }
  }
  const required = variants
    .map((variant) => new Set(variant.required ?? []))
    .reduce((shared, next) => new Set([...shared].filter((key) => next.has(key))))
  return {
    type: 'object',
    ...(schema.description === undefined ? {} : { description: schema.description }),
    properties,
    required: [...required],
  }
}

const result = {}
for (const [name, spec] of Object.entries(OPERATIONS)) {
  const operation = doc.paths?.[spec.path]?.[spec.method]
  if (operation === undefined)
    throw new Error(`${spec.method.toUpperCase()} ${spec.path} is not in ${source}`)
  let inputSchema
  if (spec.method === 'get') {
    const properties = {}
    const required = []
    for (const parameter of operation.parameters ?? []) {
      properties[parameter.name] = {
        ...jsonSchema(deref(parameter.schema)),
        ...(parameter.description === undefined ? {} : { description: parameter.description }),
      }
      if (parameter.required) required.push(parameter.name)
    }
    inputSchema = { type: 'object', properties, required }
  } else {
    const body = operation.requestBody?.content?.['application/json']?.schema
    if (body === undefined) throw new Error(`${spec.path} has no JSON body`)
    inputSchema = flatten(jsonSchema(deref(body)))
    for (const field of spec.omit ?? []) {
      delete inputSchema.properties?.[field]
      inputSchema.required = (inputSchema.required ?? []).filter((key) => key !== field)
    }
  }
  result[name] = {
    method: spec.method.toUpperCase(),
    path: spec.path,
    summary: operation.summary ?? '',
    description: operation.description ?? '',
    inputSchema,
  }
}

await writeFile(
  out,
  `// Generated by scripts/gen-operations.mjs from ${source} (${doc.info?.version ?? '?'}). Do not edit.\n` +
    `import type { JsonSchemaType } from '@modelcontextprotocol/server'\n\n` +
    `export interface Operation {\n  readonly method: 'GET' | 'POST'\n  readonly path: string\n  readonly summary: string\n  readonly description: string\n  readonly inputSchema: JsonSchemaType\n}\n\n` +
    `export const OPERATIONS = ${JSON.stringify(result, null, 2)} as const satisfies Record<string, Operation>\n`,
)
console.log(`wrote ${out.pathname}: ${Object.keys(result).join(', ')}`)
