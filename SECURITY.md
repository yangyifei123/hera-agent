# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 2.2.x   | :white_check_mark: |
| 2.1.x   | :white_check_mark: |
| 2.0.x   | :x:                |
| < 2.0   | :x:                |

## Reporting a Vulnerability

We take the security of Hera Agent seriously. If you discover a security vulnerability, please follow these steps:

### 1. **Do Not** Open a Public Issue

Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

### 2. Report Privately

Send your report to: **yangyifei123@github.com**

Include the following information:
- Type of vulnerability (e.g., code injection, path traversal, privilege escalation)
- Full paths of affected source files
- Location of the affected code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact assessment and potential attack scenarios

### 3. Response Timeline

- **Initial Response**: Within 48 hours
- **Vulnerability Assessment**: Within 7 days
- **Fix Development**: Depends on severity (critical: 7 days, high: 14 days, medium: 30 days)
- **Public Disclosure**: After patch release, coordinated with reporter

### 4. Disclosure Policy

- We follow coordinated disclosure
- Security advisories will be published on GitHub Security Advisories
- Credit will be given to reporters (unless anonymity is requested)

## Security Best Practices

When using Hera Agent:

### Agent Name Validation
- Agent names are validated before file operations
- Do not bypass `validateAgentName()` checks
- Avoid user-controlled agent names without validation

### File System Access
- All file operations use validated paths
- Config root is resolved via `resolveConfigRoot()`
- Do not construct paths from untrusted input

### Memory Store
- Memory entries are JSON-serialized
- Avoid storing sensitive data (credentials, tokens) in memory
- Use environment variables for secrets

### Plugin Generation
- Generated plugins inherit Hera's security model
- Review generated code before deployment
- Auto-install (`auto_install: true`) runs `bun install/build` — audit dependencies first

### Tool Execution
- Tools validate inputs via zod schemas
- Agent spawning creates isolated OpenCode sessions
- Team coordination uses message passing, not shared state

## Known Security Considerations

### 1. Agent Prompt Injection
- Child agents execute user-provided prompts
- Malicious prompts could attempt privilege escalation
- Mitigation: Review agent prompts before creation

### 2. Skill Package Files
- User skills can include arbitrary files
- Files are copied to `hera-data/skills/<name>/`
- Mitigation: Audit skill packages before installation

### 3. Generated Plugin Code
- Generated plugins execute in the OpenCode runtime
- Code generation uses templates + user input
- Mitigation: Review generated `dist/index.js` before publishing

### 4. Memory Extraction
- Auto-memory extracts data from session messages
- Could capture sensitive information from conversations
- Mitigation: Disable `auto_memory` if handling secrets

### 5. Team Session Spawning
- Teams spawn real OpenCode sessions via client API
- Sessions inherit parent permissions
- Mitigation: Use least-privilege agent modes

## Security Updates

Security patches are released as:
- **Patch versions** (2.2.x) for backward-compatible fixes
- **Minor versions** (2.x.0) for fixes requiring API changes
- **GitHub Security Advisories** for critical vulnerabilities

Subscribe to releases: https://github.com/yangyifei123/hera-agent/releases

## Acknowledgments

We appreciate the security research community's efforts in responsibly disclosing vulnerabilities. Contributors will be acknowledged in:
- CHANGELOG.md
- GitHub Security Advisories
- Release notes

Thank you for helping keep Hera Agent secure.
