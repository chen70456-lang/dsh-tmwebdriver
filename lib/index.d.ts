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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { JsonValue } from '@deepseek-ai/dsh-session';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "dsh-tmwebdriver";
/** Services required by the TMWebDriver tools. */
export declare const inject: string[];
/** Default cooperative per-call timeout budget (ms). */
export declare const DEFAULT_TIMEOUT_MS = 30000;
/** Default TMWebDriver HTTP link endpoint. */
export declare const DEFAULT_LINK_URL = "http://127.0.0.1:18766/link";
/** Plugin config: where the TMWebDriver master lives and per-call budgets. */
export interface Config {
    /** TMWebDriver HTTP link endpoint. Defaults to http://127.0.0.1:18766/link. */
    linkUrl?: string;
    /** Cooperative timeout budget (ms) per call. Defaults to 30000. */
    timeoutMs?: number;
    /** Max characters `browser_snapshot` returns per call. Defaults to 8000. */
    snapshotMaxChars?: number;
}
/** Default `browser_snapshot` character cap. */
export declare const DEFAULT_SNAPSHOT_MAX_CHARS = 8000;
/** Schemastery configuration for the TMWebDriver tools. */
export declare const Config: z<Config>;
/** One scriptable tab as reported by the TMWebDriver master. */
export interface TabInfo {
    /** Numeric Chrome tab id (also the TMWebDriver session id). */
    id: string;
    /** Current tab URL. */
    url: string;
    /** Current tab title. */
    title: string;
}
/** The canonical `browser_list_tabs` output value. */
export interface ListTabsOutput {
    /** The scriptable tabs. */
    tabs: TabInfo[];
    /**
     * Present when the master is up but no tab has connected — the
     * `tmwd_cdp_bridge` Chrome extension is not loaded (or Chrome has no open
     * scriptable tab). Carries a model-facing install guide.
     */
    extensionGuide?: string;
}
/** The canonical `browser_execute_js` output value. */
export interface ExecuteJsOutput {
    /** The script's returned value (or CDP bridge result). */
    data: JsonValue;
    /** The tab the script ran in, when known. */
    sessionId?: string;
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
export declare function linkCommand(linkUrl: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
/**
 * Resolve the target tab for a structured tool call: an explicit \`sessionId\`
 * wins; otherwise \`urlPattern\` locates the first matching tab; otherwise the
 * master's default session is used (\`sessionId\` omitted from the payload).
 *
 * @param linkUrl - the link endpoint.
 * @param sessionId - explicit tab id, when provided.
 * @param urlPattern - URL substring fallback, when provided.
 * @param signal - cooperative cancellation signal.
 * @returns the payload sessionId to send (\`undefined\` = master default).
 */
export declare function resolveTarget(linkUrl: string, sessionId: string | undefined, urlPattern: string | undefined, signal: AbortSignal): Promise<string | undefined>;
/**
 * Run one execute_js command and return its canonical \`data\` value.
 *
 * @param linkUrl - the link endpoint.
 * @param code - JavaScript to run in the target tab.
 * @param sessionId - resolved tab id (\`undefined\` = master default).
 * @param signal - cooperative cancellation signal.
 * @returns the script's returned value.
 */
export declare function runJs(linkUrl: string, code: string, sessionId: string | undefined, signal: AbortSignal): Promise<JsonValue>;
/**
 * Register the TMWebDriver browser tools. Config comes from the bundle patch
 * row (`linkUrl`, `timeoutMs`); defaults keep the standard local master ports.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map