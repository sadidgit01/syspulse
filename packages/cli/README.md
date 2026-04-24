# SysPulse CLI

`syspulse-agent` installs the SysPulse Python agent onto a host machine, registers it with the
SysPulse API, and configures it to run as a background service.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
npx syspulse-agent install --server https://syspulse.example.com --token <org_token>
```

Optional flags:

- `--access-token <user_access_token>`: lets the CLI verify remote agent status through
  `GET /agents`
- `--dev`: copies the local `apps/agent/python_agent` folder instead of downloading the zip bundle
- `--interval <seconds>`: overrides the Python agent metric interval

Check remote status:

```bash
npx syspulse-agent status --access-token <user_access_token>
```
