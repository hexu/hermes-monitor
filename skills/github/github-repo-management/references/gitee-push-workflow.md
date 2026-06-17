# Gitee Push Workflow

Reference for pushing to Gitee remotes (applies to any Gitee-hosted repo).

## Setup Git Identity (Required on First Use)

```bash
git config --global user.email "your@email.com"
git config --global user.name "Your Name"
```

## Configure Credential Helper

Gitee rejects tokens embedded in HTTPS URLs (the `@` in `TOKEN@gitee.com` is parsed as a port separator). Use the credential helper instead:

```bash
git config --global credential.helper store
echo "https://USERNAME:TOKEN@gitee.com" > ~/.git-credentials
```

Alternatively, omit the token from the remote URL and let git prompt:
```bash
git remote set-url origin https://gitee.com/owner/repo.git
git push origin main  # will prompt for credentials
```

## Probe Remote Structure Before Pushing

```bash
# List files at remote tip — use this to distinguish source-code vs config-backup repos
git ls-tree origin/main --name-only | sort
```

| Remote contains | Repo type | Safe to push source? |
|-----------------|-----------|---------------------|
| `hermes_cli/`, `tools/`, `gateway/`, `run_agent.py`, etc. | Source code repo | Yes |
| `config.yaml`, `skills/`, `sessions/`, `memories/`, `profiles/` | Config backup repo | No — push config files only |
| Empty output | Unusual / new repo | Check with `git fetch origin` first |

## Safe Directory Fix (Linux)

```bash
git config --global --add safe.directory /root/.hermes/hermes-agent
git config --global --add safe.directory /path/to/repo
```

## Push Sequence

```bash
# 1. Probe remote structure
git ls-tree origin/main --name-only | sort

# 2. If source-code repo: standard push
git add <changed files>
git commit -m "your commit message"
git push origin main

# 3. If config-backup repo: push only config files from ~/.hermes/
cd ~/.hermes
git add config.yaml skills/ sessions/ memories/ profiles/ ...
git commit -m "backup: $(date +%Y-%m-%d)"
git push origin main
```

## Handling Rejected Pushes (fetch first)

If push is rejected because remote has work you don't have:

```bash
# Inspect what changed on remote
git fetch origin
git log --oneline origin/main -5

# Rebase (if remote is authoritative):
git rebase origin/main

# Or merge:
git merge origin/main
```

Then retry `git push origin main`.

## Gitee-Specific API Notes

- Gitee API v5 base: `https://gitee.com/api/v5/`
- Unlike GitHub, Gitee does not have a `gh`-equivalent CLI
- All Gitee operations use raw `git` + `curl` at the API level
- Repo create: `POST https://gitee.com/api/v5/user/repos`
- Gitee token goes in the URL: `https://USERNAME:TOKEN@gitee.com/api/v5/...`
