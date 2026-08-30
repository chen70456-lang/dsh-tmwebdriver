/**
 * Structured browser tools over the TMWebDriver link endpoint. Two high-value,
 * reliability-first tools: `browser_snapshot` (read visible page text) and
 * `browser_type` (type into an input with framework-aware events). Navigation,
 * clicking, and everything else stay on `browser_execute_js`, which remains the
 * universal fallback.
 * @module dsh-tmwebdriver/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { resolveTarget, runJs } from "./index.js";
/** Shared target parameters for the structured tools. */
const TARGET_PARAMS = {
    sessionId: { type: 'string', description: 'Target tab id from browser_list_tabs. Omit to use urlPattern or the master default.' },
    urlPattern: { type: 'string', description: 'URL substring to locate the target tab when sessionId is omitted.' },
};
/**
 * The `browser_snapshot` tool: read the target tab visible text, reduced.
 */
function defineSnapshotTool(linkUrl, timeoutMs) {
    const CAP = 20_000;
    return defineTool({
        name: 'browser_snapshot',
        description: 'Read the target tab visible page text (innerText, whitespace-collapsed) '
            + 'capped at ' + String(CAP) + ' characters. Cheaper and more reliable than '
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
            render: (_args, value) => [
                { type: 'text', text: value.truncated ? value.text + '\n…[truncated]' : value.text },
            ],
            presentationMeta: (_args, value) => ({ text: value.text, truncated: value.truncated }),
        },
        timeoutMs,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const sid = await resolveTarget(linkUrl, args.sessionId, args.urlPattern, exec.signal);
            const cap = JSON.stringify(CAP);
            const data = await runJs(linkUrl, '(function(){'
                + '  var t = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim();'
                + '  return { text: t.slice(0, ' + cap + '), url: location.href, truncated: t.length > ' + cap + ' };'
                + '})()', sid, exec.signal);
            const obj = (typeof data === 'object' && data !== null ? data : {});
            return {
                text: typeof obj.text === 'string' ? obj.text : '',
                url: typeof obj.url === 'string' ? obj.url : '',
                truncated: obj.truncated === true,
                ...(sid !== undefined ? { sessionId: sid } : {}),
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: args.sessionId !== undefined ? 'Snapshot tab ' + args.sessionId : 'Snapshot tab',
            kind: 'read',
        }),
    });
}
/**
 * The `browser_type` tool: type text into an input/textarea by CSS selector.
 */
function defineTypeTool(linkUrl, timeoutMs) {
    return defineTool({
        name: 'browser_type',
        description: 'Type text into an input or textarea in the target tab, selected by CSS selector. '
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
            render: (_args, value) => [
                { type: 'text', text: value.typed ? 'Typed.' : 'No input matched the selector.' },
            ],
            presentationMeta: (_args, value) => ({ typed: value.typed }),
        },
        timeoutMs,
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const sid = await resolveTarget(linkUrl, args.sessionId, args.urlPattern, exec.signal);
            const sel = JSON.stringify(args.selector);
            const text = JSON.stringify(args.text);
            const submit = args.pressEnter === true;
            const data = await runJs(linkUrl, '(function(){'
                + '  function setNative(el, value) {'
                + '    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;'
                + '    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);'
                + '    el.dispatchEvent(new Event("input", {bubbles:true}));'
                + '    el.dispatchEvent(new Event("change", {bubbles:true}));'
                + '  }'
                + '  var el = document.querySelector(' + sel + ');'
                + '  if (!el) return false;'
                + '  el.focus();'
                + '  setNative(el, ' + text + ');'
                + '  if (' + (submit ? 'true' : 'false') + ') {'
                + '    var form = el.closest("form");'
                + '    if (form) { form.submit(); return true; }'
                + '  }'
                + '  return true;'
                + '})()', sid, exec.signal);
            return {
                typed: data === true,
                ...(sid !== undefined ? { sessionId: sid } : {}),
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: 'Type into ' + args.selector,
            kind: 'execute',
            rawInput: args.text.slice(0, 60),
        }),
    });
}
/**
 * Register the two structured browser tools.
 *
 * @param ctx - the Cordis context.
 * @param linkUrl - the TMWebDriver link endpoint.
 * @param timeoutMs - per-call cooperative timeout budget.
 */
export function applyStructuredTools(ctx, linkUrl, timeoutMs) {
    ctx.tools.register(defineSnapshotTool(linkUrl, timeoutMs));
    ctx.tools.register(defineTypeTool(linkUrl, timeoutMs));
}
//# sourceMappingURL=tools.js.map