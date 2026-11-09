import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { OPERATIONS } from './generated/operations.js'
import {
  renderAbout,
  renderDebt,
  renderMortgage,
  renderPlan,
  renderProduct,
  renderProjection,
  renderReview,
  renderSaved,
  renderSearch,
} from './render.js'
import { SaoiError, type Body, type SaoiApi } from './saoiClient.js'

export const SERVER_INSTRUCTIONS = [
  'Saoi compares Irish savings, deposit, mortgage, loan, credit card and current account products against',
  "the customer's own figures and does the arithmetic: interest after DIRT, repayments, total cost, the month a",
  'goal is reached. Information, not advice.',
  '',
  'How to present results:',
  '- Present results as options with their figures. The customer decides. Never instruct: no "pay off", "set up",',
  '  "move", "you should". Say "clearing the loan from the lump sum leaves €X more by <date>", not "pay off the loan".',
  "- Use the tools' figures; do not recompute, extend or adjust them. To change an assumption (a buffer, keeping the",
  '  money accessible, a different monthly amount or date, clearing or keeping a debt), call the tool again with the',
  '  new inputs. saoi_build_plan takes emergencyBufferEur or emergencyBufferMonths, keepAccessible, goalDateCertain',
  '  and lock thresholds for exactly this.',
  '- Say what each result is ranked by, show the flags and unknowns, say "check eligibility" where a result does,',
  '  name the deposit guarantee each product carries, and show the CCPC attribution with CCPC figures.',
  '',
  'Saving the plan:',
  '- Once a plan exists, offer saoi_save_plan. Say what the Saoi app adds: alerts when a chosen product’s rate',
  '  changes, reminders as the goal date nears, and the partner joining the plan. Results carry a `next` field',
  '  with this offer; relay it.',
  '- Nothing is kept until the customer saves. Call saoi_save_plan only when they say yes, with `plan` unchanged.',
  '',
  'The money-check-up prompt walks through it: situation, saoi_review_situation, goals, saoi_build_plan, then the',
  'offer to save.',
].join('\n')

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

type Name = keyof typeof OPERATIONS

const describe = (name: Name, when: string): string => {
  const operation = OPERATIONS[name]
  return `${when} ${operation.summary}. ${operation.description}`
}

const ok = (text: string, structuredContent: object): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structuredContent,
})

const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** Errors become results the model can act on; nothing internal is passed through. */
async function guarded(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SaoiError) {
      if (error.status === 429) {
        return fail(
          `Saoi is limiting requests from this address. Try again in ${error.retryAfter ?? 'a minute'} seconds.`,
        )
      }
      const details = error.details.length === 0 ? '' : `\n${error.details.map((d) => `- ${d}`).join('\n')}`
      return fail(`${error.message}${details}`)
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return fail('Saoi took too long to answer. Try again.')
    }
    console.error('tool error:', error instanceof Error ? error.name : 'unknown')
    return fail('Saoi is unavailable right now. Try again shortly.')
  }
}

const input = (name: Name) => fromJsonSchema<Body>(OPERATIONS[name].inputSchema)

