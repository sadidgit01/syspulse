# SysPulse CLI

`syspulse-agent` installs the production SysPulse Go agent onto a host machine, registers it with the
SysPulse API, installs mTLS certificates, and configures it to run as a background service.

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
- `--interval <seconds>`: overrides the Go agent metric interval

Check remote status:

```bash
npx syspulse-agent status --access-token <user_access_token>
```

Rotate the local mTLS certificate bundle:

```bash
npx syspulse-agent rotate-cert
```
