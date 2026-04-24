# SysPulse Python Agent

This lightweight agent collects host metrics with `psutil`, batches six snapshots at a time, and
ships them to the SysPulse API using the agent bearer token.

## Environment

Set these environment variables before starting the agent:

- `SYSPULSE_SERVER`: Base URL for the SysPulse API, for example `http://localhost:8000`
- `AGENT_TOKEN`: Agent-scoped JWT returned by `POST /agents/register`
- `INTERVAL`: Metric collection interval in seconds. Defaults to `5`

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python agent.py
```

## Behavior

- Collects CPU, memory, disk, and network delta metrics every interval
- Ships metrics to `POST /ingest/metrics` in batches of six readings
- Collects logs every 60 seconds and ships them to `POST /ingest/logs`
- Flushes any pending metrics and logs before the process exits on `SIGTERM` or `SIGINT`
