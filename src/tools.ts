import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'
import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { OPERATIONS } from './generated/operations.js'
import {
  renderAbout,
  renderDebt,
  gatedHomeContent,
  homeGate,
  renderFirstHome,
  renderHomeCalculator,
  renderHomeGate,
  renderMoneyCheck,
  renderMortgage,
  renderPlan,
  renderProduct,
  renderProjection,
  renderReview,
  renderSaved,
  renderSearch,
} from './render.js'
import { SaoiError, type Body, type SaoiApi } from './saoiClient.js'
import { HOME_CALCULATOR_TOOL_META, registerHomeCalculatorCard } from './ui/homeCalculatorResource.js'
import { PLAN_CARD_TOOL_META, registerPlanCard } from './ui/planCardResource.js'

export const SERVER_INSTRUCTIONS = [
  'Saoi compares products and does the arithmetic on the figures the customer gives; it is information, not advice',
  'or a recommendation, and it does not say which product is right for anyone. Saoi is not regulated by the Central',
  'Bank of Ireland, so Central Bank consumer protection rules and compensation schemes do not cover it. Saoi earns',
  'nothing from any provider. Never present a single option as right for the customer.',
  '',
  'What the tools cover: Irish savings, deposit, mortgage, loan, credit card and current account products,',
  "compared against the customer's own figures with the arithmetic done (interest after DIRT, repayments, total",
  'cost, the month a goal is reached); Irish product rates, deposit guarantees, Help to Buy and the Central Bank',
  'lending limits, each with its source and the date it was checked. Where a tool does not have a fact, say so.',
  '',
  'When each tool applies:',
  '- saoi_money_check: the customer asks about, or gives figures for, their own money in Ireland: money in a',
  '  current account, saving for a house or anything else, a loan or credit card balance, a mortgage or switching,',
  '  Help to Buy, where to put savings, whether they are paying too much. Pass whatever they have said, however',
  '  partial; it returns what Saoi finds, a plan or the questions that unlock one, and a link to save the plan.',
  '- saoi_home_calculator: the customer asks about buying a home. On every call, pass everything they have said',
  '  so far in the conversation (deposit, monthly saving, income, `buyingTogether` and the second income, price,',
  '  date, debts, their bank and whether to stay with it, fixed or variable, first-time buyer, new build).',
  '  The card waits for four core figures: funds saved, monthly saving, income (both incomes when buying',
  '  together), and a price or a date. Until they are in, the result is one or two questions and nothing else:',
  '  ask those in plain words, with no figures, and call again with everything said once they answer.',
  '  Once they are in, hosts that show cards show the card. In a host without cards the figures come as text;',
  '  saoi_build_plan with a house_deposit goal, `homePrice`, `propertyKind` and `homePreferences` (their own',
  '  filters and the sort order they pick) then returns the link into Saoi, which plays the part of the button.',
  '  Results list every route to a home as facts, schemes included, and',
  '  the customer chooses between them: relay the route lines as given, in their order, and never call one the best.',
  '- The home card is the end of the conversation in this chat. After it, every follow-up ("tell me more", "what',
  '  about the other supports", "which mortgage") is answered by pointing at the card\'s button, "Compare all',
  '  product options and supports", which opens Saoi with everything behind the tiles: not by another tool call',
  '  and not by a narrative. Call saoi_home_calculator again only when the customer changes a figure.',
  '- saoi_first_home: a question about Help to Buy, the Central Bank lending limits or a deposit for a first home.',
  '- The other tools answer a follow-up on one part: one category ranked, one product, a projection, a mortgage,',
  '  debts.',
  '',
  'One plan call per reply:',
  '- Call saoi_money_check OR saoi_build_plan, once, per reply; never both for the same message, never twice.',
  '  saoi_money_check comes first in a conversation; saoi_build_plan is for later replies once a plan exists.',
  '- To compare options in that reply (keep the loan or clear it, another monthly amount or',
  '  date), pass up to three `alternatives` in the same call. Each comes back with its own net figure, and the',
  '  card shows them side by side. Do not call the tool once per option.',
  '- Call again only when the customer changes their situation or asks something new in a later message.',
  '',
  'How to present results:',
  "- Ask one question per reply: the result's `nextQuestion` (its last presentation line), the one whose answer",
  '  would change the plan most. Never ask a list of questions, and never ask before the first plan: the first',
  "  call already returns a plan on stated assumptions. The home card's gate is the one exception: its one or",
  '  two questions come before the card.',
  '- Every result starts with "Present to the customer". Relay that block first, in its own words and order: it',
  '  holds the money found, one net figure per scenario (savings less what is still owed), and for a plan the',
  '  link that opens it in the Saoi app. The detail below it is for questions.',
  '- Present the options as a comparison, in the order the customer chose, with their figures; the customer',
  '  decides and chooses. Never pick a product, lender or combination for them, never say which is best for them,',
  '  what you would do, or what "the numbers support". A preference they gave (stay with my bank, fixed only) is',
  '  their filter: say so ("showing Bank of Ireland options, as you asked").',
  '- Never instruct: no "clear", "pay off", "set up", "move", "open", "switch", "ask", "don\'t", "you should".',
  '  Give each option as a fact with its figure, e.g.:',
  '    not "Clear the €9,000 car loan", but "Clearing the €9,000 car loan from savings leaves €785 more by November',
  '    2028 than keeping it";',
  '    not "Don\'t lock anything up", but "A fixed term would add €24 by November 2028 and lock the money until',
  '    then";',
  '    not "Pay the old car repayment into savings", but "In this plan the €410 a month that went to the car loan',
  '    is saved".',
  "- Use the tools' figures; do not recompute, add up, extend or adjust them. Compare scenarios by their net",
  '  figures only, from the alternatives in the result.',
  '- Keep every debt the customer mentioned in each call. To model keeping or clearing one, set its `plan`',
  '  ("keep" or "clear"); never drop it from the call, or the plan has no debt to set against the savings.',
  '- Money in a current account goes in with `access: "current_account"`: it counts as earning 0%, as CCPC shows.',
  '- Show the flags, unknowns and deposit guarantees, say "check eligibility" where a result does, and show the',
  '  CCPC attribution with CCPC figures.',
  '- An emergency buffer is modelled only when the customer raises one. Never add a buffer, a buffer alternative',
  '  or a buffer suggestion they did not ask for.',
  '- Compare options by the amount towards the goal (each option line leads with it); the total held is secondary.',
  '- Show the mortgage warnings with any mortgage figures, and say Saoi is not regulated and does not give advice.',
  '',
  'Saving the comparison:',
  '- Each plan result carries one single-use link ("Save this comparison to the Saoi app: …"), held for 24',
  '  hours, then deleted unless opened. Nothing else is stored. Offer the customer that one link; saving is their',
  '  choice.',
  '- In the app the comparison opens as a card that Saoirse (Saoi’s assistant) knows and can talk through, and signing',
  '  in with an email keeps it across devices. After sign-in the app also offers rate-change alerts and goal-date',
  '  reminders.',
  '- saoi_save_plan is only for a plan that came back without a link.',
  '',
  'The prompts are optional. money-check-up walks the same path: saoi_money_check first, saoi_build_plan after.',
  'saoi (shown as /saoi in Claude) starts the home conversation: saoi_home_calculator with what was said, then the',
  'gate questions until the card.',
].join('\n')

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

