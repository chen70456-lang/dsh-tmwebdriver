/**
 * dsh-tmwebdriver: DSH profile bundle that controls the user's real, logged-in
 * browser through TMWebDriver. The plugin mounts two model-facing tools over
 * the TMWebDriver HTTP link endpoint: `browser_list_tabs` (enumerate scriptable
 * tabs) and `browser_execute_js` (execute JavaScript in a tab, or route a JSON
 * command to the tmwd_cdp_bridge Chrome extension for CDP/cookies/batch).
 *
 * The link endpoint is plain JSON-over-HTTP, so the plugin needs no Python
 * client: every call POSTs a command object to `linkUrl` and reads the `r`
 * field of the response.
 * @module dsh-tmwebdriver
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-tmwebdriver';
/** Services required by the TMWebDriver tools. */
export const inject = ['tools'];
/** Default cooperative per-call timeout budget (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Default TMWebDriver HTTP link endpoint. */
export const DEFAULT_LINK_URL = 'http://127.0.0.1:18766/link';
/** Schemastery configuration for the TMWebDriver tools. */
export const Config = z.object({
    linkUrl: z.string().default(DEFAULT_LINK_URL),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
});
/**
 * Directory containing the bundled `master/tmwebdriver_master.py`. Resolved
 * from this module's own location so a profile link install (or npm package)
 * finds the script next to the compiled entry regardless of cwd.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** The bundled TMWebDriver master script shipped with this package. */
