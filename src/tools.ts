import type { CallToolResult } from '@modelcontextprotocol/server'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { BazError, type BazApi } from './bazClient.js'

export const SERVER_INSTRUCTIONS = [
  'Saoirse is the conversational banking assistant inside Saoi, a prototype for Demo Bank. She discovers what',
  'the customer is trying to do, proposes a plan, offers products as cards, collects what each',
  'application needs once, and keeps everything across sessions. All data is synthetic Demo Bank',
  'data: no real account is opened and no real money moves. Relay what your user says in their own',
  'words with saoirse_say, read back what Saoirse said, and when a card arrives put the choice to your',
  'user before saoirse_act.',
  'Keep the handle; it is the conversation.',
].join(' ')

const SYNTHETIC = 'All data is synthetic Demo Bank data; nothing real is opened or moved.'

const handle = z
  .string()
  .min(16)
  .max(2000)
  .describe('Opaque conversation handle returned by saoirse_start. Pass it back unchanged.')

export const bazStartInput = z.object({
  source: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe('Optional short label for where the user came from, e.g. "claude".'),
})

export const bazSayInput = z.object({
  handle,
  message: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("What the customer said, in the customer's own words (max 2000 characters)."),
})

export const bazStatusInput = z.object({ handle })

/** The taps an agent may make for its user; a subset of Saoirse's case actions. Each mirrors a card. */
export const bazActAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('select_products'),
    products: z
      .array(
        z.object({ product: z.string().min(1).max(40), catalogueId: z.string().min(1).max(80).optional() }),
      )
      .min(1)
      .max(6),
  }),
  z.object({
    action: z.literal('decide_plan'),
    planId: z.uuid(),
    decision: z.enum(['keep', 'not_now', 'pause', 'resume', 'abandon']),
  }),
  z.object({
    action: z.literal('submit_application'),
    applicationId: z.uuid(),
    confirmations: z.array(z.string().min(1).max(80)).max(40).default([]),
  }),
  z.object({ action: z.literal('pause_application'), applicationId: z.uuid() }),
  z.object({ action: z.literal('resume_application'), applicationId: z.uuid() }),
  z.object({ action: z.literal('decline_product'), product: z.string().min(1).max(40) }),
  z.object({
    action: z.literal('link_accounts'),
    bank: z.string().min(1).max(40),
    scope: z
      .array(z.enum(['balances', 'transactions', 'payments']))
      .min(1)
      .default(['balances', 'transactions', 'payments']),
  }),
  z.object({
    action: z.literal('initiate_transfer'),
    fromAccountId: z.uuid(),
    toApplicationId: z.uuid().nullable(),
    amount: z.number().positive(),
    cadence: z.enum(['once', 'monthly']).default('once'),
  }),
])

/**
 * The tool-facing input is one flat object (many MCP clients reject a top-level `oneOf`); the
 * handler then validates the fields each action needs against `bazActAction`.
 */
export const bazActInput = z.object({
  handle,
  action: z
    .enum([
      'select_products',
      'decide_plan',
      'submit_application',
      'pause_application',
      'resume_application',
      'decline_product',
      'link_accounts',
      'initiate_transfer',
    ])
    .describe('Which card action to take. Each action needs its own fields below.'),
  products: z
    .array(
      z.object({
        product: z.string().min(1).max(40).describe('Product key from the options card.'),
        catalogueId: z.string().min(1).max(80).optional().describe('Catalogue id from the options card.'),
      }),
    )
    .min(1)
    .max(6)
    .optional()
    .describe('select_products: the options the user chose (1 to 6).'),
  planId: z.uuid().optional().describe('decide_plan: id of the plan on the plan_proposal card.'),
  decision: z
    .enum(['keep', 'not_now', 'pause', 'resume', 'abandon'])
    .optional()
    .describe('decide_plan: what the user decided about the plan.'),
  applicationId: z
    .uuid()
    .optional()
    .describe('submit_application, pause_application, resume_application: the application id.'),
  confirmations: z
    .array(z.string().min(1).max(80))
    .max(40)
    .optional()
    .describe('submit_application: requirement ids of the confirmations the user accepted.'),
  product: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe('decline_product: the product key the user declined.'),
  bank: z.string().min(1).max(40).optional().describe('link_accounts: the bank id the user picked.'),
  scope: z
    .array(z.enum(['balances', 'transactions', 'payments']))
    .min(1)
    .optional()
    .describe('link_accounts: what access to grant (default all three).'),
  fromAccountId: z.uuid().optional().describe('initiate_transfer: source account id from the transfer card.'),
  toApplicationId: z
    .uuid()
    .nullable()
    .optional()
    .describe('initiate_transfer: destination application id from the transfer card, or null.'),
  amount: z.number().positive().optional().describe('initiate_transfer: amount in euro (positive).'),
  cadence: z.enum(['once', 'monthly']).optional().describe('initiate_transfer: once (default) or monthly.'),
})

