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
}
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
}
/** The canonical `browser_execute_js` output value. */
export interface ExecuteJsOutput {
    /** The script's returned value (or CDP bridge result). */
    data: JsonValue;
    /** The tab the script ran in, when known. */
    sessionId?: string;
}
/**
 * Register the TMWebDriver browser tools. Config comes from the bundle patch
 * row (`linkUrl`, `timeoutMs`); defaults keep the standard local master ports.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map