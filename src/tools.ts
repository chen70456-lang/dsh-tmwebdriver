/**
 * Structured browser tools over the TMWebDriver link endpoint. Two high-value,
 * reliability-first tools: `browser_snapshot` (read visible page text) and
 * `browser_type` (type into an input with framework-aware events). Navigation,
 * clicking, and everything else stay on `browser_execute_js`, which remains the
 * universal fallback.
 * @module dsh-tmwebdriver/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { resolveTarget, runJs, linkCommand } from './index.ts'

/** Shared target parameters for the structured tools. */
const TARGET_PARAMS = {
  sessionId: { type: 'string', description: 'Target tab id from browser_list_tabs. Omit to use urlPattern or the master default.' },
  urlPattern: { type: 'string', description: 'URL substring to locate the target tab when sessionId is omitted.' },
} as const

/** The canonical `browser_snapshot` output. */
export interface SnapshotOutput {
  /** Visible page text, whitespace-collapsed and capped. */
  text: string
  /** The page URL the snapshot came from. */
  url: string
  /** Whether the page text was truncated by the cap. */
  truncated: boolean
  /** The tab snapshotted, when known. */
  sessionId?: string
}

/** The canonical `browser_type` output. */
export interface TypeOutput {
  /** Whether an input matched the selector and received the text. */
  typed: boolean
  /** The tab typed in, when known. */
  sessionId?: string
}

/**
 * The `browser_snapshot` tool: read the target tab visible text, reduced.
 */
function defineSnapshotTool(linkUrl: string, timeoutMs: number, maxChars: number) {
  return defineTool({
    name: 'browser_snapshot',
    description:
      'Read the target tab visible page text (innerText, whitespace-collapsed) '
      + 'capped at ' + String(maxChars) + ' characters. Cheaper and more reliable than '
      + 'hand-writing JavaScript for a quick look at what the page shows.',
    parameters: {
      ...TARGET_PARAMS,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          url: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          sessionId: { type: 'string' },
        },
      },
      render: (_args, value: SnapshotOutput) => [
        { type: 'text', text: value.truncated ? value.text + '\n…[truncated]' : value.text },
      ],
      presentationMeta: (_args, value: SnapshotOutput): JsonValue => ({ text: value.text, truncated: value.truncated }),
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec: ToolRunContext): Promise<SnapshotOutput> {
      const sid = await resolveTarget(linkUrl, args.sessionId, args.urlPattern, exec.signal)
      const cap = JSON.stringify(maxChars)
      const data = await runJs(linkUrl,
        '(function(){'
        + '  var t = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim();'
        + '  return { text: t.slice(0, ' + cap + '), url: location.href, truncated: t.length > ' + cap + ' };'
        + '})()',
        sid, exec.signal)
      const obj = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
      return {
        text: typeof obj.text === 'string' ? obj.text : '',
        url: typeof obj.url === 'string' ? obj.url : '',
        truncated: obj.truncated === true,
        ...(sid !== undefined ? { sessionId: sid } : {}),
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.sessionId !== undefined ? 'Snapshot tab ' + args.sessionId : 'Snapshot tab',
      kind: 'read',
    }),
  })
}

/**
 * The `browser_type` tool: type text into an input/textarea by CSS selector.
 */
function defineTypeTool(linkUrl: string, timeoutMs: number) {
  return defineTool({
    name: 'browser_type',
    description:
      'Type text into an input or textarea in the target tab, selected by CSS selector. '
      + 'Uses the native value setter plus input/change events so React/Vue frameworks '
      + 'see the change. Set pressEnter to submit the nearest form after typing.',
    parameters: {
      selector: { type: 'string', required: true, description: 'CSS selector of the input element.' },
      text: { type: 'string', required: true, description: 'Text to type into the field.' },
      pressEnter: { type: 'boolean', description: 'Submit the nearest form after typing. Defaults to false.' },
      ...TARGET_PARAMS,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          typed: { type: 'boolean', required: true },
          sessionId: { type: 'string' },
        },
      },
      render: (_args, value: TypeOutput) => [
        { type: 'text', text: value.typed ? 'Typed.' : 'No input matched the selector.' },
      ],
      presentationMeta: (_args, value: TypeOutput): JsonValue => ({ typed: value.typed }),
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec: ToolRunContext): Promise<TypeOutput> {
      const sid = await resolveTarget(linkUrl, args.sessionId, args.urlPattern, exec.signal)
      const sel = JSON.stringify(args.selector)
      const text = JSON.stringify(args.text)
      const submit = args.pressEnter === true
      const data = await runJs(linkUrl,
        '(function(){'
        + '  function setNative(el, value) {'
        + '    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;'
        + '    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);'
        + '    el.dispatchEvent(new Event("input", {bubbles:true}));'
        + '    el.dispatchEvent(new Event("change", {bubbles:true}));'
        + '  }'
        + '  var el = document.querySelector(' + sel + ');'
        + '  if (!el) return false;'
        + '  if (el.readOnly || el.disabled) return false;'
        + '  el.focus();'
        + '  setNative(el, ' + text + ');'
        + '  if (' + (submit ? 'true' : 'false') + ') {'
        + '    var form = el.closest("form");'
        + '    if (form) { form.submit(); return true; }'
        + '  }'
        + '  return true;'
        + '})()',
        sid, exec.signal)
      return {
        typed: data === true,
        ...(sid !== undefined ? { sessionId: sid } : {}),
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Type into ' + args.selector,
      kind: 'execute',
      rawInput: args.text.slice(0, 60),
    }),
  })
}

/**
 * Register the two structured browser tools.
 *
 * @param ctx - the Cordis context.
 * @param linkUrl - the TMWebDriver link endpoint.
 * @param timeoutMs - per-call cooperative timeout budget.
 */
export function applyStructuredTools(ctx: Context, linkUrl: string, timeoutMs: number, snapshotMaxChars = 8_000): void {
  ctx.tools.register(defineSnapshotTool(linkUrl, timeoutMs, snapshotMaxChars))
  ctx.tools.register(defineTypeTool(linkUrl, timeoutMs))
}
