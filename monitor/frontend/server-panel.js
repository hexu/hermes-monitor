// ============================================================
// Hermes 监控中心 v21 — 服务器面板模块（M2 Daily Metrics Dashboard）
// 右侧 20% 仪表盘：保留累计指标，新增今日指标与运行态信息
// ============================================================

const ServerPanel = {
  _data: null,
  _metrics: null,
  _canvases: {},  // profile -> {canvas}
  _selectedProfile: null,
  _metricsTimer: null,
  _lastMetricsError: null,

  COLORS: { default: '#a78bfa', pm: '#ff6b9d', tech: '#00f5d4', cron: '#94a3b8', laptop: '#fbbf24', 'claude-code': '#fbbf24' },
  NAMES:  { default: 'AI助手',  pm: 'PM',       tech: '研发经理', cron: 'Cron系统', laptop: '笔记本', 'claude-code': 'Claude Code' },
  PALETTE: ['#a78bfa','#ff6b9d','#00f5d4','#fbbf24','#34d399',
            '#f87171','#60a5fa','#e879f9','#4ade80','#f97316'],
  _colorMap: {},
  _nameMap: {},
  _paletteIdx: 0,

  init() {
    this._fetchMetrics();
    if (!this._metricsTimer) this._metricsTimer = setInterval(() => this._fetchMetrics(), 30000);
  },

  selectProfile(name, opts={}) {
    this._selectedProfile = name || null;
    this._renderAll();
    if (!opts.fromOffice && window.PixelOffice && typeof window.PixelOffice.selectProfile === 'function') {
      window.PixelOffice.selectProfile(this._selectedProfile, { fromServer: true });
    }
  },

  resize() {
    Object.values(this._canvases).forEach(({canvas}) => this._sizeCanvas(canvas));
    this._renderAll();
  },

  // M4: 每 5 分钟采样一次 token 到历史
  _getStatus(profile, mp) {
    // 动态计算 status（idle 秒数驱动）
    if (profile === 'claude-code') {
      const lastActive = mp?.last_active;
      if (lastActive) {
        const idleSec = (Date.now() / 1000) - (lastActive < 1000000000000 ? lastActive : lastActive / 1000);
        if (idleSec > 1800) return 'sleeping';
        if (idleSec > 300) return 'idle';
        return 'working';
      }
      return mp?.status || 'idle';
    }
    return mp?.status || 'unknown';
  },

  update(d) {
    // WebSocket 的 d.profiles 只有 Hermes 原生分身，
    // 需要把 external_metrics（claude-code 等）的数据补进去
    const metricProfiles = (this._metrics && this._metrics.profiles) || [];
    const wsNames = new Set((d.profiles || []).map(p => p.profile));
    for (const mp of metricProfiles) {
      if (!wsNames.has(mp.profile)) {
        // external 分身不在 WS 数据里，补一个基础条目（数据全从 metrics 取）
        d.profiles = d.profiles || [];
        d.profiles.push({
          profile: mp.profile,
          status: this._getStatus(mp.profile, mp),
          location: mp.location || 'laptop',
          message_count: mp.total_message_count || mp.message_count || mp.today_message_count || 0,
          tool_call_count: mp.total_tool_call_count || mp.tool_call_count || mp.today_tool_call_count || 0,
          total_tokens: mp.total_tokens || mp.today_tokens || 0,
          last_active: mp.last_active || null,
          metadata: { model: mp.metadata && mp.metadata.model || 'MiniMax-M3' },
          _is_claude_code: mp.profile === 'claude-code',
        });
      } else {
        // WS 已有该分身：用 metrics 补上 WS 为空/0 的 lifetime 字段（Hermes
        // collect() 不实时算 sessions 累计，导致 WS 的 total_tokens/message_count
        // 经常是 0 或旧值）。同时用 metrics 更新实时状态。
        const existing = d.profiles.find(p => p.profile === mp.profile);
        if (existing) {
          existing.status = this._getStatus(mp.profile, mp);
          existing.location = mp.location || existing.location || 'workstation';
          existing.last_active = mp.last_active || existing.last_active || null;
          existing.metadata = { model: mp.metadata && mp.metadata.model || existing.metadata && existing.metadata.model || 'MiniMax-M3' };
          existing._is_claude_code = mp.profile === 'claude-code';
          // metrics 的 lifetime（累计）比 WS 准——只有 metrics 才有完整累计值
          if (!existing.total_tokens || existing.total_tokens === 0) {
            existing.total_tokens = mp.total_tokens || mp.today_tokens || existing.total_tokens || 0;
          }
          if (!existing.message_count) {
            existing.message_count = mp.total_message_count || mp.message_count || mp.today_message_count || 0;
          }
          if (!existing.tool_call_count) {
            existing.tool_call_count = mp.total_tool_call_count || mp.tool_call_count || mp.today_tool_call_count || 0;
          }
        }
      }
    }
    this._data = d;
    this._ensurePanels(d.profiles || []);
    this._renderAll();
  },

  async _fetchMetrics() {
    try {
      const r = await fetch('/api/metrics/daily', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this._metrics = await r.json();
      this._lastMetricsError = null;
      // 确保外部 profile（laptop）的面板也被创建
      this._ensurePanels(this._metrics.profiles || []);
      this._renderAll();
    } catch (e) {
      this._lastMetricsError = String(e && e.message || e);
      // 保持旧 metrics，不清空面板。
      this._renderAll();
    }
  },

  _metricFor(profile) {
    const rows = (this._metrics && this._metrics.profiles) || [];
    return rows.find(x => x.profile === profile) || null;
  },

  _ensurePanels(profiles) {
    const container = document.getElementById('servers');
    if (!container) return;
    const existing = new Set(Object.keys(this._canvases));
    const incoming = new Set(profiles.map(p => p.profile));

    for (const name of existing) {
      if (!incoming.has(name)) {
        const el = document.getElementById('panel-' + name);
        if (el) el.remove();
        delete this._canvases[name];
      }
    }
    for (const p of profiles) {
      if (!this._canvases[p.profile]) {
        const div = document.createElement('div');
        div.className = 'panel';
        div.id = 'panel-' + p.profile;
        const cv = document.createElement('canvas');
        div.appendChild(cv);
        div.addEventListener('click', () => this.selectProfile(p.profile));
        container.appendChild(div);
        this._canvases[p.profile] = { canvas: cv };
      }
    }
  },

  _sizeCanvas(canvas) {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 1 || h < 1) return null;
    // 统一在同一个 transform 里缩放（dpr × spScale 在渲染时算）
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { w, h, ctx };
  },

  _renderAll() {
    if (!this._data) return;
    for (const pr of (this._data.profiles || [])) {
      const entry = this._canvases[pr.profile];
      if (!entry) continue;
      const sz = this._sizeCanvas(entry.canvas);
      if (!sz) continue;
      this._renderOne(sz.ctx, sz.w, sz.h, pr, this._metricFor(pr.profile));
    }
  },

  _col(name) {
    if (this.COLORS[name]) return this.COLORS[name];
    if (!this._colorMap[name]) {
      this._colorMap[name] = this.PALETTE[this._paletteIdx % this.PALETTE.length];
      this._paletteIdx++;
    }
    return this._colorMap[name];
  },

  _lbl(name) {
    if (this.NAMES[name]) return this.NAMES[name];
    if (!this._nameMap[name]) {
      let label = String(name || '').replace(/^(agent-|profile-|sub-|child-)/i, '');
      label = label.charAt(0).toUpperCase() + label.slice(1);
      this._nameMap[name] = label || name;
    }
    return this._nameMap[name];
  },

  _fmt(n) {
    n = Number(n || 0);
    if (!Number.isFinite(n)) return '--';
    if (n >= 100000000) return (n/100000000).toFixed(1)+'亿';
    if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
    if (n >= 1000) return (n/1000).toFixed(1)+'K';
    return String(Math.round(n));
  },

  _fmtToken(n) { return this._fmt(n); },

  _parseTime(v) {
    if (!v || v === 'N/A') return null;
    if (typeof v === 'number') {
      const ms = v < 1000000000000 ? v * 1000 : v;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const text = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
      const n = Number(text);
      const d = new Date(n < 1000000000000 ? n * 1000 : n);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // 后端 ISO 字符串无时区时按服务器 CST/Asia-Shanghai 解释，避免浏览器时区导致“最近活跃”偏移 8 小时。
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : text + '+08:00';
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
  },

  _fmtTimeAgo(v) {
    const d = this._parseTime(v);
    if (!d) return String(v || 'N/A').slice(11, 19) || 'N/A';
    const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (sec < 60) return sec + '秒前';
    if (sec < 3600) return Math.floor(sec / 60) + '分钟前';
    if (sec < 86400) return Math.floor(sec / 3600) + '小时前';
    return Math.floor(sec / 86400) + '天前';
  },

  _fmtDuration(sec) {
    sec = Number(sec);
    if (!Number.isFinite(sec)) return '--';
    if (sec < 60) return Math.floor(sec) + '秒';
    if (sec < 3600) return Math.floor(sec / 60) + '分';
    return Math.floor(sec / 3600) + '时' + Math.floor((sec % 3600) / 60) + '分';
  },

  _fmtActiveMinutes(min) {
    min = Number(min || 0);
    if (!Number.isFinite(min) || min <= 0) return '0分';
    if (min < 60) return Math.round(min) + '分';
    return Math.floor(min / 60) + '时' + Math.round(min % 60) + '分';
  },

  _cnHour() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = t => Number((parts.find(p => p.type === t) || {}).value || 0);
    return get('hour') + get('minute') / 60;
  },

  _phase() {
    const h = this._cnHour();
    if (h >= 22 || h < 6) return 'night';
    if (h < 8) return 'dawn';
    if (h < 17) return 'day';
    if (h < 19) return 'dusk';
    return 'evening';
  },

  _statusLabel(status) {
    if (status === 'working') return '工作中';
    if (status === 'thinking') return '思考中';
    if (status === 'idle') return '待机中';
    if (status === 'error') return '异常';
    if (status === 'sleeping') return this._phase() === 'night' ? '睡眠中' : '休眠中';
    return this._phase() === 'night' ? '睡眠中' : '休眠中';
  },

  _roundRect(ctx, x, y, w, h, r, fill=true, stroke=false) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.lineTo(x+w-rr, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+rr);
    ctx.lineTo(x+w, y+h-rr);
    ctx.quadraticCurveTo(x+w, y+h, x+w-rr, y+h);
    ctx.lineTo(x+rr, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-rr);
    ctx.lineTo(x, y+rr);
    ctx.quadraticCurveTo(x, y, x+rr, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  },

  _fitText(ctx, text, x, y, maxW, fs, color, align='right', weight='bold') {
    let size = fs;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px sans-serif`;
    while (ctx.measureText(text).width > maxW && size > 9) {
      size -= 0.5;
      ctx.font = `${weight} ${size}px sans-serif`;
    }
    ctx.fillText(text, x, y);
  },

  _divider(ctx, x1, y, x2, alpha=0.16) {
    ctx.save();
    ctx.strokeStyle = `rgba(170,190,220,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, Math.round(y) + 0.5);
    ctx.lineTo(x2, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  },

  _metricRow(ctx, x, y, w, label, value, color, fs=15) {
    // 同一 baseline：左侧说明与右侧数值对齐，避免"上下错位"的视觉感。
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9aabc9';
    ctx.font = `bold ${Math.round(fs * 0.75)}px sans-serif`;
    ctx.fillText(label, x, y);
    this._fitText(ctx, value, x + w, y, Math.max(32, w - 58), fs, color, 'right', 'bold');
  },

  _renderOne(ctx, W, H, pr, mt) {
    ctx.clearRect(0, 0, W, H);
    const col = this._col(pr.profile);
    const name = this._lbl(pr.profile);
    const status = pr.status || 'unknown';
    const active = status === 'working' || status === 'thinking';
    const selected = this._selectedProfile === pr.profile;
    const statusLabel = this._statusLabel(status);

    // ── 物理像素尺度（唯一尺度，字体+间距统一） ─────────────────────────
    // 字体：窄屏保护10px，大屏上限18px，随宽度平滑缩放
    const fontSize = Math.max(10, Math.min(18, 15 * Math.pow(W / 256, 0.45)));
    // 间距系数：spacing 随宽度增长比字体慢（^0.55），避免大屏太散、小屏太挤
    const space = Math.max(0.6, Math.min(1.6, Math.pow(W / 256, 0.55)));

    // ── 背景 ──
    ctx.fillStyle = '#0b0f1d';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ── 边框/选中/活跃 ──
    ctx.save();
    const pulse = selected ? 0.75 + 0.20 * Math.sin(Date.now()/360) : 0.45 + 0.25 * Math.sin(Date.now()/520);
    ctx.shadowColor = col;
    ctx.shadowBlur = selected ? 13 * pulse : (active ? 7 * pulse : 0);
    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? 3 : (active ? 2 : 1.4);
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    if (selected) {
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = col;
      ctx.fillRect(3, 3, W - 6, H - 6);
    }
    ctx.restore();

    const pad = 10 * space;
    const barH = Math.max(24, Math.min(38, fontSize * 1.6));

    // ── 顶部条 ──
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, W, barH);
    ctx.fillStyle = '#0b0f1d';
    ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, pad + 2, barH / 2);
    ctx.font = `bold ${Math.round(fontSize * 0.87)}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(statusLabel, W - pad, barH / 2);

    // ── TODAY 指标盒（顶部条下方）
    // 布局：左侧 [TODAY] [token色块标注]  右侧 [消耗值] [消息/调用]
    // 三行 y 统一 todayBaseline
    const todayBoxY = barH + 6 * space;
    const todayBoxH = Math.round(fontSize * 1.6);  // 紧凑
    const todayBaseline = todayBoxY + fontSize * 0.8; // 统一 baseline

    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    this._roundRect(ctx, pad, todayBoxY, W - pad * 2, todayBoxH, 8, true, false);

    // 左侧：TODAY
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6a7a9a';
    ctx.font = `${Math.round(fontSize * 0.67)}px sans-serif`;
    ctx.fillText('TODAY', pad + 8 * space, todayBaseline);

    // 左侧：token 小标签，带颜色
    ctx.fillStyle = col + '99';  // 半透明色
    ctx.font = `${Math.round(fontSize * 0.6)}px sans-serif`;
    ctx.fillText('token', pad + 8 * space + ctx.measureText('TODAY').width + 5 * space, todayBaseline);

    // 右侧：消耗数值
    const todayToken = mt ? this._fmtToken(mt.today_tokens) : '--';
    ctx.textAlign = 'right';
    ctx.fillStyle = col;
    ctx.font = `bold ${Math.round(fontSize * 1.0)}px sans-serif`;
    ctx.fillText(todayToken, W - pad - 4, todayBaseline);

    // ── 累计指标区（紧贴 TODAY 盒下方） ──
    const divider1Y = todayBoxY + todayBoxH + 10 * space;
    this._divider(ctx, pad, divider1Y, W - pad, 0.18);
    const rowH = fontSize * 1.8;          // 每行高度（紧凑）
    const colW = (W - pad * 2 - 8 * space) / 2;  // 两列等宽

    const col1X = pad + 2;
    const col2X = pad + colW + 8 * space;

    const row1Y = divider1Y + rowH * 0.55;
    this._metricRow(ctx, col1X, row1Y, colW, '累计消耗', this._fmtToken(pr.total_tokens || 0), '#e8d840', fontSize);
    this._metricRow(ctx, col2X, row1Y, colW, '累计消息', this._fmt(pr.message_count || 0), '#00e5cc', fontSize);

    const row2Y = divider1Y + rowH * 1.65;
    this._divider(ctx, pad, row2Y - rowH * 0.4, W - pad, 0.14);
    this._metricRow(ctx, col1X, row2Y, colW, '累计调用', this._fmt(pr.tool_call_count || 0), '#ff8855', fontSize);
    const activeMinutesToday = mt ? Number(mt.active_minutes_today || 0) : NaN;
    this._metricRow(ctx, col2X, row2Y, colW, '今日活跃', mt ? this._fmtActiveMinutes(activeMinutesToday) : '--', '#93c5fd', fontSize);

    const divider2Y = divider1Y + rowH * 2.7;
    this._divider(ctx, pad, divider2Y, W - pad, 0.14);

    // ── 底部区域（Model / 最近活跃）：锚定在画布底部，向上排列 ──
    const bottomLineY = H - Math.round(fontSize * 0.8);   // 最后一行 baseline
    const lastActiveY = bottomLineY;
    const modelLabelY = bottomLineY - fontSize * 1.3;

    this._divider(ctx, pad, modelLabelY - fontSize * 0.55, W - pad, 0.14);

    ctx.fillStyle = '#8fa1c0';
    ctx.font = `bold ${Math.round(fontSize * 0.73)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Model', pad, modelLabelY);

    const model = (pr.metadata && pr.metadata.model) || 'unknown';
    this._fitText(ctx, model, W - pad, modelLabelY, W - fontSize * 3.5 - pad, Math.round(fontSize * 0.87), col, 'right', 'bold');

    ctx.fillStyle = '#7f8da8';
    ctx.font = `${Math.round(fontSize * 0.67)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('最近活跃', pad, lastActiveY);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d8e0f0';
    ctx.fillText(this._fmtTimeAgo(mt?.last_active || pr.last_active), W - pad, lastActiveY);

    if (this._lastMetricsError && !this._metrics) {
      ctx.fillStyle = 'rgba(255,80,80,0.18)';
      ctx.fillRect(0, H - 4, W, 4);
    }
  }
};

window.ServerPanel = ServerPanel;