type Name = keyof typeof OPERATIONS

/**
 * Phrases that tell a model to call a tool unprompted or steer it away from other tools. The
 * hand-written `when` says when a tool applies; saoi-api's text is written for its own docs.
 */
const STEERING = [/start here/i, /without waiting/i, /as soon as/i, /searching the web/i, /is the source/i]

/** saoi-api's summary or description without the sentences that steer (see STEERING). */
export function neutral(text: string): string {
  const unprefixed = text.replace(/^start here:\s*/i, '')
  const capitalised = unprefixed.charAt(0).toUpperCase() + unprefixed.slice(1)
  return capitalised
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !STEERING.some((pattern) => pattern.test(sentence)))
    .join(' ')
}

const describe = (name: Name, when: string): string => {
  const operation = OPERATIONS[name]
  return `${when} ${neutral(operation.summary)}. ${neutral(operation.description)}`
}

/** The side effect of the three tools that write, in the same words each time. */
const DRAFT_HELD =
  'a draft of the comparison is held for 24 hours behind a single-use link, then deleted unless opened; nothing else is stored.'

const ok = (text: string, structuredContent: object): CallToolResult => ({
  content: [{ type: 'text', text }],
  structuredContent: structuredContent,
})

const fail = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** Errors become results the model can act on; nothing internal is passed through. */
async function attempt(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
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

/** Tools whose results the plan card renders in MCP Apps hosts (`_meta.ui`). */
const CARD_TOOLS: ReadonlySet<string> = new Set([
  'saoi_money_check',
  'saoi_build_plan',
  'saoi_home_calculator',
])

/**
 * One line per tool call, for diagnosing a test afterwards (`docker logs saoi-mcp`): the tool,
 * how long it took, the outcome, and whether the plan card was attached. Never the inputs, the
 * caller's address or any figure.
 */
export function toolCallLine(entry: {
  tool: string
  ms: number
  outcome: 'ok' | 'error'
  ui: boolean
}): string {
  return JSON.stringify({ event: 'tool_call', ...entry })
}

/** True when the home calculator's gate held the card back: the result carries `gate.ready` false. */
function gateClosed(result: CallToolResult): boolean {
  const gate = (result.structuredContent as { gate?: { ready?: unknown } } | undefined)?.gate
  return gate?.ready === false
}

async function guarded(tool: string, work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  const started = performance.now()
  const result = await attempt(work)
  const outcome = result.isError === true ? 'error' : 'ok'
  console.log(
    toolCallLine({
      tool,
      ms: Math.round(performance.now() - started),
      outcome,
      ui: outcome === 'ok' && CARD_TOOLS.has(tool) && !gateClosed(result),
    }),
  )
  return result
}

const input = (name: Name) => fromJsonSchema<Body>(OPERATIONS[name].inputSchema)

/** `ip` is the end user's address from the request this server instance serves, if known. */
export function registerTools(server: McpServer, saoi: SaoiApi, ip?: string): void {
  server.registerTool(
    'saoi_money_check',
    {
      title: 'Money check',
      description: describe(
        'saoi_money_check',
        `Use this when the customer asks about, or gives figures for, their own money in Ireland: money in a current account, saving for a house or anything else, a loan or credit card balance, a mortgage or switching, Help to Buy, where to put savings, whether they are paying too much. Pass whatever they have said so far, however partial. It is the first plan call in a conversation. Do not use it for a later reply once a plan exists (saoi_build_plan), alongside saoi_build_plan, or once per option: pass up to three \`alternatives\` in this one call. Side effect: when a plan comes back, ${DRAFT_HELD}`,
      ),
      inputSchema: input('saoi_money_check'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: PLAN_CARD_TOOL_META,
    },
    (args) =>
      guarded('saoi_money_check', async () => {
        const result = await saoi.moneyCheck(args, ip)
        return ok(renderMoneyCheck(result), result)
      }),
  )

  server.registerTool(
    'saoi_review_situation',
    {
      title: 'Review a money situation',
      description: describe(
        'saoi_review_situation',
        'Use this when only the findings are wanted again after a figure changed, once saoi_money_check has run. Do not use it for the first look at the customer’s money (saoi_money_check) or for a plan (saoi_build_plan). Reads only; nothing is stored.',
      ),
      inputSchema: input('saoi_review_situation'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_review_situation', async () => {
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
        'Use this when the customer asks to rank one category (savings, deposits, mortgages, loans, cards, current accounts) for given amounts, e.g. "the highest-paying 2-year fixed deposits for €10,000". Do not use it for a plan across the customer’s whole situation (saoi_money_check, saoi_build_plan). Reads only; nothing is stored.',
      ),
      inputSchema: input('saoi_search_products'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_search_products', async () => {
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
        'Use this when the customer asks about one product from a result in full: its terms, rate history, unknowns, source and the provider’s own words. Do not use it to rank products (saoi_search_products). Reads only; nothing is stored.',
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
      guarded('saoi_product', async () => {
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
        'Use this when the customer asks how named products grow month by month, or when a target is reached in them. Do not use it for a plan that weighs goals, debts and a buffer (saoi_build_plan). Reads only; nothing is stored.',
      ),
      inputSchema: input('saoi_savings_projection'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_savings_projection', async () => {
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
        'Use this when the customer asks about an existing mortgage ("is it worth switching", mode switch) or what an income and deposit allow for a home that is not their first (mode affordability). Do not use it for a first home (saoi_first_home). Send the fields of the chosen mode only. Reads only; nothing is stored.',
      ),
      inputSchema: input('saoi_mortgage'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_mortgage', async () => {
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
        'Use this when the customer asks about their debts alone: what each costs, the payoff order, overpaying against saving, and cheaper refinancing. Do not use it for a plan that sets debts against savings goals (saoi_build_plan). Reads only; nothing is stored or arranged.',
      ),
      inputSchema: input('saoi_debt'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_debt', async () => {
        const result = await saoi.debt(args, ip)
        return ok(renderDebt(result), result)
      }),
  )

  server.registerTool(
    'saoi_first_home',
    {
      title: 'A first home: Help to Buy and the lending limits',
      description: describe(
        'saoi_first_home',
        'Use this when the customer asks about buying a first home in Ireland or saving a deposit for one: Help to Buy, the Central Bank lending limits, what a deposit and income allow, a price, green mortgage rates; every rule comes with its source page and the date it was read. Do not use it for an existing mortgage or a home that is not their first (saoi_mortgage), or to open the interactive calculator (saoi_home_calculator). Give the kind of property, the price and tax paid when known; what is not given is shown as depending on it, never assumed. Reads only; nothing is stored.',
      ),
      inputSchema: input('saoi_first_home'),
      annotations: READ_ONLY,
    },
    (args) =>
      guarded('saoi_first_home', async () => {
        const result = await saoi.firstHome(args, ip)
        return ok(renderFirstHome(result), result)
      }),
  )

  server.registerTool(
    'saoi_home_calculator',
    {
      title: 'Home calculator: buying a home',
      description: describe(
        'saoi_home_calculator',
        'Use this when the customer asks about buying a home. On every call, pass everything they have said so far in the conversation (all optional; `buyingTogether` when they buy with someone), so the call after they answer a question passes the gate. The card waits for four core figures: funds saved, monthly saving, income (both incomes when buying together), and a price or a date. Until they are in, it returns only the one or two questions for the next reply, each with what it moves, and no card: ask those in plain words and nothing else, with no figures. Once they are in, hosts that show cards show the calculator prefilled with it: the month the money for the keys is ready, three tiles, the other supports, and one button, "Compare all product options and supports", which opens Saoi. The card is the end of the conversation in this chat: a follow-up about it ("tell me more", "what about the other supports", "which mortgage") is answered by pointing at that button, not by another tool call or a narrative; call again only when the customer changes a figure. In a host without cards the same figures come as text, and saoi_build_plan with a house_deposit goal and `homePreferences` returns the link into Saoi. Do not use it for a single question on Help to Buy or the lending limits (saoi_first_home), for an existing mortgage (saoi_mortgage), or to answer a follow-up once the card is shown. It never picks a product. Nothing the customer sends is stored; each run is counted anonymously in bands, with no figures and no identifiers.',
      ),
      inputSchema: input('saoi_home_calculator'),
      annotations: READ_ONLY,
      _meta: HOME_CALCULATOR_TOOL_META,
    },
    (args) =>
      guarded('saoi_home_calculator', async () => {
        const result = await saoi.homeCalculator(args, ip)
        const gate = homeGate(result)
        // The gate closed: the questions only, and no figure for the text or the card to show.
        if (gate !== null && !gate.ready) return ok(renderHomeGate(gate), gatedHomeContent(result, gate))
        return ok(renderHomeCalculator(result), result)
      }),
  )

  server.registerTool(
    'saoi_build_plan',
    {
      title: 'Compare the options for the customer’s goals',
      description: describe(
        'saoi_build_plan',
        'Use this when a plan already exists in the conversation and, in a later message, the customer changes their situation or asks something new. Do not use it for the first look at the customer’s money (saoi_money_check), alongside saoi_money_check, more than once per reply, or once per option. To compare options (keeping the money accessible, the monthly amount, the date, keeping or clearing a debt), pass up to three `alternatives` in this one call; call again only when the customer changes their situation in a later message. To model keeping a debt, keep it in situation.debts with plan "keep"; never leave it out. For a home, pass `homePreferences` with the customer’s own filters (their bank and whether to stay with it, fixed or variable, green) and the sort they pick (cost over 5 years, keys date, monthly repayment): every eligible option comes back in that order, never one pick. Returns a worked combination under the stated rule with its runners-up, a link that holds the comparison for 24 hours so the customer can save it to the Saoi app (the only thing stored), the reasoning, the liquidity figures, what-ifs and Help to Buy for a home. Relay its "Present to the customer" block first. Side effect: ' +
          DRAFT_HELD,
      ),
      inputSchema: input('saoi_build_plan'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      // Hosts with MCP Apps show the plan card with the result; the text stays for the rest.
      _meta: PLAN_CARD_TOOL_META,
    },
    (args) =>
      guarded('saoi_build_plan', async () => {
        const result = await saoi.buildPlan(args, ip)
        return ok(renderPlan(result), result)
      }),
  )

  server.registerTool(
    'saoi_save_plan',
    {
      title: 'Save the plan into the Saoi app',
      description:
        'Use this when saoi_build_plan returned no save link (saveLink null). Do not use it for a plan that already ' +
        'came back with a link. Pass `plan` exactly as it returned it; it returns the link into app.saoi.ie to give ' +
        `the customer. Side effect: ${DRAFT_HELD} ` +
        neutral(OPERATIONS.saoi_save_plan.description),
      inputSchema: input('saoi_save_plan'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      guarded('saoi_save_plan', async () => {
        const result = await saoi.savePlan(args, ip)
        return ok(renderSaved(result), result)
      }),
  )
}

export const ABOUT_RESOURCES = {
  ranking: { uri: 'saoi://about/ranking', name: 'how-saoi-ranks', title: 'How Saoi ranks' },
  earnings: { uri: 'saoi://about/earnings', name: 'how-saoi-earns', title: 'How Saoi earns' },
} as const

/** `publicUrl` is the exact connector URL; Claude's card sandbox origin is derived from it. */
export function registerResources(server: McpServer, saoi: SaoiApi, publicUrl: string, ip?: string): void {
  registerPlanCard(server, publicUrl)
  registerHomeCalculatorCard(server, publicUrl)
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
            : 'How Saoi earns: it is free and earns nothing from any provider; how the order is decided; not advice and not regulated; the CCPC attribution.',
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
    '2. Money check. Call saoi_money_check once with what I said. Lead with its "Present to the customer" block: the money found',
    '   (its parts, and what is not counted), then the findings. For a first home, saoi_first_home covers Help to Buy and the limits.',
    '3. Goals. Ask what I want: the candidate goals the review suggests and my own, each with an amount and a date where I have one.',
    '4. Plan. Call saoi_build_plan with my situation and chosen goals, and an emergency buffer if I want one (an amount, or months',
    '   of outgoings). For a house deposit, saoi_mortgage (affordability) shows what it unlocks. Show the products, figures, the date',
    '   each goal is reached, why money is or is not locked away, the what-ifs, flags, unknowns, deposit guarantees, and the CCPC',
    '   attribution. To compare options (keep or clear a loan, another monthly amount), pass them as `alternatives` in that one call;',
    '   call saoi_build_plan again only when I change something in a later message. One plan call per reply.',
    '5. The link. Give me the link that opens the plan in the Saoi app, and say what it does: the plan is held for 24',
    '   hours so I can open it in the app (a card Saoirse knows and can talk through; signing in keeps it across my devices),',
    '   then deleted unless I open it. Nothing else is stored.',
    '',
    'Throughout: quote the tools’ figures and never work them out yourself; compare options through `alternatives`. Present',
    'results as options with their figures ("clearing the loan leaves €X more by…"), never as instructions, advice or "you should":',
    'I decide. Say what each result is ranked by, and that I can ask for a different objective. Say "check eligibility" where a',
    'result does.',
    ...(focus === undefined || focus === '' ? [] : ['', `I would like to start with: ${focus}`]),
  ].join('\n')
}

export const saoiArgs = z.object({
  said: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe(
      'Optional: what the customer has said so far about buying a home, in their words, e.g. "we have €30k saved and put away €1,200 a month".',
    ),
})

/**
 * The `saoi` prompt (`/saoi` in Claude): stage 1 of the first-home journey. What the customer said
 * goes to saoi_home_calculator; until the core figures are in, the reply is its one or two
 * questions and nothing else; the card, once shown, is the end of the conversation here.
 */
export function saoiPrompt(said: string | undefined): string {
  return [
    'I am thinking about buying a home in Ireland. Use Saoi for it.',
    '',
    '1. Call saoi_home_calculator with everything I have said, and on every later call pass all of it again with my new answers.',
    '2. Until the core figures are in, it returns one or two questions instead of the card. Ask me those, in plain words,',
    '   and nothing else: no figures, no estimates, no list of other questions.',
    '3. Once the card is shown, it is the end here. For anything more about it, point me at its button, "Compare all product',
    '   options and supports", which opens Saoi. Call saoi_home_calculator again only when I change a figure.',
    '',
    'Throughout: quote the tools’ figures and never work them out yourself. Never pick a product, lender or route for me',
    'and never say "you should": I decide.',
    ...(said === undefined || said === ''
      ? ['', 'I have not given any figures yet.']
      : ['', `What I have said so far: ${said}`]),
  ].join('\n')
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'saoi',
    {
      title: 'Saoi',
      description:
        'Buying a home: Saoi asks for the few figures it needs, one or two questions at a time, then shows the card with what the limits allow, the money needed at the keys and the month it is saved.',
      argsSchema: saoiArgs,
    },
    ({ said }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: saoiPrompt(said) } }],
    }),
  )
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
