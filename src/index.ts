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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-tmwebdriver'

/** Services required by the TMWebDriver tools. */
export const inject = ['tools']

/** Default cooperative per-call timeout budget (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Default TMWebDriver HTTP link endpoint. */
export const DEFAULT_LINK_URL = 'http://127.0.0.1:18766/link'

/** Plugin config: where the TMWebDriver master lives and per-call budgets. */
export interface Config {
  /** TMWebDriver HTTP link endpoint. Defaults to http://127.0.0.1:18766/link. */
  linkUrl?: string
  /** Cooperative timeout budget (ms) per call. Defaults to 30000. */
  timeoutMs?: number
}

/** Schemastery configuration for the TMWebDriver tools. */
export const Config: z<Config> = z.object({
  linkUrl: z.string().default(DEFAULT_LINK_URL),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/**
 * Directory containing the bundled `master/tmwebdriver_master.py`. Resolved
 * from this module's own location so a profile link install (or npm package)
 * finds the script next to the compiled entry regardless of cwd.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** The bundled TMWebDriver master script shipped with this package. */
const MASTER_SCRIPT = join(MODULE_DIR, '..', 'master', 'tmwebdriver_master.py')

/** TCP port the TMWebDriver master listens on for HTTP link (18766). */
const MASTER_HTTP_PORT = 18766

/** The port the master listens on, derived from the configured link URL. */
function linkPort(linkUrl: string): number {
  try {
    const url = new URL(linkUrl)
    return url.port ? Number(url.port) : MASTER_HTTP_PORT
  } catch {
    return MASTER_HTTP_PORT
  }
}

/** Whether anything is listening on the given TCP port (GA-compatible probe). */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * The master spawn promise, shared so concurrent tool calls start it once
 * (GA's `is_remote` probe + lazy `first_init_driver` semantics).
 */
let masterStart: Promise<void> | null = null

/**
 * The Python command used to run and probe the master; \`PYTHON\` env overrides.
 */
function pythonCmd(): string {
  return process.env.PYTHON ?? 'python'
}

/**
 * Whether the master's Python dependencies are importable
 * (\`simple_websocket_server\`, \`bottle\`, \`requests\`).
 */
function pythonDepsOk(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pythonCmd(), ['-c', 'import simple_websocket_server, bottle, requests'], {
      stdio: 'ignore',
    })
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
  })
}

/**
 * Install the master's Python dependencies from the bundled requirements.txt.
 * Resolves when pip finishes; rejects on a nonzero exit.
 */
function installPythonDeps(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = join(MODULE_DIR, '..', 'master', 'requirements.txt')
    const child = spawn(pythonCmd(), ['-m', 'pip', 'install', '-r', req], {
      stdio: 'ignore',
    })
    child.once('error', (error) => reject(new Error(`pip failed to start: ${error.message}`)))
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`pip install exited ${code} (python ${pythonCmd()} -m pip install -r ${req})`))
    })
  })
}

/**
 * Try to start the bundled master and wait up to \`timeoutMs\` for its link port
 * to open. Kills the child on timeout. Resolves true on success.
 *
 * @param linkUrl - the link endpoint whose port is probed.
 * @param timeoutMs - how long to wait for the port.
 * @returns whether the master came up.
 */
function tryStartMaster(linkUrl: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pythonCmd(), ['-u', MASTER_SCRIPT], {
      stdio: 'ignore',
      // Detached so the master outlives the DSH process that lazily started it
      // (GA keeps the master independent of any single client). unref lets the
      // parent exit normally; the master stays up for other clients.
      detached: true,
    })
    child.unref()
    const deadline = Date.now() + timeoutMs
    const poll = async (): Promise<void> => {
      if (await portOpen(linkPort(linkUrl))) {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        child.kill()
        resolve(false)
        return
      }
      setTimeout(() => void poll(), 250)
    }
    void poll()
  })
}

/**
 * Ensure the TMWebDriver master is running, auto-installing its Python
 * dependencies when the first start attempt fails. Like GA: probe the link
 * port; when nothing listens, spawn the bundled master script; on failure
 * check the deps, install what is missing, and retry. An already-running
 * master — started manually or by another client — is reused. The master stays
 * running (no auto-shutdown).
 *
 * @param linkUrl - the link endpoint (its port is probed).
 * @returns a promise resolving once the master accepts connections.
 */