const MASTER_SCRIPT = join(MODULE_DIR, '..', 'master', 'tmwebdriver_master.py');
/** TCP port the TMWebDriver master listens on for HTTP link (18766). */
const MASTER_HTTP_PORT = 18766;
/** The port the master listens on, derived from the configured link URL. */
function linkPort(linkUrl) {
    try {
        const url = new URL(linkUrl);
        return url.port ? Number(url.port) : MASTER_HTTP_PORT;
    }
    catch {
        return MASTER_HTTP_PORT;
    }
}
/** Whether anything is listening on the given TCP port (GA-compatible probe). */
function portOpen(port) {
    return new Promise((resolve) => {
        const socket = connect({ port, host: '127.0.0.1' });
        const done = (open) => {
            socket.destroy();
            resolve(open);
        };
        socket.setTimeout(500);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}
/**
 * The master spawn promise, shared so concurrent tool calls start it once
 * (GA's `is_remote` probe + lazy `first_init_driver` semantics).
 */
let masterStart = null;
/**
 * Ensure the TMWebDriver master is running. Like GA: probe the link port; when
 * nothing listens, spawn the bundled master script, wait until it accepts TCP
 * connections, and leave it running (no auto-shutdown). When a master is
 * already up — started manually or by another client — reuse it.
 *
 * @param linkUrl - the link endpoint (its port is probed).
 * @returns a promise resolving once the master accepts connections.
 */
async function ensureMaster(linkUrl) {
    if (await portOpen(linkPort(linkUrl)))
        return;
    if (masterStart !== null)
        return masterStart;
    masterStart = (async () => {
        const script = MASTER_SCRIPT;
        if (!existsSync(script)) {
            throw new Error(`bundled TMWebDriver master not found at ${script} — install the full package or start the master manually`);
        }
        const child = spawn(process.env.PYTHON ?? 'python', ['-u', script], {
            stdio: 'ignore',
            // Detached so the master outlives the DSH process that lazily started it
            // (GA keeps the master independent of any single client). unref lets the
            // parent exit normally; the master stays up for other clients.
            detached: true,
        });
        child.unref();
        const deadline = Date.now() + 15_000;
        // Wait for the port to open; the master keeps running afterwards (常驻).
        while (Date.now() < deadline) {
            if (await portOpen(linkPort(linkUrl)))
                return;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        child.kill();
        throw new Error(`TMWebDriver master did not start within 15s (python ${process.env.PYTHON ?? 'python'} ${script}). `
            + 'Install Python deps with: python -m pip install -r master/requirements.txt');
    })();
    try {
        await masterStart;
    }
    finally {
        // Allow a later call to retry after a failed start.
        masterStart = null;
    }
}
/** Lossless-JSON projection of one tab, for presentation metadata. */
function tabToJson(tab) {
    return { id: tab.id, url: tab.url, title: tab.title };
}
/** Project a tab list into lossless JSON presentation metadata. */
function tabsToJson(tabs) {
    return tabs.map(tabToJson);
}
/**
 * POST one command object to the TMWebDriver link endpoint and return the
 * parsed `r` field. Throws a structured error when the master is unreachable
 * or the link endpoint reports an error payload.
 *
 * @param linkUrl - the link endpoint.
 * @param payload - the command object (cmd plus arguments).
 * @param signal - cooperative cancellation signal.
 * @returns the response `r` value (any lossless JSON).
 */
async function linkCommand(linkUrl, payload, signal) {
    // GA-compatible lazy start: first call ensures the master is up, reusing an
    // already-running one; later calls probe the port and skip the wait.
    await ensureMaster(linkUrl);
    let response;
    try {
        response = await fetch(linkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
    }
    catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`TMWebDriver master unreachable at ${linkUrl} (${cause})`);
    }
    if (!response.ok) {
        throw new Error(`TMWebDriver link endpoint returned HTTP ${response.status}`);
    }
    const body = (await response.json());
    if (body.error !== undefined)
        throw new Error(`TMWebDriver error: ${body.error}`);
    return body.r;
}
/**
 * Parse a TMWebDriver session record into a {@link TabInfo}. The master emits
 * `{id, url, title, connected_at, type}`; unknown extra fields are ignored.
 *
 * @param raw - one session record.
 * @returns the projected tab, or `null` when the record lacks an id.
 */
function projectTab(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const { id, url, title } = raw;
    if (typeof id !== 'string')
        return null;
    return {
        id,
        url: typeof url === 'string' ? url : '',
        title: typeof title === 'string' ? title : '',
    };
}
/**
 * List scriptable tabs. With no `urlPattern` the master's `get_all_sessions`
 * returns every active session; with one, `find_session` narrows to tabs whose
 * URL contains the pattern.
 *
 * @param linkUrl - the link endpoint.
 * @param urlPattern - optional URL substring filter.
 * @param signal - cooperative cancellation signal.
 * @returns the projected tabs.
 */
async function listTabs(linkUrl, urlPattern, signal) {
    const raw = await linkCommand(linkUrl, urlPattern !== undefined
        ? { cmd: 'find_session', url_pattern: urlPattern }
        : { cmd: 'get_all_sessions' }, signal);
    const tabs = [];
    if (Array.isArray(raw)) {
        for (const item of raw) {
            // find_session returns [sessionId, info] pairs; get_all_sessions returns
            // plain records. Accept both shapes.
            const record = Array.isArray(item) ? item[1] : item;
            const tab = projectTab(record);
            if (tab !== null)
                tabs.push(tab);
        }
    }
    return tabs;
}
/** Render one tab list as model-facing text. */
function renderTabs(tabs) {
    if (tabs.length === 0)
        return [{ type: 'text', text: 'No scriptable tabs found.' }];
    const lines = tabs.map((tab) => `- [${tab.id}] ${tab.title} — ${tab.url}`);
    return [{ type: 'text', text: `Tabs:\n${lines.join('\n')}` }];
}
/** Whether a value looks like a tab list (defensive narrowing of opaque meta). */
function isTabInfoArray(value) {
    return Array.isArray(value) && value.every((item) => {
        if (typeof item !== 'object' || item === null)
            return false;
        const { id, url, title } = item;
        return typeof id === 'string' && typeof url === 'string' && typeof title === 'string';
    });
}
/**
 * The `browser_list_tabs` tool: enumerate the user's scriptable browser tabs
 * through the TMWebDriver master.
 */
function defineListTabsTool(linkUrl, timeoutMs) {
    return defineTool({
        name: 'browser_list_tabs',
        description: 'List the scriptable tabs of the user\'s real browser (via TMWebDriver). '
            + 'Returns each tab\'s id, url, and title. Optional `urlPattern` filters to '
            + 'tabs whose URL contains the substring — pass it to target a specific site.',
        parameters: {
            urlPattern: {
                type: 'string',
                description: 'Optional URL substring; only tabs whose URL contains it are returned.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    tabs: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                id: { type: 'string', required: true },
                                url: { type: 'string', required: true },
                                title: { type: 'string', required: true },
                            },
                        },
                        required: true,
                    },
                },
            },
            render: (_args, value) => renderTabs(value.tabs),
            presentationMeta: (_args, value) => ({
                tabs: tabsToJson(value.tabs),
            }),
        },
        timeoutMs,
        // A tab listing is a read; sibling listings may overlap safely.
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            return { tabs: await listTabs(linkUrl, args.urlPattern, exec.signal) };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: args.urlPattern !== undefined
                ? `List tabs matching "${args.urlPattern}"`
                : 'List browser tabs',
            kind: 'read',
            rawInput: args.urlPattern,
        }),
        presentResult: (args, result) => {
            if (result.isError)
                return undefined;
            const meta = result.meta;
            if (typeof meta !== 'object' || meta === null)
                return undefined;
            const tabs = meta.tabs;
            if (!isTabInfoArray(tabs))
                return undefined;
            const title = args.urlPattern !== undefined
                ? `Tabs matching "${args.urlPattern}"`
                : 'Browser tabs';
            return {
                card: 'generic',
                title,
                kind: 'read',
                content: renderTabs(tabs),
            };
        },
    });
}
/**
 * The `browser_execute_js` tool: run JavaScript in a tab. `code` is plain
 * JavaScript executed in the page's MAIN world, or a JSON command string routed
 * to the tmwd_cdp_bridge extension (`{"cmd":"cdp",...}`, `{"cmd":"cookies"}`,
 * `{"cmd":"batch","commands":[...]}`, `{"cmd":"tabs",...}`). When neither
 * `sessionId` nor `urlPattern` is given, the master's default session is used.
 */
