# dsh-tmwebdriver

DSH profile bundle that controls your real, logged-in browser through
TMWebDriver — a Chrome extension bridge. Unlike headless automation, it drives
your actual Chrome session, preserving cookies, logins, and real fingerprints.

This project is **self-contained**: the TMWebDriver master and the
`tmwd_cdp_bridge` Chrome extension are bundled here, so there is no dependency
on any external agent toolchain.

## Components

| Path | Purpose |
|------|---------|
| `src/index.ts` | DSH plugin: registers `browser_list_tabs` and `browser_execute_js` tools |
| `master/tmwebdriver_master.py` | TMWebDriver master (WebSocket 18765 / HTTP link 18766) |
| `master/start-master.ps1` / `.sh` | One-command master launcher (installs Python deps on first run) |
| `assets/tmwd_cdp_bridge/` | Chrome extension that bridges your tabs to the master |

## Setup

### 1. Install the Chrome extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select the `assets/tmwd_cdp_bridge/` folder.

### 2. Start the TMWebDriver master

```sh
# Windows
powershell -ExecutionPolicy Bypass -File master/start-master.ps1

# macOS / Linux
bash master/start-master.sh
```

The launcher installs Python dependencies
(`simple-websocket-server`, `bottle`, `requests`) on first run, then starts
the master. The Chrome extension auto-connects your scriptable tabs.

### 3. Install the DSH plugin

```sh
dsh plugin --profile web add /path/to/dsh-tmwebdriver
```

Restart `dsh web` (or the profile you installed into) so the bundle patch
loads.

## Tools

| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List scriptable browser tabs (id, url, title). Optional `urlPattern` filter. |
| `browser_execute_js` | Execute JavaScript in a tab, or pass a JSON command string for the CDP bridge (`cookies`, `cdp`, `batch`, `tabs`). |

## Config

The bundle patch row (`cordis.patch.yml`) supports:

| Field | Default | Description |
|-------|---------|-------------|
| `linkUrl` | `http://127.0.0.1:18766/link` | TMWebDriver HTTP link endpoint |
| `timeoutMs` | `30000` | Per-call cooperative timeout budget |