async function ensureMaster(linkUrl: string): Promise<void> {
  if (await portOpen(linkPort(linkUrl))) return
  if (masterStart !== null) return masterStart
  masterStart = (async () => {
    if (!existsSync(MASTER_SCRIPT)) {
      throw new Error(
        `bundled TMWebDriver master not found at ${MASTER_SCRIPT} — install the full package or start the master manually`,
      )
    }
    // First attempt: assume deps are present (the common case).
    if (await tryStartMaster(linkUrl, 15_000)) return
    // Failure: check deps and install what is missing, then retry once.
    if (!(await pythonDepsOk())) {
      await installPythonDeps()
    }
    if (!(await tryStartMaster(linkUrl, 15_000))) {
      throw new Error(
        `TMWebDriver master did not start within 15s (python ${pythonCmd()} ${MASTER_SCRIPT}). `
        + 'Check the master log or run: python -m pip install -r master/requirements.txt',
      )
    }
  })()
  try {
    await masterStart
  } finally {
    // Allow a later call to retry after a failed start.
    masterStart = null
  }
}

/** One scriptable tab as reported by the TMWebDriver master. */
export interface TabInfo {
  /** Numeric Chrome tab id (also the TMWebDriver session id). */
  id: string
  /** Current tab URL. */
  url: string
  /** Current tab title. */
  title: string
}

/** The canonical `browser_list_tabs` output value. */
export interface ListTabsOutput {
  /** The scriptable tabs. */
  tabs: TabInfo[]
}

/** The canonical `browser_execute_js` output value. */
export interface ExecuteJsOutput {
  /** The script's returned value (or CDP bridge result). */
  data: JsonValue
  /** The tab the script ran in, when known. */
  sessionId?: string
}

/** Lossless-JSON projection of one tab, for presentation metadata. */
function tabToJson(tab: TabInfo): JsonValue {
  return { id: tab.id, url: tab.url, title: tab.title }
}

/** Project a tab list into lossless JSON presentation metadata. */
function tabsToJson(tabs: TabInfo[]): JsonValue {
  return tabs.map(tabToJson)
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
async function linkCommand(
  linkUrl: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  // GA-compatible lazy start: first call ensures the master is up, reusing an
  // already-running one; later calls probe the port and skip the wait.
  await ensureMaster(linkUrl)
  let response: Response
  try {
    response = await fetch(linkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error)
    throw new Error(`TMWebDriver master unreachable at ${linkUrl} (${cause})`)
  }
  if (!response.ok) {
    throw new Error(`TMWebDriver link endpoint returned HTTP ${response.status}`)
  }
  const body = (await response.json()) as { r?: unknown; error?: string }
  if (body.error !== undefined) throw new Error(`TMWebDriver error: ${body.error}`)
  return body.r
}

/** A TMWebDriver session record, before projection. */
interface RawSession {
  id?: unknown
  url?: unknown
  title?: unknown
}

/**
 * Parse a TMWebDriver session record into a {@link TabInfo}. The master emits
 * `{id, url, title, connected_at, type}`; unknown extra fields are ignored.
 *
 * @param raw - one session record.
 * @returns the projected tab, or `null` when the record lacks an id.
 */
function projectTab(raw: unknown): TabInfo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, url, title } = raw as RawSession
  if (typeof id !== 'string') return null
  return {
    id,
    url: typeof url === 'string' ? url : '',
    title: typeof title === 'string' ? title : '',
  }
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
async function listTabs(
  linkUrl: string,
  urlPattern: string | undefined,
  signal: AbortSignal,
): Promise<TabInfo[]> {
  const raw = await linkCommand(
    linkUrl,
    urlPattern !== undefined
      ? { cmd: 'find_session', url_pattern: urlPattern }
      : { cmd: 'get_all_sessions' },
    signal,
  )
  const tabs: TabInfo[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      // find_session returns [sessionId, info] pairs; get_all_sessions returns
      // plain records. Accept both shapes.
      const record = Array.isArray(item) ? item[1] : item
      const tab = projectTab(record)
      if (tab !== null) tabs.push(tab)
    }
  }
  return tabs
}

/** Render one tab list as model-facing text. */
function renderTabs(tabs: TabInfo[]): ContentBlock[] {
  if (tabs.length === 0) return [{ type: 'text', text: 'No scriptable tabs found.' }]
  const lines = tabs.map((tab) => `- [${tab.id}] ${tab.title} — ${tab.url}`)
  return [{ type: 'text', text: `Tabs:\n${lines.join('\n')}` }]
}

/** Whether a value looks like a tab list (defensive narrowing of opaque meta). */
function isTabInfoArray(value: unknown): value is TabInfo[] {
  return Array.isArray(value) && value.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const { id, url, title } = item as Record<string, unknown>
    return typeof id === 'string' && typeof url === 'string' && typeof title === 'string'
  })
}

