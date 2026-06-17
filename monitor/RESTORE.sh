#!/usr/bin/env bash
#
# Hermes Monitor 全量恢复脚本 (v22)
# 恢复 monitor 全套组件：前端、后端、代理服务、SPEC、metrics 数据
#
# 用法：
#   bash monitor/RESTORE.sh
#
# 注意：需在目标服务器的 /root/.hermes/monitor/ 目录下执行
#       会覆盖现有文件，建议先备份
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_DIR="${MONITOR_DIR:-/root/.hermes/monitor}"
BACKUP_DIR="${MONITOR_DIR}_backup_$(date +%Y%m%d_%H%M%S)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# 备份现有监控目录
if [ -d "$MONITOR_DIR" ]; then
    log_warn "检测到现有监控目录，备份到: $BACKUP_DIR"
    cp -a "$MONITOR_DIR" "$BACKUP_DIR"
fi

log_info "开始恢复 Hermes Monitor ..."

# 1. 恢复前端
log_info "  [1/5] 恢复前端文件 ..."
mkdir -p "$MONITOR_DIR/frontend/data"
cp "$SCRIPT_DIR/frontend/index.html" "$MONITOR_DIR/frontend/index.html"
cp "$SCRIPT_DIR/frontend/pixel-office.js" "$MONITOR_DIR/frontend/pixel-office.js"
cp "$SCRIPT_DIR/frontend/server-panel.js" "$MONITOR_DIR/frontend/server-panel.js"
[ -f "$SCRIPT_DIR/frontend/logo.svg" ] && cp "$SCRIPT_DIR/frontend/logo.svg" "$MONITOR_DIR/frontend/logo.svg" || true
cp -a "$SCRIPT_DIR/frontend/data/"* "$MONITOR_DIR/frontend/data/"

# 2. 恢复后端
log_info "  [2/5] 恢复后端文件 ..."
mkdir -p "$MONITOR_DIR/backend"
cp "$SCRIPT_DIR/backend/monitor_server.py" "$MONITOR_DIR/backend/monitor_server.py"
cp "$SCRIPT_DIR/backend/hermes_collector.py" "$MONITOR_DIR/backend/hermes_collector.py"

# 3. 恢复代理服务（CC研发中转代理）
log_info "  [3/5] 恢复中转代理服务 ..."
cp "$SCRIPT_DIR/claude-proxy-server-80.py" "$MONITOR_DIR/claude-proxy-server-80.py"
chmod +x "$MONITOR_DIR/claude-proxy-server-80.py"

# 4. 恢复 SPEC 文档
log_info "  [4/5] 恢复 SPEC 文档 ..."
for spec in "$SCRIPT_DIR"/SPEC-*.md; do
    [ -f "$spec" ] && cp "$spec" "$MONITOR_DIR/" || true
done

# 5. 恢复 metrics 数据
log_info "  [5/5] 恢复 metrics 数据 ..."
[ -f "$SCRIPT_DIR/external_metrics.json" ] && cp "$SCRIPT_DIR/external_metrics.json" "$MONITOR_DIR/external_metrics.json" || true

# 创建必要目录
mkdir -p "$MONITOR_DIR/archive"

log_info ""
log_info "✅ Hermes Monitor 恢复完成"
log_info "目标目录: $MONITOR_DIR"
[ -d "$BACKUP_DIR" ] && log_info "旧目录备份: $BACKUP_DIR"
echo ""
log_info "启动监控服务："
echo "  cd $MONITOR_DIR"
echo "  # 启动后端服务（端口8899）"
echo "  python3 backend/monitor_server.py &"
echo "  # 启动中转代理（端口80，CC研发用）"
echo "  python3 claude-proxy-server-80.py &"
echo "  # 访问面板"
echo "  http://<server-ip>:8899/"
echo ""
log_info "启动前请确认端口 80、8899 未被占用"
echo ""
