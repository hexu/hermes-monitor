#!/usr/bin/env bash
#
# Hermes 全量恢复脚本
# 用于在新服务器上从 Gitee 仓库恢复 Hermes 配置、凭证、会话数据、profiles、skills、cron 与 monitor。
#
# 推荐用法：
#   export GIT_TOKEN='你的 Gitee 令牌'
#   bash scripts/restore.sh
#
# 远程一键：
#   GIT_TOKEN='你的 Gitee 令牌' bash -c "$(curl -fsSL https://gitee.com/pawn/hermes/raw/main/scripts/restore.sh)"
#
# 常用参数：
#   --dry-run          只展示将恢复的内容，不写入目标目录
#   --target DIR       指定恢复目标，默认 $HOME/.hermes
#   --no-backup        不备份现有目标目录（不推荐）
#   --stats-only       只显示当前目标目录 token 统计，不执行恢复
#   --skip-deps        跳过依赖检查提示
#
set -euo pipefail

GIT_REPO_HOST="gitee.com"
GIT_REPO_PATH="pawn/hermes.git"
GIT_REPO_URL="https://${GIT_REPO_HOST}/${GIT_REPO_PATH}"
GIT_USER="${GIT_USER:-1182991019@qq.com}"
GIT_TOKEN="${GIT_TOKEN:-5514f58169e463e921cea16463ff8bc7}"
# GIT_ASKPASS 子进程需要读取这两个变量。
export GIT_USER GIT_TOKEN
HERMES_DIR="${HERMES_DIR:-$HOME/.hermes}"
BACKUP=1
DRY_RUN=0
SKIP_DEPS=0
TMP_DIR="/tmp/hermes_restore_$$"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_section() { echo -e "${BLUE}$*${NC}"; }

usage() {
  sed -n '1,32p' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --target) shift; HERMES_DIR="${1:?--target requires DIR}" ;;
    --no-backup) BACKUP=0 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    --stats-only|-s) STATS_ONLY=1 ;;
    --help|-h) usage; exit 0 ;;
    *) log_error "未知参数: $1"; usage; exit 1 ;;
  esac
  shift
done
STATS_ONLY="${STATS_ONLY:-0}"
BACKUP_DIR="${HERMES_DIR}_backup_$(date +%Y%m%d_%H%M%S)"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_warn "缺少命令: $1"
    return 1
  fi
}

check_deps() {
  [ "$SKIP_DEPS" = 1 ] && return 0
  log_info "检查依赖..."
  local missing=0
  need_cmd git || missing=1
  need_cmd python3 || missing=1
  need_cmd sqlite3 || log_warn "sqlite3 缺失：可恢复文件，但无法显示 token 统计"
  if ! command -v hermes >/dev/null 2>&1; then
    log_warn "未检测到 hermes 命令。若是新服务器，请先安装 Hermes Agent。"
    log_warn "参考：curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
  fi
  [ "$missing" = 0 ] || { log_error "关键依赖缺失，无法继续"; exit 1; }
}

clone_repo() {
  rm -rf "$TMP_DIR"
  mkdir -p "$TMP_DIR"
  local askpass="$TMP_DIR/askpass.sh"
  cat > "$askpass" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' "$GIT_USER" ;;
  *Password*) printf '%s\n' "$GIT_TOKEN" ;;
  *) printf '\n' ;;
esac
EOF
  chmod 700 "$askpass"
  log_info "从 Gitee 克隆配置仓库..."
  GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git clone "$GIT_REPO_URL" "$TMP_DIR/repo" >/dev/null
}

copy_repo_to_target() {
  local src="$TMP_DIR/repo"
  if [ "$DRY_RUN" = 1 ]; then
    log_section "DRY RUN：将恢复以下内容到 $HERMES_DIR"
    find "$src" -maxdepth 2 -mindepth 1 ! -path "$src/.git" ! -path "$src/.git/*" | sed "s#^$src/##" | sort | sed -n '1,200p'
    return 0
  fi

  if [ -d "$HERMES_DIR" ] && [ "$BACKUP" = 1 ]; then
    log_warn "检测到现有 Hermes 目录，备份到: $BACKUP_DIR"
    cp -a "$HERMES_DIR" "$BACKUP_DIR"
  fi

  mkdir -p "$HERMES_DIR"
  log_info "同步文件到 $HERMES_DIR ..."
  python3 - "$src" "$HERMES_DIR" <<'PY'
from pathlib import Path
import shutil, sys, os
src=Path(sys.argv[1]); dst=Path(sys.argv[2])
for item in src.iterdir():
    if item.name == '.git':
        continue
    target=dst/item.name
    if target.exists() or target.is_symlink():
        if target.is_dir() and not target.is_symlink(): shutil.rmtree(target)
        else: target.unlink()
    if item.is_dir(): shutil.copytree(item, target, symlinks=True)
    else: shutil.copy2(item, target, follow_symlinks=False)
PY

  chmod 700 "$HERMES_DIR" || true
  [ -f "$HERMES_DIR/.env" ] && chmod 600 "$HERMES_DIR/.env" || true
  [ -f "$HERMES_DIR/auth.json" ] && chmod 600 "$HERMES_DIR/auth.json" || true
  find "$HERMES_DIR" -name '*.sh' -path '*/scripts/*' -exec chmod +x {} \; 2>/dev/null || true
}

