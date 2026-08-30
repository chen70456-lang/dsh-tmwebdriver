# Starts the bundled TMWebDriver master (WebSocket 18765 / HTTP 18766).
# The tmwd_cdp_bridge Chrome extension connects your tabs to this master.
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Ensure Python dependencies
python -c "import simple_websocket_server, bottle, requests" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Installing Python dependencies (simple-websocket-server, bottle, requests)..."
  python -m pip install -r "$dir\requirements.txt"
}

Write-Host "Starting TMWebDriver master on ws://127.0.0.1:18765 (HTTP link on 18766)..."
Write-Host "Press Ctrl+C to stop."
python -u "$dir\tmwebdriver_master.py"