/** `ip` is the end user's address from the request this server instance serves, if known. */
export function registerTools(server: McpServer, saoi: SaoiApi, ip?: string): void {
  server.registerTool(
    'saoi_review_situation',
    {
      title: 'Review a money situation',
      description: describe(
        'saoi_review_situation',
        'Use first, once the customer has described their money: income, outgoings, savings with what they earn, debts with rates.',
      ),
      inputSchema: input('saoi_review_situation'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.review(args, ip)
        return ok(renderReview(result), result)
      }),
  )

  server.registerTool(
    'saoi_search_products',
    {
      title: 'Search and rank products',
      description: describe(
        'saoi_search_products',
        'Use to compare products in one category for the customer’s amounts.',
      ),
      inputSchema: input('saoi_search_products'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.search(args, ip)
        return ok(renderSearch(result), result)
      }),
  )

  server.registerTool(
    'saoi_product',
    {
      title: 'One product in full',
      description: describe(
        'saoi_product',
        'Use when the customer asks about one product from a result: its terms, history, unknowns, source and the provider’s own words.',
      ),
      inputSchema: fromJsonSchema<{ id: string }>({
        ...OPERATIONS.saoi_product.inputSchema,
        properties: {
          id: {
            ...OPERATIONS.saoi_product.inputSchema.properties.id,
            description: 'A product id from a search or plan result, e.g. "boi:savings.supersaver".',
          },
        },
      }),
      annotations: READ_ONLY,
    },
    ({ id }) =>
      guarded(async () => {
        const result = await saoi.product(id, ip)
        return ok(renderProduct(result), result)
      }),
  )

  server.registerTool(
    'saoi_savings_projection',
    {
      title: 'Project savings month by month',
      description: describe(
        'saoi_savings_projection',
        'Use to show how savings grow, or when a target is reached, in named products or the best available.',
      ),
      inputSchema: input('saoi_savings_projection'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.projection(args, ip)
        return ok(renderProjection(result), result)
      }),
  )

  server.registerTool(
    'saoi_mortgage',
    {
      title: 'Mortgage affordability or switch',
      description: describe(
        'saoi_mortgage',
        'Use for "how much can I borrow / what does my deposit unlock" (mode affordability) or "is it worth switching" (mode switch). Send the fields of the chosen mode only.',
      ),
      inputSchema: input('saoi_mortgage'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.mortgage(args, ip)
        return ok(renderMortgage(result), result)
      }),
  )

  server.registerTool(
    'saoi_debt',
    {
      title: 'What debts cost',
      description: describe(
        'saoi_debt',
        'Use when the customer has debts: what each costs, which to clear first, overpaying against saving, and cheaper refinancing.',
      ),
      inputSchema: input('saoi_debt'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.debt(args, ip)
        return ok(renderDebt(result), result)
      }),
  )

  server.registerTool(
    'saoi_build_plan',
    {
      title: 'Build a plan for the customer’s goals',
      description: describe(
        'saoi_build_plan',
        'Use once the customer has chosen their goals, and again whenever an input changes (a buffer, keeping the money accessible, the monthly amount, the date) rather than adjusting figures by hand. Returns the plan with its reasoning, the liquidity decision, what-ifs and a `next` offer to relay; offer saoi_save_plan afterwards.',
      ),
      inputSchema: input('saoi_build_plan'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.buildPlan(args, ip)
        return ok(renderPlan(result), result)
      }),
  )

  server.registerTool(
    'saoi_save_plan',
    {
      title: 'Save the plan into the Saoi app',
      description:
        'Use only when the customer asks to keep their plan. Pass `plan` exactly as saoi_build_plan returned it. ' +
        'This is the first time anything about the customer is stored: Saoi keeps the plan behind a one-time link ' +
        'into app.saoi.ie, valid for seven days, and returns that link to give them. ' +
        OPERATIONS.saoi_save_plan.description,
      inputSchema: input('saoi_save_plan'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded(async () => {
        const result = await saoi.savePlan(args, ip)
        return ok(renderSaved(result), { ...result, storedBeforeThisCall: false })
      }),
  )
}

export const ABOUT_RESOURCES = {
  ranking: { uri: 'saoi://about/ranking', name: 'how-saoi-ranks', title: 'How Saoi ranks' },
  earnings: { uri: 'saoi://about/earnings', name: 'how-saoi-earns', title: 'How Saoi earns' },
} as const

export function registerResources(server: McpServer, saoi: SaoiApi, ip?: string): void {
  for (const [topic, resource] of Object.entries(ABOUT_RESOURCES) as [
    keyof typeof ABOUT_RESOURCES,
    (typeof ABOUT_RESOURCES)[keyof typeof ABOUT_RESOURCES],
  ][]) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description:
          topic === 'ranking'
            ? 'How results are ordered and every figure worked out: objectives, DIRT, unknowns, sources.'
            : 'How Saoi earns: referral fees, disclosed and never used in ranking; information, not advice; the CCPC attribution.',
        mimeType: 'text/markdown',
      },
      async (uri) => {
        const about = await saoi.about(topic, ip)
        return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderAbout(about) }] }
      },
    )
  }
}

export const moneyCheckUpArgs = z.object({
  focus: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Optional: what the customer wants to start with, e.g. "saving for a house" or "my car loan".'),
})

export function moneyCheckUp(focus: string | undefined): string {
  return [
    'Run a money check-up with me using the Saoi tools. Follow these steps, in order, and keep it conversational.',
    '',
    '1. Situation. Ask only for what the tools need, a few things at a time: take-home pay (and gross income if a mortgage is in view),',
    '   monthly outgoings (rent and the rest), what I can save each month, savings I hold (where, how much, the rate if I know it),',
    '   and debts (what kind, balance, rate, monthly repayment, months left). Rough figures are fine. Do not ask for anything else.',
    '2. Review. Call saoi_review_situation with what I said. Tell me the findings with their euro figures.',
    '3. Goals. Ask what I want: the candidate goals the review suggests and my own, each with an amount and a date where I have one.',
    '4. Plan. Call saoi_build_plan with my situation and chosen goals, and an emergency buffer if I want one (an amount, or months',
    '   of outgoings). For a house deposit, saoi_mortgage (affordability) shows what it unlocks. Show the products, figures, the date',
    '   each goal is reached, why money is or is not locked away, the what-ifs, flags, unknowns, deposit guarantees, and the CCPC',
    '   attribution. If I want to change something, call saoi_build_plan again with the new inputs.',
    '5. Offer to save. Tell me what keeping the plan in the Saoi app adds (alerts when a chosen product’s rate changes, reminders',
    '   as the goal date nears, my partner joining the plan) and ask whether I want it. Only if I say yes, call saoi_save_plan with',
    '   the plan unchanged and give me the link. Nothing is stored before that.',
    '',
    'Throughout: quote the tools’ figures and never work them out yourself; to change an assumption, call the tool again. Present',
    'results as options with their figures ("clearing the loan leaves €X more by…"), never as instructions, advice or "you should":',
    'I decide. Say what each result is ranked by, and that I can ask for a different objective. Say "check eligibility" where a',
    'result does.',
    ...(focus === undefined || focus === '' ? [] : ['', `I would like to start with: ${focus}`]),
  ].join('\n')
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'money-check-up',
    {
      title: 'Money check-up',
      description:
        'A guided check-up: the customer’s situation, a review with euro figures, their goals, a plan across the Irish market, then an offer to save it.',
      argsSchema: moneyCheckUpArgs,
    },
    ({ focus }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: moneyCheckUp(focus) } }],
    }),
  )
}