function defineExecuteJsTool(linkUrl, timeoutMs) {
    return defineTool({
        name: 'browser_execute_js',
        description: 'Execute JavaScript in the user\'s real browser (via TMWebDriver). '
            + 'Pass plain JS as `code` (MAIN world, await allowed, explicitly `return` '
            + 'values) to read pages, click, fill forms, or navigate '
            + '(`location.href=\'...\'`). Alternatively pass a JSON command string for '
            + 'the CDP bridge: {"cmd":"cdp","method":"Page.captureScreenshot","params":{...}}, '
            + '{"cmd":"cookies"}, {"cmd":"tabs","method":"create","url":"..."}, or '
            + '{"cmd":"batch","commands":[...]} with $N.path chained references. '
            + 'Target a tab with `sessionId` (from browser_list_tabs) or `urlPattern`; '
            + 'omit both to use the master default.',
        parameters: {
            code: {
                type: 'string',
                required: true,
                description: 'JavaScript to run, or a JSON command string for the CDP bridge.',
            },
            sessionId: {
                type: 'string',
                description: 'Target tab id from browser_list_tabs. Omit to use urlPattern or the master default.',
            },
            urlPattern: {
                type: 'string',
                description: 'URL substring to locate the target tab when sessionId is omitted.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    data: { type: 'json' },
                    sessionId: { type: 'string' },
                },
            },
            render: (_args, value) => {
                const text = typeof value.data === 'string' ? value.data : JSON.stringify(value.data);
                return [{ type: 'text', text: text ?? '' }];
            },
            presentationMeta: (_args, value) => ({ data: value.data }),
        },
        timeoutMs,
        // JS execution mutates page state; sibling calls on the same tab race.
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            let sessionId = args.sessionId;
            if (sessionId === undefined && args.urlPattern !== undefined) {
                const tabs = await listTabs(linkUrl, args.urlPattern, exec.signal);
                const first = tabs[0];
                if (first === undefined) {
                    throw new Error(`no tab matches urlPattern "${args.urlPattern}"`);
                }
                sessionId = first.id;
            }
            const payload = {
                cmd: 'execute_js',
                code: args.code,
                timeout: String(timeoutMs / 1000),
            };
            if (sessionId !== undefined)
                payload.sessionId = sessionId;
            const raw = await linkCommand(linkUrl, payload, exec.signal);
            const obj = (typeof raw === 'object' && raw !== null ? raw : {});
            const data = obj.data;
            return {
                data: data ?? null,
                ...sessionId !== undefined ? { sessionId } : {},
            };
        },
        presentCall: (args) => ({
            card: 'generic',
            title: args.sessionId !== undefined
                ? `Execute JS in tab ${args.sessionId}`
                : 'Execute JS in browser',
            kind: 'execute',
            rawInput: args.code.slice(0, 120),
        }),
        presentResult: (args, result) => {
            if (result.isError)
                return undefined;
            const meta = result.meta;
            if (typeof meta !== 'object' || meta === null)
                return undefined;
            const data = meta.data;
            if (data === undefined)
                return undefined;
            const text = typeof data === 'string' ? data : JSON.stringify(data) ?? '';
            return {
                card: 'generic',
                title: `JS result (tab ${args.sessionId ?? 'default'})`,
                kind: 'execute',
                content: [{ type: 'text', text: text.slice(0, 4000) }],
            };
        },
    });
}
/**
 * Register the TMWebDriver browser tools. Config comes from the bundle patch
 * row (`linkUrl`, `timeoutMs`); defaults keep the standard local master ports.
 */
export function apply(ctx, config) {
    const resolved = config;
    ctx.tools.register(defineListTabsTool(resolved.linkUrl, resolved.timeoutMs));
    ctx.tools.register(defineExecuteJsTool(resolved.linkUrl, resolved.timeoutMs));
}
//# sourceMappingURL=index.js.map