/** What an agent may do with each card, said once per card type so it never has to guess. */
export function actionsFor(cards: readonly unknown[]): readonly string[] {
  const types = new Set(
    cards.flatMap((card) =>
      typeof card === 'object' && card !== null && typeof (card as { type?: unknown }).type === 'string'
        ? [(card as { type: string }).type]
        : [],
    ),
  )
  const offers: string[] = []
  if (types.has('product_options') || types.has('arrangement'))
    offers.push('saoirse_act select_products with the product and catalogueId of each option the user wants')
  if (types.has('plan_proposal')) offers.push('saoirse_act decide_plan keep (or not_now) with the planId')
  if (types.has('review'))
    offers.push(
      'saoirse_act submit_application with the applicationId and the requirementIds of the confirmations the user accepts',
    )
  if (types.has('pause_prompt'))
    offers.push('saoirse_act pause_application or resume_application with the applicationId')
  if (types.has('connect_accounts')) offers.push('saoirse_act link_accounts with the bank id the user picks')
  if (types.has('transfer'))
    offers.push(
      'saoirse_act initiate_transfer with the fromAccountId, toApplicationId, amount and cadence on the card',
    )
  if (types.has('sign_in'))
    offers.push('signing in needs the person and an email code, so it happens in the Saoi app, not here')
  return offers
}

const ok = (text: string, structuredContent: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent,
})

const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

const withOffers = (reply: string, offers: readonly string[]): string =>
  [
    reply,
    ...(offers.length > 0 ? ['', 'Cards on screen offer:', ...offers.map((offer) => `- ${offer}`)] : []),
  ].join('\n')

/** Business failures become `isError` results with a plain message; detail never includes handles. */
async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof BazError) return fail(error.message)
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      return fail('Saoirse took too long to reply. Try again.')
    console.error('tool error:', error instanceof Error ? error.name : 'unknown')
    return fail('Saoirse is unavailable right now. Try again shortly.')
  }
}

export function registerTools(server: McpServer, baz: BazApi): void {
  server.registerTool(
    'saoirse_start',
    {
      title: 'Start a Saoirse conversation',
      description:
        'Start a new conversation with Saoirse, the conversational banking assistant in Saoi, for Demo Bank. Use this first, ' +
        'once per customer, before any other saoirse_ tool. Returns a handle to pass to the other tools and the ' +
        `opening question Saoirse asks. ${SYNTHETIC}`,
      inputSchema: bazStartInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ source }) =>
      guarded(async () => {
        const started = await baz.start(source)
        return ok(
          'Saoirse is ready. She opens with one question: "What are you trying to do?" Relay your user\'s answer in their own words with saoirse_say. Keep the handle.',
          { handle: started.handle, caseId: started.caseId, opening: 'What are you trying to do?' },
        )
      }),
  )

  server.registerTool(
    'saoirse_say',
    {
      title: 'Say something to Saoirse',
      description:
        "Say something to Saoirse as the customer, in the customer's own words, and get Saoirse's reply. Use this for " +
        'every customer message after saoirse_start. The reply comes with any cards Saoirse put on screen as data ' +
        '(product options, a plan, a review) and the saoirse_act actions each card offers. A card is a decision for ' +
        `your user: put it to them before you call saoirse_act. ${SYNTHETIC}`,
      inputSchema: bazSayInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ handle: h, message }) =>
      guarded(async () => {
        const turn = await baz.say(h, message)
        const next = actionsFor(turn.cards)
        return ok(withOffers(turn.reply, next), { reply: turn.reply, cards: turn.cards, actions: next })
      }),
  )

  server.registerTool(
    'saoirse_act',
    {
      title: 'Tap a Saoirse card for the user',
      description:
        'Tap a card on behalf of your user, only after they have decided: start the products on an options card, ' +
        'keep or pause a plan, submit a review, link accounts, move money. Never call this without the user ' +
        'having chosen. Set action, then only the fields that action needs. Saoirse replies to what was done. ' +
        SYNTHETIC,
      inputSchema: bazActInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ handle: h, ...fields }) =>
      guarded(async () => {
        const parsed = bazActAction.safeParse(
          Object.fromEntries(Object.entries<unknown>(fields).filter(([, value]) => value !== undefined)),
        )
        if (!parsed.success)
          return fail(
            `saoirse_act: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'action'}: ${issue.message}`).join('; ')}`,
          )
        const result = await baz.act(h, parsed.data)
        const next = actionsFor(result.turn.cards)
        return ok(withOffers(`${result.summary}\n\n${result.turn.reply}`, next), {
          done: result.done,
          reply: result.turn.reply,
          cards: result.turn.cards,
          actions: next,
        })
      }),
  )

  server.registerTool(
    'saoirse_status',
    {
      title: 'Saoirse application status',
      description:
        'Where everything stands: the applications on the case and the state of each. Use it when the user asks ' +
        `"where are we" or after an action. Read-only. ${SYNTHETIC}`,
      inputSchema: bazStatusInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ handle: h }) =>
      guarded(async () => {
        const { caseId, applications } = await baz.status(h)
        const text =
          applications.length === 0
            ? 'Nothing has been started yet.'
            : applications
                .map((row) => `${row.display_name ?? row.product}: ${row.state.replaceAll('_', ' ')}`)
                .join('\n')
        return ok(text, { caseId, applications })
      }),
  )
}