print_profile_stats() {
  local profile_name="$1" label="$2" db_path="$3"
  if [ ! -f "$db_path" ]; then echo "  [${label}] 无 state.db"; return; fi
  if ! command -v sqlite3 >/dev/null 2>&1; then echo "  [${label}] sqlite3 未安装，跳过"; return; fi
  local stats
  stats=$(sqlite3 "$db_path" "SELECT COALESCE(SUM(input_tokens),0)||'|'||COALESCE(SUM(output_tokens),0)||'|'||COALESCE(SUM(reasoning_tokens),0)||'|'||COALESCE(ROUND(SUM(estimated_cost_usd),4),0)||'|'||COUNT(*) FROM sessions;" 2>/dev/null || true)
  [ -n "$stats" ] || { echo "  [${label}] 无法读取 sessions 表"; return; }
  IFS='|' read -r input output reasoning cost sessions <<< "$stats"
  echo "  ┌─ ${label} (${profile_name})"
  echo "  │  会话数:      ${sessions}"
  echo "  │  输入 tokens: ${input}"
  echo "  │  输出 tokens: ${output}"
  echo "  │  推理 tokens: ${reasoning}"
  echo "  └─ 累计费用:    \$${cost} USD"
  echo ""
}

print_all_stats() {
  log_section "=========================================="
  log_section "  📊 Hermes 历史 Token 统计"
  log_section "=========================================="
  print_profile_stats "default" "默认分身" "$HERMES_DIR/state.db"
  print_profile_stats "pm" "PM分身" "$HERMES_DIR/profiles/pm/state.db"
  print_profile_stats "tech" "研发经理分身" "$HERMES_DIR/profiles/tech/state.db"
}

post_restore_notes() {
  log_section "=========================================="
  log_info "✅ Hermes 全量恢复完成"
  log_info "目标目录: $HERMES_DIR"
  [ -d "$BACKUP_DIR" ] && log_info "旧目录备份: $BACKUP_DIR"
  echo ""
  log_info "建议检查："
  echo "  hermes doctor"
  echo "  hermes config check"
  echo "  hermes profile list"
  echo ""
  log_info "启动/重启 Gateway："
  echo "  hermes gateway restart || hermes gateway start || hermes gateway run"
  echo ""
  if [ -d "$HERMES_DIR/monitor" ]; then
    log_info "监控面板目录已恢复：$HERMES_DIR/monitor"
    echo "  cd $HERMES_DIR/monitor"
    echo "  python3 backend/monitor_server.py &"
    echo "  # 默认访问: http://<server-ip>:8899/"
  fi
  echo ""
  log_info "CC研发中转代理（端口80）："
  echo "  # 如果使用 Claude Code CLI 研发分身，需要启动中转代理"
  echo "  export ANTHROPIC_BASE_URL=http://<server-ip>:80"
  echo "  python3 $HERMES_DIR/monitor/claude-proxy-server-80.py &"
  echo ""
  if [ -d "$HERMES_DIR/profiles/tech" ]; then
    log_info "tech/PM 分身配置已恢复：$HERMES_DIR/profiles/"
    echo "  # 查看分身列表：hermes profile list"
    echo "  # 重启特定分身：hermes -p tech gateway restart"
  fi
  echo ""
  if [ -d "$BACKUP_DIR" ]; then
    log_info "如需回滚："
    echo "  rm -rf '$HERMES_DIR' && cp -a '$BACKUP_DIR' '$HERMES_DIR'"
  fi
  log_section "=========================================="
}

main() {
  echo "========================================"
  echo "  Hermes 全量配置/数据恢复脚本"
  echo "========================================"
  echo "目标目录: $HERMES_DIR"
  echo ""
  if [ "$STATS_ONLY" = 1 ]; then
    print_all_stats
    exit 0
  fi
  check_deps
  clone_repo
  copy_repo_to_target
  [ "$DRY_RUN" = 1 ] || print_all_stats
  [ "$DRY_RUN" = 1 ] || post_restore_notes
  rm -rf "$TMP_DIR"
}

main "$@"
