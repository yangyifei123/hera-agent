# Contributing to Hera Agent

Thank you for your interest in contributing to Hera Agent! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Adding Features](#adding-features)

---

## Development Setup

### Prerequisites

- **Bun** >= 1.0.0 or **Node.js** >= 18.0.0
- **OpenCode** CLI installed
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yangyifei123/hera-agent.git
cd hera-agent

# Install dependencies
bun install

# Build the project
bun run build

# Install locally for testing
opencode plugin . --global -f
```

### Development Workflow

```bash
# Watch mode for development
bun run dev

# Build for production
bun run build

# Test your changes
opencode --agent hera
```

---

## Project Structure

```
hera-agent/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── types.ts              # TypeScript type definitions
│   ├── agents/
│   │   ├── hera.ts           # Agent templates
│   │   └── registry.ts       # Agent persistence
│   ├── skills/
│   │   ├── manager.ts        # Skill management
│   │   └── builtin/          # Built-in skills
│   ├── teams/
│   │   └── manager.ts        # Team coordination
│   ├── memory/
│   │   └── store.ts          # Memory persistence
│   ├── evolution/
│   │   └── engine.ts         # Self-evolution
│   └── tools/
│       └── index.ts          # Tool definitions
├── dist/                     # Build output
├── hera.schema.json          # Configuration schema
├── hera.example.json         # Configuration example
├── CLAUDE.md                 # Development documentation
├── TEST_REPORT.md            # Test coverage
└── package.json
```

---

## Making Changes

### Branch Naming

- `feat/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/what-changed` - Documentation updates
- `refactor/what-changed` - Code refactoring
- `test/what-added` - Test additions

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Your Name <your.email@example.com>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(agents): add security specialist template

Add new agent template focused on security auditing and
vulnerability detection.

Co-Authored-By: Jane Doe <jane@example.com>
```

---

## Testing

### Manual Testing

```bash
# Build and install
bun run build
opencode plugin . --global -f

# Test agent creation
opencode --agent hera run "hera_create_agent name='test-agent' template='coder' mode='all' description='Test agent'"

# Test system status
opencode --agent hera run "hera_status"

# Test agent invocation
opencode --agent test-agent
```

### Test Checklist

Before submitting:
- [ ] Build succeeds without errors
- [ ] Plugin loads in OpenCode
- [ ] New features work as expected
- [ ] Existing features still work
- [ ] Configuration auto-creates correctly
- [ ] Agents persist and are discoverable
- [ ] No breaking changes (or documented)

---

## Submitting Changes

### Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Test** thoroughly
5. **Commit** with clear messages
6. **Push** to your fork
7. **Open** a Pull Request

### PR Description Template

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How did you test this?

## Checklist
- [ ] Code builds successfully
- [ ] Tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
```

---

## Code Style

### TypeScript Guidelines

- Use **TypeScript** for type safety
- Prefer **interfaces** over types for objects
- Use **async/await** over promises
- Add **JSDoc comments** for public APIs
- Keep functions **small and focused**

### Example

```typescript
/**
 * Creates a new agent with the specified configuration
 * @param config - Agent configuration
 * @returns Created agent metadata
 */
export async function createAgent(
  config: AgentConfig
): Promise<AgentMetadata> {
  // Implementation
}
```

### Formatting

- **Indentation**: 2 spaces
- **Line length**: 80-100 characters preferred
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Trailing commas**: Yes

---

## Adding Features

### New Agent Template

1. Add template to `src/agents/hera.ts`:
```typescript
export const AGENT_TEMPLATES = {
  // ... existing templates
  'my-template': {
    name: 'My Template',
    description: 'Template description',
    prompt: 'Template prompt...',
    defaultSkills: ['caveman', 'init'],
    defaultModel: 'cherry/GLM-5'
  }
};
```

2. Update `src/types.ts`:
```typescript
export type AgentTemplateName = 
  | 'general'
  | 'my-template'  // Add here
  | ...;
```

3. Test the new template
4. Update documentation

### New Tool

1. Add tool to `src/tools/index.ts`:
```typescript
{
  name: 'hera_my_tool',
  description: 'Tool description',
  input_schema: {
    type: 'object',
    properties: {
      // Define parameters
    },
    required: ['param1']
  },
  handler: async (args) => {
    // Implementation
    return { success: true };
  }
}
```

2. Test the tool
3. Update `CLAUDE.md` tool list

### New Built-in Skill

1. Create skill file in `src/skills/builtin/`
2. Register in `src/skills/manager.ts`
3. Add to default skills in agent templates
4. Document in README

---

## Questions?

- **Issues**: https://github.com/yangyifei123/hera-agent/issues
- **Discussions**: https://github.com/yangyifei123/hera-agent/discussions

---

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards others

---

Thank you for contributing to Hera Agent! 🎉
