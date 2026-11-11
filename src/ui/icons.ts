/// <reference lib="dom" />

export type IconName =
  | 'saoirse'
  | 'house'
  | 'house-plus'
  | 'key-round'
  | 'landmark'
  | 'building-2'
  | 'hammer'
  | 'piggy-bank'
  | 'sparkles'
  | 'external-link'
  | 'chevron-right'
  | 'pencil'
  | 'info'

/** Draws one icon: a 24-unit SVG, decorative (`aria-hidden`), in the text colour around it. */
export type Icon = (name: IconName, size?: number) => SVGElement

/**
 * The cards' icons, as one self-contained function: the card's script is this function's own
 * source (see `homeCalculatorResource.ts`), so nothing here may reach outside its body at runtime.
 * Every shape is a constant path set with `setAttribute('d', …)`; circles are written as two arcs.
 * `saoirse` is Saoirse's mark (saoi-web `src/saoirse/SaoirseMark.tsx`), not a Lucide icon: a 64-unit
 * ring with a squared top-left corner and two square eyes, stroked in the text colour.
 */
export function cardIcons(doc: Document): Icon {
  // Path data from Lucide (https://lucide.dev), ISC licence, lucide-react 1.49.0.
  const PATHS: Record<Exclude<IconName, 'saoirse'>, readonly string[]> = {
    house: [
      'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8',
      'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    ],
    'house-plus': [
      'M12.35 21H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v2.35',
      'M14.8 12.4A1 1 0 0 0 14 12h-4a1 1 0 0 0-1 1v8',
      'M15 18h6',
      'M18 15v6',
    ],
    'key-round': [
      'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
      'M16 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0',
    ],
    landmark: [
      'M10 18v-7',
      'M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z',
      'M14 18v-7',
      'M18 18v-7',
      'M3 22h18',
      'M6 18v-7',
    ],
    'building-2': [
      'M10 12h4',
      'M10 8h4',
      'M14 21v-3a2 2 0 0 0-4 0v3',
      'M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2',
      'M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16',
    ],
    hammer: [
      'm15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9',
      'm18 15 4-4',
      'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5',
    ],
    'piggy-bank': [
      'M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z',
      'M16 10h.01',
      'M2 8v1a2 2 0 0 0 2 2h1',
    ],
    sparkles: [
      'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      'M20 2v4',
      'M22 4h-4',
      'M2 20a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    ],
    'external-link': ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    'chevron-right': ['m9 18 6-6-6-6'],
    pencil: [
      'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      'm15 5 4 4',
    ],
    info: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M12 16v-4', 'M12 8h.01'],
  }
  /** Saoirse's mark: each path with its own stroke width, inside one stroked group. */
  const MARK: readonly (readonly [string, string])[] = [
    [
      'M7 32C7 18.1929 18.1929 7 32 7C45.8071 7 57 18.1929 57 32C57 45.8071 45.8071 57 32 57C18.1929 57 7 45.8071 7 32ZM7 32V0',
      '14',
    ],
    ['M22 29H28', '6'],
    ['M37 29H43', '6'],
  ]
  const NS = 'http://www.w3.org/2000/svg'
  const mark = (size: number): SVGElement => {
    const svg = doc.createElementNS(NS, 'svg')
    const attrs: [string, string][] = [
      ['width', String(size)],
      ['height', String(size)],
      ['viewBox', '0 0 64 64'],
      ['fill', 'none'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
      ['class', 'icon icon-saoirse'],
    ]
    for (const [key, value] of attrs) svg.setAttribute(key, value)
    const group = doc.createElementNS(NS, 'g')
    group.setAttribute('stroke', 'currentColor')
    for (const [d, width] of MARK) {
      const path = doc.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('stroke-width', width)
      group.append(path)
    }
    svg.append(group)
    return svg
  }
  return (name, size = 16) => {
    if (name === 'saoirse') return mark(size)
    const svg = doc.createElementNS(NS, 'svg')
    const attrs: [string, string][] = [
      ['width', String(size)],
      ['height', String(size)],
      ['viewBox', '0 0 24 24'],
      ['fill', 'none'],
      ['stroke', 'currentColor'],
      ['stroke-width', '2'],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
      ['aria-hidden', 'true'],
      ['focusable', 'false'],
      ['class', `icon icon-${name}`],
    ]
    for (const [key, value] of attrs) svg.setAttribute(key, value)
    for (const d of PATHS[name]) {
      const path = doc.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      svg.append(path)
    }
    return svg
  }
}
