# SysPulse Go Agent

Production-grade SysPulse host agent written in Go. The Python agent remains available for local development, while this agent is intended for production deployment.

## Environment Variables

| Variable | Required | Default | Description |
|---|---:|---:|---|
| `SYSPULSE_SERVER` | Yes | - | SysPulse API base URL, for example `https://syspulse.example.com` |
| `AGENT_TOKEN` | Yes | - | Agent-scoped JWT returned by `/agents/register` |
| `SYSPULSE_CERT_DIR` | No | `~/.syspulse/certs` | Directory containing `cert.pem`, `key.pem`, and `ca.pem` for mTLS |
| `INTERVAL` | No | `5` | Metric collection interval in seconds |
| `BATCH_SIZE` | No | `6` | Number of metric snapshots to buffer before shipping |

## Build

```bash
go mod download
go build -o syspulse-agent
```

## Run

```bash
SYSPULSE_SERVER=http://localhost:8000 \
AGENT_TOKEN=<agent_token> \
INTERVAL=5 \
BATCH_SIZE=6 \
SYSPULSE_CERT_DIR=~/.syspulse/certs \
./syspulse-agent
```

On Windows PowerShell:

```powershell
$env:SYSPULSE_SERVER = "http://localhost:8000"
$env:AGENT_TOKEN = "<agent_token>"
$env:INTERVAL = "5"
$env:BATCH_SIZE = "6"
$env:SYSPULSE_CERT_DIR = "$HOME\.syspulse\certs"
.\syspulse-agent.exe
```

## Cross Compilation

```bash
GOOS=linux GOARCH=amd64 go build -o syspulse-agent-linux
GOOS=windows GOARCH=amd64 go build -o syspulse-agent-windows.exe
GOOS=darwin GOARCH=amd64 go build -o syspulse-agent-macos
```

## Telemetry

- CPU usage percent
- Memory usage percent
- Disk usage percent for `/` on Linux/macOS and `C:\` on Windows
- Network receive/send byte deltas per interval
- Linux logs from the last 50 lines of `/var/log/syslog`
- Windows Application Event Log entries via `wevtutil`

Every metrics and logs payload is JSON encoded, HMAC-SHA256 signed, gzip compressed, retried with exponential backoff, and shipped with the agent bearer token.

## mTLS Certificates

On startup, the agent requests its organization-scoped certificate bundle from `/agents/{agent_id}/cert` using its agent token. Certificates are stored in `~/.syspulse/certs/` as `cert.pem`, `key.pem`, and `ca.pem`.

If the local certificate bundle exists and is valid for more than seven days, it is reused. If the bundle is missing or close to expiry, the agent downloads a fresh bundle before shipping telemetry. HTTPS connections automatically use TLS 1.3 mutual TLS when the certificate files are present.
