/**
 * Structured browser tools over the TMWebDriver link endpoint. Two high-value,
 * reliability-first tools: `browser_snapshot` (read visible page text) and
 * `browser_type` (type into an input with framework-aware events). Navigation,
 * clicking, and everything else stay on `browser_execute_js`, which remains the
 * universal fallback.
 * @module dsh-tmwebdriver/tools
 */
import type { Context } from '@deepseek-ai/cordis';
/** The canonical `browser_snapshot` output. */
export interface SnapshotOutput {
    /** Visible page text, whitespace-collapsed and capped. */
    text: string;
    /** The page URL the snapshot came from. */
    url: string;
    /** Whether the page text was truncated by the cap. */
    truncated: boolean;
    /** The tab snapshotted, when known. */
    sessionId?: string;
}
/** The canonical `browser_type` output. */
export interface TypeOutput {
    /** Whether an input matched the selector and received the text. */
    typed: boolean;
    /** The tab typed in, when known. */
    sessionId?: string;
}
/**
 * Register the two structured browser tools.
 *
 * @param ctx - the Cordis context.
 * @param linkUrl - the TMWebDriver link endpoint.
 * @param timeoutMs - per-call cooperative timeout budget.
 */
export declare function applyStructuredTools(ctx: Context, linkUrl: string, timeoutMs: number, snapshotMaxChars?: number): void;
//# sourceMappingURL=tools.d.ts.map