/**
 * The `browser_list_tabs` tool: enumerate the user's scriptable browser tabs
 * through the TMWebDriver master.
 */
function defineListTabsTool(linkUrl: string, timeoutMs: number) {
  return defineTool({
    name: 'browser_list_tabs',
    description:
      'List the scriptable tabs of the user\'s real browser (via TMWebDriver). '
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
      render: (_args, value: ListTabsOutput) => renderTabs(value.tabs),
      presentationMeta: (_args, value: ListTabsOutput): JsonValue => ({
        tabs: tabsToJson(value.tabs),
      }),
    },
    timeoutMs,
    // A tab listing is a read; sibling listings may overlap safely.
    isConcurrencySafe: () => true,
    async execute(args, exec: ToolRunContext): Promise<ListTabsOutput> {
      return { tabs: await listTabs(linkUrl, args.urlPattern, exec.signal) }
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
      if (result.isError) return undefined
      const meta = result.meta
      if (typeof meta !== 'object' || meta === null) return undefined
      const tabs = (meta as Record<string, unknown>).tabs
      if (!isTabInfoArray(tabs)) return undefined
      const title = args.urlPattern !== undefined
        ? `Tabs matching "${args.urlPattern}"`
        : 'Browser tabs'
      return {
        card: 'generic',
        title,
        kind: 'read',
        content: renderTabs(tabs),
      }
    },
  })
}

/**
 * The `browser_execute_js` tool: run JavaScript in a tab. `code` is plain
 * JavaScript executed in the page's MAIN world, or a JSON command string routed
 * to the tmwd_cdp_bridge extension (`{"cmd":"cdp",...}`, `{"cmd":"cookies"}`,
 * `{"cmd":"batch","commands":[...]}`, `{"cmd":"tabs",...}`). When neither
 * `sessionId` nor `urlPattern` is given, the master's default session is used.
 */
function defineExecuteJsTool(linkUrl: string, timeoutMs: number) {
  return defineTool({
    name: 'browser_execute_js',
    description:
      'Execute JavaScript in the user\'s real browser (via TMWebDriver). '
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
      render: (_args, value: ExecuteJsOutput): ContentBlock[] => {
        const text = typeof value.data === 'string' ? value.data : JSON.stringify(value.data)
        return [{ type: 'text', text: text ?? '' }]
      },
      presentationMeta: (_args, value: ExecuteJsOutput): JsonValue => ({ data: value.data }),
    },
    timeoutMs,
    // JS execution mutates page state; sibling calls on the same tab race.
    isConcurrencySafe: () => false,
    async execute(args, exec: ToolRunContext): Promise<ExecuteJsOutput> {
      let sessionId: string | undefined = args.sessionId
      if (sessionId === undefined && args.urlPattern !== undefined) {
        const tabs = await listTabs(linkUrl, args.urlPattern, exec.signal)
        const first = tabs[0]
        if (first === undefined) {
          throw new Error(`no tab matches urlPattern "${args.urlPattern}"`)
        }
        sessionId = first.id
      }
      const payload: Record<string, unknown> = {
        cmd: 'execute_js',
        code: args.code,
        timeout: String(timeoutMs / 1000),
      }
      if (sessionId !== undefined) payload.sessionId = sessionId
      const raw = await linkCommand(linkUrl, payload, exec.signal)
      const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as { data?: unknown }
      const data = obj.data as JsonValue | undefined
      return {
        data: data ?? null,
        ...sessionId !== undefined ? { sessionId } : {},
      }
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
      if (result.isError) return undefined
      const meta = result.meta
      if (typeof meta !== 'object' || meta === null) return undefined
      const data = (meta as Record<string, unknown>).data
      if (data === undefined) return undefined
      const text = typeof data === 'string' ? data : JSON.stringify(data) ?? ''
      return {
        card: 'generic',
        title: `JS result (tab ${args.sessionId ?? 'default'})`,
        kind: 'execute',
        content: [{ type: 'text', text: text.slice(0, 4000) }],
      }
    },
  })
}

/**
 * Register the TMWebDriver browser tools. Config comes from the bundle patch
 * row (`linkUrl`, `timeoutMs`); defaults keep the standard local master ports.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  ctx.tools.register(defineListTabsTool(resolved.linkUrl, resolved.timeoutMs))
  ctx.tools.register(defineExecuteJsTool(resolved.linkUrl, resolved.timeoutMs))
}
