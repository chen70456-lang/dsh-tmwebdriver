# dsh-tmwebdriver

DSH profile bundle that controls your real, logged-in browser through
[TMWebDriver](https://github.com/ljqin/TMWebDriver) — the Chrome extension bridge
from the GenericAgent toolchain. Unlike headless automation, it drives your
actual Chrome session, preserving cookies, logins, and real fingerprints.

## Requirements

- A running TMWebDriver master (WebSocket 18765 / HTTP 18766). Start it from the
  GenericAgent checkout:
  ```sh
  python -c "from TMWebDriver import TMWebDriver; TMWebDriver(host='127.0.0.1', port=18765); import time; [time.sleep(3600) for _ in iter(int,1)]"
  ```
- The `tmwd_cdp_bridge` Chrome extension installed (connects your tabs to the
  master).
- A DSH profile (e.g. `web`).

## Install

```sh
dsh plugin --profile web add D:/dsh-tmwebdriver
```

## Tools

| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List scriptable browser tabs (id, url, title). Optional `urlPattern` filter. |
| `browser_execute_js` | Execute JavaScript in a tab, or pass a JSON command string for the CDP bridge (`cookies`, `cdp`, `batch`, `tabs`). |

## Config

| Field | Default | Description |
|-------|---------|-------------|
| `linkUrl` | `http://127.0.0.1:18766/link` | TMWebDriver HTTP link endpoint |
| `timeoutMs` | `30000` | Per-call cooperative timeout budget |
