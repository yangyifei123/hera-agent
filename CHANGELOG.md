# Changelog

All notable changes to Hera Agent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-05-21

### Added
- **Agent Packaging & Migration**: Package, export, and import agents as `.tar.gz` for distribution across environments
- **Team Plugin Export**: Export entire teams as single plugins
- **Skill Upgrade Paths**: `hera_upgrade_to_agent` and `hera_upgrade_to_team` for promoting skills
- **Workflow Engine**: Automatic task complexity analysis with serial, parallel, and DAG execution modes
- **10 Workflow Templates**: Pre-defined workflows (coder, reviewer, tester, documenter, team, architect, debugger, optimizer, researcher, general)
- **Agent CLI**: `hera doctor`, `hera list-*`, `hera version`, `hera create/delete/restore`
- **First-Run Onboarding**: Auto-creates 4 default agents + dev-team
- **Zero-Config Auto-Install**: `auto_install=true` runs full install/build/add pipeline
- **Soft Delete + Backup**: Safe agent deletion with restore capability
- **Session Distillation**: Extract structured knowledge from conversations
- **Auto-Memory**: Automatic insight extraction from sessions
- **8 Built-in Skills**: caveman, init, memory, evolution, skill-combo, subagent, communicate, auto-compact (inherited by every agent)
- **43 Management Tools**: Complete agent/skill/team/workflow lifecycle management

### Changed
- **Type Safety**: Eliminated all `any` types in runtime code; typed catch blocks, dynamic imports, SDK response parsing
- **Lint**: Zero warnings (from 332 warnings baseline)
- **Build**: Clean TypeScript declaration emit with `dist/index.d.ts`
- **README**: Conversion-optimized rewrite (56% shorter, above-fold value prop)
- **Documentation**: Added canonical demo, positioning document, restructured docs IA

### Fixed
- Agent persistence and discovery reliability
- Memory store naming consistency
- Workflow execution error handling with typed `unknown` catches
- Plugin generator exports typed correctly

## [2.0.0] - 2026-05-13

### Added
- **Configuration System**: Auto-create `hera.json` on first load with zero-config setup
- **JSON Schema**: IDE autocomplete support via `hera.schema.json`
- **Extended Templates**: 10 agent templates (general, coder, reviewer, researcher, coordinator, architect, debugger, tester, documenter, optimizer, security)
- **Management Tools**: 
  - `hera_status`: System overview
  - `hera_list_templates`: Browse available templates
  - `hera_verify_agent`: Validate agent registration
  - `hera_export_agent` / `hera_import_agent`: Agent portability
- **Team System**: Multi-agent collaboration with sequential/parallel/adaptive coordination
- **Skill Evolution**: Upgrade skills to full agents with `hera_upgrade_to_agent`
- **Memory System**: Persistent knowledge across sessions
- **Self-Evolution**: Agents can improve through reflection and directive appending

### Changed
- **Installation**: Simplified to one-step process, no manual initialization needed
- **Agent Discovery**: Improved compatibility with OpenCode's native agent system
- **Command References**: Updated from `weq` to `opencode` throughout
- **Build Output**: Optimized to 67.1 KB

### Fixed
- Agent persistence mechanism for reliable discovery
- Compatibility with oh-my-openagent plugin
- Memory store naming consistency
- Local path references removed for public distribution

### Documentation
- Comprehensive `CLAUDE.md` for development
- Detailed `README.md` with usage examples
- `TEST_REPORT.md` with full test coverage
- Configuration examples and schema

## [1.0.0] - 2026-05-11

### Added
- Initial release as OpenCode plugin
- Core agent factory functionality
- 5 built-in skills: caveman, init, skill-combo, memory, evolution
- 5 basic agent templates
- Agent/Skill/Team management tools
- Persistent storage in `~/.config/opencode/`

### Features
- Create custom agents with templates
- Skill-based capability system
- Team coordination (basic)
- Memory persistence
- Self-evolution capabilities

---

## Upgrade Guide

### From 1.x to 2.0

**Breaking Changes**: None - fully backward compatible

**New Features**:
1. Configuration file auto-created at `~/.config/opencode/hera.json`
2. 5 new agent templates available
3. Enhanced management tools for better visibility

**Migration Steps**:
```bash
# Update plugin
opencode plugin hera-agent --global -f

# Restart OpenCode to trigger config creation
# Your existing agents, skills, and teams are preserved
```

**Optional**: Customize your configuration by editing `~/.config/opencode/hera.json`

---

## Roadmap

### v2.1.0 (Planned)
- [ ] Agent marketplace integration
- [ ] Skill sharing between agents
- [ ] Advanced team coordination strategies
- [ ] Performance metrics and analytics
- [ ] Web UI for agent management

### v2.2.0 (Planned)
- [ ] Multi-model support per agent
- [ ] Agent versioning and rollback
- [ ] Collaborative learning between agents
- [ ] Plugin ecosystem for custom tools

### v3.0.0 (Future)
- [ ] Distributed agent execution
- [ ] Cloud synchronization
- [ ] Agent-to-agent communication protocol
- [ ] Visual workflow designer

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
