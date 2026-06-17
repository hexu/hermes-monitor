// ============================================================
// Hermes 监控中心 v21 — 大画布办公室渲染（M5：Rule Inspector / Debug Controls）
// 30x20 tiles, 32px each = 960x640 px
// 三房间（卧室/休息/工位）+ 横向走廊，纯 Canvas 程序化绘制
// 离屏 canvas 缓存静态层，每帧仅 blit 一次
// ============================================================

const PixelOffice = {
  // 配置
  TILE: 32,
  W_TILES: 30,
  H_TILES: 20,

  // 数据
  _data: null,
  _tilemap: null,
  _seats: null,
  _rules: null,      // V21-M4: externalized persona / scene event rules
  _serverMetrics: null, // V22: server panel metrics (for claude-code hover card)
  _staticCanvas: null,  // 离屏静态层
  _staticReady: false,
  _frame: 0,
  _actors: {},       // M3: profile -> actor runtime state
  _walkGrid: null,   // M3: 0/1 walkability grid
  _colorMap: {},     // M4: dynamic profile -> palette color, stable by arrival order
  _lastBehaviorRoll: 0, // M4: soft behavior cadence
  _globalEventCooldowns: {}, // M5: global stagger for persona events
  _sessionSeed: 0, // M6: session-level random seed
  _randState: 0,   // M6: deterministic-in-session RNG state
  _hitboxes: [],   // V21-M1: screen-space profile hitboxes for Inspector
  _sceneEvent: null, // V21-M3: current multi-actor scene event
  _nextSceneEventAt: 0,
  _sceneEventSeq: 0,
  _sceneEventCooldowns: {},
  _hoverProfile: null,
  _selectedProfile: null,
  _mouse: { x: 0, y: 0, inside: false },
  _debugInspector: false,
  _debugForceScene: null, // V21-M5: URL debug forceScene=type
  _debugForcePersona: null, // V21-M5: URL debug forcePersona=profile:type
  _debugForceApplied: false,
  _debugLastAction: null,

  // 颜色调色板（与 server-panel 共享）
  COLORS: { default: '#a78bfa', pm: '#ff6b9d', tech: '#00f5d4', 'claude-code': '#fbbf24' },
  PALETTE: ['#a78bfa','#ff6b9d','#00f5d4','#fbbf24','#34d399',
            '#f87171','#60a5fa','#e879f9','#4ade80','#f97316'],

  // === 像素配色 ===
  C: {
    void:        '#050810',
    floor_bed:   '#332d4a',  // 卧室地板：低饱和紫灰，抬亮以衬出腿部
    floor_bed_d: '#2d2842',
    floor_lng:   '#3f3442',  // 休息区地板：暖灰紫，降低与深色腿部的混淆
    floor_lng_d: '#382f3c',
    floor_ws:    '#2b3a3d',  // 工位区地板：冷蓝灰，避免贴近裤腿 #1b2430
    floor_ws_d:  '#263538',
    floor_cor:   '#262d3c',  // 走廊地板：中性蓝灰，提升脚部可见性
    floor_cor_d: '#222838',
    wall_top:    '#3a3550',
    wall_mid:    '#252035',
    wall_dark:   '#15101f',
    wall_high:   '#5a5070',
    door:        '#604030',
    door_dk:     '#3a2818',
    window_frame:'#5a5a78',
    window_glass:'#5a8aa8',
    window_night:'#1a2540',

    // 家具
    bed_frame:   '#604030',
    bed_sheet:   '#6050a0',
    bed_pillow:  '#a090d8',
    bed_blanket: '#4a3a80',
    desk:        '#604530',
    desk_top:    '#7a5535',
    chair:       '#3a2820',
    chair_seat:  '#5a3828',
    monitor_fr:  '#202028',
    monitor_sc:  '#1a3a5a',
    keyboard:    '#3a3a4a',
    lamp_pole:   '#504030',
    lamp_shade:  '#2a2a30',
    lamp_off:    '#3a3a44',
    sofa3:       '#4a3a60',
    sofa3_d:     '#3a2a50',
    sofa3_arm:   '#5a4a70',
    sofa1:       '#5a4575',
    sofa1_arm:   '#6a5585',
    table:       '#504030',
    table_top:   '#6a5440',
    coffee_m:    '#3a3a48',
    coffee_acc:  '#a04030',
    water_d:     '#5a8aa8',
    water_btm:   '#3a5a78',
    treadmill:   '#252530',
    treadmill_belt: '#15151c',
    plant_pot:   '#5a3825',
    plant_leaf:  '#3a8050',
    plant_leaf2: '#2a6040',
    whiteboard:  '#e8e8f0',
    whiteboard_fr:'#3a3a4a',
    printer:     '#3a3a48',
    printer_acc: '#5a5a6a',
    cabinet:     '#604030',
    cabinet_l:   '#7a5535',
    rug:         '#603550',
    rug_d:       '#502848',
    alarm:       '#3a2828',
    alarm_face:  '#e8e0c0',
    wardrobe:    '#503820',
    wardrobe_l:  '#704c2e',
  },

  // ── 初始化 ──
  async init() {
    this._initRandomSeed();
    // 加载地图数据
    try {
      const [tm, st, rules] = await Promise.all([
        fetch('/static/data/tilemap.json').then(r => r.json()),
        fetch('/static/data/seats.json').then(r => r.json()),
        fetch('/static/data/rules-v21-m4.json').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      this._tilemap = tm;
      this._seats = st;
      this._rules = rules || this._defaultRules();
      this._buildWalkGrid();
    } catch (e) {
      console.error('[PixelOffice] 加载地图数据失败:', e);
      return;
    }

    // 主 canvas
    this._mainCanvas = document.getElementById('cv-office');
    if (!this._mainCanvas) { console.error('[PixelOffice] cv-office canvas 未找到'); return; }
    this._setupInspector();
    // 加载 server metrics（用于 CC研发 hover 详情卡）
    this._fetchServerMetrics();
    setInterval(() => this._fetchServerMetrics(), 30000);

    // 离屏静态 canvas
    this._staticCanvas = document.createElement('canvas');
    this._staticCanvas.width  = this.W_TILES * this.TILE;
    this._staticCanvas.height = this.H_TILES * this.TILE;
    this._renderStatic();
    this._staticReady = true;

    this.resize();
    this._loop();

    // 隐藏 loading
    const ld = document.getElementById('loading');
    if (ld) ld.style.display = 'none';
  },

  resize() {
    if (!this._mainCanvas) return;
    const wrap = this._mainCanvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);

    // 让 canvas 物理尺寸铺满左侧区域，不再按地图原始比例居中留空。
    this._mainCanvas.width = Math.floor(w * dpr);
    this._mainCanvas.height = Math.floor(h * dpr);
    this._mainCanvas.style.width = '100%';
    this._mainCanvas.style.height = '100%';

    const ctx = this._mainCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    this._mainCtx = ctx;
    this._viewW = w;
    this._viewH = h;
  },

  update(d) { this._data = d; },

  // ── V21-M1 Inspector：URL 参数、鼠标命中、外部联动 ──
  _setupInspector() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      this._debugInspector = params.get('debug') === '1';
      const hour = Number(params.get('hour'));
      // hour 只在 debug=1 时作为显式调试覆盖，避免普通访问残留 ?hour=23 导致误渲染深夜。
      if (this._debugInspector && Number.isFinite(hour) && hour >= 0 && hour < 24) this._debugHour = hour;
      else this._debugHour = undefined;
      this._debugForceScene = params.get('forceScene') || null;
      this._debugForcePersona = params.get('forcePersona') || null;
    } catch (e) { /* ignore URL parsing issues */ }
    if (!this._mainCanvas || this._inspectorReady) return;
    this._inspectorReady = true;
    this._mainCanvas.addEventListener('mousemove', (ev) => {
      const pt = this._eventPoint(ev);
      this._mouse = { x: pt.x, y: pt.y, inside: true };
      const hit = this._hitTest(pt.x, pt.y);
      this._hoverProfile = hit ? hit.profile : null;
      this._mainCanvas.style.cursor = hit ? 'pointer' : 'default';
    });
    this._mainCanvas.addEventListener('mouseleave', () => {
      this._mouse.inside = false;
      this._hoverProfile = null;
      if (this._mainCanvas) this._mainCanvas.style.cursor = 'default';
    });
    this._mainCanvas.addEventListener('click', (ev) => {
      const pt = this._eventPoint(ev);
      const hit = this._hitTest(pt.x, pt.y);
      this._selectedProfile = hit ? hit.profile : null;
      if (window.ServerPanel && typeof window.ServerPanel.selectProfile === 'function') {
        window.ServerPanel.selectProfile(this._selectedProfile, { fromOffice: true });
      }
    });
  },

  _eventPoint(ev) {
    const r = this._mainCanvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  },

  _hitTest(x, y) {
    for (let i = this._hitboxes.length - 1; i >= 0; i--) {
      const h = this._hitboxes[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  },

  selectProfile(name, opts={}) {
    this._selectedProfile = name || null;
    if (this._selectedProfile && opts.flash !== false) this._selectionFlashUntil = this._frame + 180;
  },

  // ── V21-M5 Rule Inspector / Debug Controls API ──
  debugSnapshot() {
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    const actors = profiles.map(p => {
      const name = p.profile || p.name || 'default';
      const a = this._actors[name] || {};
      const persona = a.persona || a.behavior || null;
      return {
        name,
        label: this._profileName(name),
        status: this._statusOf(p),
        workMode: a.workMode || this._workModeFromData(p),
        mode: a.mode || 'idle',
        targetKey: a.targetKey || null,
        persona: persona ? { type: persona.type || persona.state, phase: persona.phase || null, reason: persona.reason || null, until: persona.until || null } : null,
        sceneEventId: a.sceneEventId || null,
        sceneRole: a.sceneRole || null,
        scenePhrase: a.scenePhrase || null,
        nextPersonaIn: Number.isFinite(a.nextPersonaAt) ? Math.max(0, Math.round(a.nextPersonaAt - this._frame)) : null,
        cooldownIn: Math.max(0, Math.round((a.cooldownUntil || 0) - this._frame)),
        x: Number.isFinite(a.x) ? Number(a.x.toFixed(2)) : null,
        y: Number.isFinite(a.y) ? Number(a.y.toFixed(2)) : null
      };
    });
    return {
      version: 'v21-m5',
      rulesVersion: this._rules?.version || 'unknown',
      frame: this._frame,
      debug: !!this._debugInspector,
      timePhase: this._timePhase().key,
      sleepWindow: this._isSleepWindow(),
      profiles: profiles.map(p => ({ profile: p.profile || p.name, status: this._statusOf(p), location: p.location })),
      actors,
      sceneEvent: this._sceneEvent ? { ...this._sceneEvent, layout: undefined } : null,
      nextSceneEventIn: Math.max(0, Math.round((this._nextSceneEventAt || 0) - this._frame)),
      lastAction: this._debugLastAction || null
    };
  },

  forceSceneEvent(type) {
    if (!this._debugInspector) return { ok: false, reason: 'debug-disabled' };
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    if (!type) return { ok: false, reason: 'missing-type' };
    try {
      if (this._sceneEvent) this._releaseSceneEvent('debug-force-replace');
      const cd = this._sceneEventCooldowns || (this._sceneEventCooldowns = {});
      cd[type] = 0;
      const ev = this._maybeStartSceneEvent(profiles, type);
      const ok = !!(ev && ev.participants && ev.participants.length >= 2);
      this._debugLastAction = ok ? { ok: true, action: 'forceSceneEvent', type, participants: ev.participants, frame: this._frame } : { ok: false, action: 'forceSceneEvent', type, reason: 'no-candidate', frame: this._frame };
      return this._debugLastAction;
    } catch (e) {
      this._debugLastAction = { ok: false, action: 'forceSceneEvent', type, reason: String(e && e.message || e), frame: this._frame };
      return this._debugLastAction;
    }
  },

  forcePersona(profile, type) {
    if (!this._debugInspector) return { ok: false, reason: 'debug-disabled' };
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    const p = profiles.find(x => (x.profile || x.name) === profile);
    const a = this._actors[profile];
    if (!p || !a) return { ok: false, reason: 'profile-not-ready' };
    if (!type) return { ok: false, reason: 'missing-type' };
    try {
      if (a.sceneEventId && this._sceneEvent) this._releaseSceneEvent('debug-force-persona');
      const hard = this._hardTargetForProfile(p, profiles);
      this._cancelPersona(a, hard, 0);
      a.cooldownUntil = 0;
      const mode = hard.workMode || this._workModeFromData(p);
      const opts = this._personaOptionsFromRules(profile, mode, hard, profiles, a);
      const choice = opts.find(o => o.type === type);
      if (!choice) {
        this._debugLastAction = { ok: false, action: 'forcePersona', profile, type, reason: 'not-allowed', allowed: opts.map(o => o.type), frame: this._frame };
        return this._debugLastAction;
      }
      const timeout = Number(choice.timeout) || (choice.type === 'restroom' ? 1800 : (choice.type === 'sleep_bed' ? 2400 : 1500));
      a.persona = { ...choice, state: choice.type, mode, startedAt: this._frame, timeoutAt: this._frame + timeout, returnTarget: { ...hard }, interruptible: true, reason: 'v21-m5-force-persona' };
      a.behavior = a.persona;
      a.behaviorPhase = choice.phase || choice.type;
      a.behaviorUntil = 0;
      a.hidden = false;
      a.targetKey = '__debug_force_persona__';
      this._debugLastAction = { ok: true, action: 'forcePersona', profile, type, frame: this._frame };
      return this._debugLastAction;
    } catch (e) {
      this._debugLastAction = { ok: false, action: 'forcePersona', profile, type, reason: String(e && e.message || e), frame: this._frame };
      return this._debugLastAction;
    }
  },

  clearDebugEvent() {
    if (!this._debugInspector) return { ok: false, reason: 'debug-disabled' };
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    try {
      if (this._sceneEvent) this._releaseSceneEvent('debug-clear');
      for (const p of profiles) {
        const name = p.profile || p.name || 'default';
        const a = this._actors[name];
        if (!a) continue;
        const hard = this._hardTargetForProfile(p, profiles);
        this._cancelPersona(a, hard, 0);
        a.cooldownUntil = 0;
        a.hidden = false;
        a.targetKey = '__debug_clear__';
      }
      this._debugLastAction = { ok: true, action: 'clearDebugEvent', frame: this._frame };
      return this._debugLastAction;
    } catch (e) {
      this._debugLastAction = { ok: false, action: 'clearDebugEvent', reason: String(e && e.message || e), frame: this._frame };
      return this._debugLastAction;
    }
  },

  _maybeRunDebugAutoForce(profiles) {
    if (!this._debugInspector || this._debugForceApplied || this._frame < 45) return;
    if (!profiles || !profiles.length || !Object.keys(this._actors || {}).length) return;
    this._debugForceApplied = true;
    if (this._debugForceScene) {
      this.forceSceneEvent(this._debugForceScene);
    } else if (this._debugForcePersona) {
      const [profile, type] = String(this._debugForcePersona).split(':');
      this.forcePersona(profile, type);
    }
  },

  _profileByName(name) {
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    return profiles.find(p => (p.profile || p.name) === name) || null;
  },

  // ── V21-M4 Rule Config：rules JSON + safe fallback ──
  _defaultRules() {
    return {
      version: 'v21-m4-fallback',
      persona: { scheduler: { initial: { work: [120,720], offwork_day: [180,900], offwork_night: [360,1200] }, next: { work: [900,1800], offwork_day: [700,1700], offwork_night: [1200,2400] }, actor_jitter_mod: 180 }, cooldowns: { finish: { work: 1500, offwork: 1200, phone: 3600, restroom: 4200, sleep_bed: 2400, sofa_nap: 2400 }, global: { phone: 2400, restroom: 3000 } }, pools: { work: [], offwork: [] } },
      sceneEvents: { scheduler: { initial: [240,900], next: [1200,2600], cooldown: 3600, timeout: 2200, interactHold: [360,760] }, events: [], layouts: {} },
      thoughts: {}
    };
  },

  // V22: 拉取 server metrics（供 CC研发 hover 详情卡使用）
  async _fetchServerMetrics() {
    try {
      const r = await fetch('/api/metrics/daily', { cache: 'no-store' });
      if (r.ok) this._serverMetrics = await r.json();
    } catch (e) { /* silent - metrics are optional */ }
  },

  _rangeFromRule(path, fallback) {
    let cur = this._rules || {};
    for (const key of path) cur = cur && cur[key];
    const arr = Array.isArray(cur) ? cur : fallback;
    const a = Number(arr && arr[0]), b = Number(arr && arr[1]);
    return [Number.isFinite(a) ? a : fallback[0], Number.isFinite(b) ? b : fallback[1]];
  },

  _ruleNumber(path, fallback) {
    let cur = this._rules || {};
    for (const key of path) cur = cur && cur[key];
    const n = Number(cur);
    return Number.isFinite(n) ? n : fallback;
  },

  _ruleWeight(item, name, night=false) {
    if (!item) return 0;
    if (night && Number.isFinite(Number(item.nightWeight))) return Number(item.nightWeight);
    if (item.weights && Number.isFinite(Number(item.weights[name]))) return Number(item.weights[name]);
    if (item.weights && Number.isFinite(Number(item.weights.default))) return Number(item.weights.default);
    return Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0;
  },

  _ruleAllowed(item, ctx) {
    const w = item?.when || {};
    if (w.profile && w.profile !== '*' && w.profile !== ctx.name) return false;
    if (Array.isArray(w.profileIn) && !w.profileIn.includes(ctx.name)) return false;
    if (typeof w.night === 'boolean' && w.night !== ctx.night) return false;
    if (w.hardKind && w.hardKind !== ctx.hard.kind) return false;
    return true;
  },

  _evalCoord(expr, ctx, axisFallback) {
    if (typeof expr === 'number' && Number.isFinite(expr)) return expr;
    if (expr === 'hard.x') return ctx.hard.x;
    if (expr === 'hard.y') return ctx.hard.y;
    if (expr === 'hard.y+2') return ctx.hard.y + 2;
    if (expr === 'hard.x-2') return ctx.hard.x - 2;
    if (expr === '10+hash%9') return 10 + (ctx.hash % 9);
    if (expr === '10+hash%3') return 10 + (ctx.hash % 3);
    return axisFallback;
  },

  _resolvePersonaTarget(item, ctx) {
    const t = item?.target || {};
    let x = ctx.hard.x, y = ctx.hard.y;
    if (t.ref === 'hard') { x = ctx.hard.x; y = ctx.hard.y; }
    else if (t.ref === 'bed') {
      const beds = this._seats?.beds || [];
      const bed = beds[ctx.idx % Math.max(1, beds.length)] || ctx.hard;
      x = bed.x; y = bed.y;
    } else if (t.ref === 'loungeProp') {
      const prop = this._seats?.loungeProps?.[t.name] || ctx.hard;
      x = prop.x + (Number(t.dx) || 0); y = prop.y + (Number(t.dy) || 0);
    } else {
      x = t.xByProfile ? (Number(t.xByProfile[ctx.name]) || Number(t.xByProfile.default) || ctx.hard.x) : this._evalCoord(t.xExpr ?? t.x, ctx, ctx.hard.x);
      y = this._evalCoord(t.yExpr ?? t.y, ctx, ctx.hard.y);
    }
    if (Number.isFinite(Number(t.xMin))) x = Math.max(Number(t.xMin), x);
    if (Number.isFinite(Number(t.xMax))) x = Math.min(Number(t.xMax), x);
    if (Number.isFinite(Number(t.yMin))) y = Math.max(Number(t.yMin), y);
    if (Number.isFinite(Number(t.yMax))) y = Math.min(Number(t.yMax), y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = ctx.hard.x; y = ctx.hard.y; }
    return { x, y };
  },

  _personaOptionsFromRules(name, mode, hard, profiles, a) {
    const pools = this._rules?.persona?.pools || {};
    const items = Array.isArray(pools[mode]) ? pools[mode] : [];
    const hash = this._hashName(name);
    const night = this._isSleepWindow();
    const idx = this._profileIndex(name, profiles);
    const cd = a.personaCooldowns || (a.personaCooldowns = {});
    const global = this._globalEventCooldowns || (this._globalEventCooldowns = {});
    const recent = a.recentPersonaTypes || [];
    const blocked = (type) => this._frame < (cd[type] || 0) || this._frame < (global[type] || 0);
    const ctx = { name, mode, hard, profiles, a, hash, night, idx };
    const options = [];
    for (const item of items) {
      if (!item || !item.type || blocked(item.type) || !this._ruleAllowed(item, ctx)) continue;
      let w = this._ruleWeight(item, name, night);
      if (recent[0] === item.type) w = ['coding', 'sofa_idle', 'sleep_bed'].includes(item.type) ? Math.max(1, Math.round(w * 0.2)) : 0;
      else if (recent.includes(item.type)) w = Math.max(1, Math.round(w * 0.35));
      if (w <= 0) continue;
      let pos = this._resolvePersonaTarget(item, ctx);
      const targetRef = item?.target?.ref;
      // 非 hard/bed 目标是“走到某物旁边/窗边/白板旁”，最终落点必须避开桌子、白板、床、沙发等实体。
      if (!['hard', 'bed'].includes(targetRef)) pos = this._safeTarget({ x: pos.x, y: pos.y }, { allowReserved: false });
      const hold = item.holdByProfile && Number.isFinite(Number(item.holdByProfile[name])) ? Number(item.holdByProfile[name]) : item.hold;
      const spec = { ...item, x: pos.x, y: pos.y, hold: Number.isFinite(Number(hold)) ? Number(hold) : undefined, facing: item.facing === 'hard' ? hard.facing : (item.facing || hard.facing || 'south'), weight: w };
      if (Array.isArray(item.waypoints)) spec.waypoints = item.waypoints
        .map(pt => this._safeTarget({ x: Number(pt.x), y: Number(pt.y) }, { allowReserved: false }))
        .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
      options.push(spec);
    }
    return options;
  },

  _sceneEventRules() { return this._rules?.sceneEvents || this._defaultRules().sceneEvents; },

  // v20-M1 Safe Camera：在 cover 与 contain 之间折中。
  // 目标：优先保住顶部房间/标签；允许少量左右黑边，避免继续裁掉办公室上方。
  _cameraTransform(viewW, viewH, mapW, mapH) {
    const coverScale = Math.max(viewW / mapW, viewH / mapH);
    const containScale = Math.min(viewW / mapW, viewH / mapH);

    // 希望至少看见地图 0~18 tile 的主体安全区；同时保证横向填充不低于 80%。
    const safeVisibleH = 18 * this.TILE;
    const safeScale = viewH / safeVisibleH;
    const minFillScale = (viewW * 0.80) / mapW;
    let scale = Math.max(containScale, Math.max(safeScale, minFillScale));
    scale = Math.min(scale, coverScale);

    const drawW = Math.ceil(mapW * scale);
    const drawH = Math.ceil(mapH * scale);
    const dx = Math.floor((viewW - drawW) / 2);

    // 垂直方向不再居中裁顶部：如果高度仍超过视口，固定贴顶，优先裁底部装饰区。
    const dy = drawH > viewH ? 0 : Math.floor((viewH - drawH) / 2);

    this._camera = { scale, dx, dy, drawW, drawH, mode: 'v20-safe-camera' };
    return this._camera;
  },

  _loop() {
    this._frame++;
    this._render();
    requestAnimationFrame(() => this._loop());
  },

  _render() {
    if (!this._staticReady || !this._mainCtx) return;
    const ctx = this._mainCtx;
    const mapW = this.W_TILES * this.TILE;
    const mapH = this.H_TILES * this.TILE;
    const viewW = this._viewW || mapW;
    const viewH = this._viewH || mapH;
    ctx.clearRect(0, 0, viewW, viewH);

    // v20-M1 Safe Camera：保顶部/标签，允许少量横向黑边。
    const { scale, dx, dy, drawW, drawH } = this._cameraTransform(viewW, viewH, mapW, mapH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._staticCanvas, dx, dy, drawW, drawH);

    // M4 动态层：窗外昼夜、灯光、人物、全局滤镜。人物/灯光复用同一 cover 变换。
    const phase = this._timePhase();
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(scale, scale);
    this._drawDynamicWindows(ctx, phase);
    this._drawLights(ctx, profiles, phase);
    this._drawActiveWorkstationScreens(ctx, profiles);
    this._drawSceneActivityDetails(ctx);
    this._drawSceneEventDetails(ctx);
    this._drawProfiles(ctx);
    this._maybeRunDebugAutoForce(profiles);
    ctx.restore();
    this._drawTimeOverlay(ctx, viewW, viewH, phase);
    this._drawInspector(ctx, viewW, viewH);
  },

  // ── 静态层渲染（只跑一次） ──
  _renderStatic() {
    const ctx = this._staticCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const T = this.TILE;
    const W = this.W_TILES * T;
    const H = this.H_TILES * T;

    // 清空
    ctx.fillStyle = this.C.void;
    ctx.fillRect(0, 0, W, H);

    this._drawFloors(ctx);
    this._drawWalls(ctx);
    this._drawWindows(ctx);
    this._drawDoors(ctx);
    this._drawBedroomFurniture(ctx);
    this._drawLoungeFurniture(ctx);
    this._drawWorkspaceFurniture(ctx);
    this._drawCorridorDecor(ctx);
    this._drawRoomLabels(ctx);
  },



  // ── 基础绘制工具 ──
  _tile(ctx, x, y, color) {
    const T = this.TILE;
    ctx.fillStyle = color;
    ctx.fillRect(x*T, y*T, T, T);
  },

  _rect(ctx, x, y, w, h, color) {
    const T = this.TILE;
    ctx.fillStyle = color;
    ctx.fillRect(x*T, y*T, w*T, h*T);
  },

  _px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  },

  _outline(ctx, x, y, w, h, color, lw=2) {
    const T = this.TILE;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x*T + 1, y*T + 1, w*T - 2, h*T - 2);
  },

  _drawFloors(ctx) {
    const rooms = this._tilemap.rooms;
    for (const [name, r] of Object.entries(rooms)) {
      const base = name === 'bedroom' ? this.C.floor_bed : name === 'lounge' ? this.C.floor_lng : name === 'workspace' ? this.C.floor_ws : this.C.floor_cor;
      const dark = name === 'bedroom' ? this.C.floor_bed_d : name === 'lounge' ? this.C.floor_lng_d : name === 'workspace' ? this.C.floor_ws_d : this.C.floor_cor_d;
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          this._tile(ctx, xx, yy, ((xx + yy) % 2 === 0) ? base : dark);
        }
      }
    }
    // 走廊延伸下方装饰带
    this._rect(ctx, 0, 18, 30, 2, '#070a12');
  },

  _drawWalls(ctx) {
    const T = this.TILE;
    const rooms = this._tilemap.rooms;
    const drawShell = (r) => {
      // 顶墙/侧墙/底墙，2px 高光 + 暗边
      this._rect(ctx, r.x-1, r.y-1, r.w+2, 1, this.C.wall_top);
      this._rect(ctx, r.x-1, r.y, 1, r.h, this.C.wall_mid);
      this._rect(ctx, r.x+r.w, r.y, 1, r.h, this.C.wall_mid);
      this._rect(ctx, r.x-1, r.y+r.h, r.w+2, 1, this.C.wall_dark);
      ctx.fillStyle = this.C.wall_high;
      ctx.fillRect((r.x-1)*T, (r.y-1)*T, (r.w+2)*T, 3);
    };
    drawShell(rooms.bedroom);
    drawShell(rooms.lounge);
    drawShell(rooms.workspace);
    // 外围暗边
    this._outline(ctx, 0, 0, 30, 20, '#152035', 2);
  },

  _drawWindows(ctx) {
    const T = this.TILE;
    for (const w of this._tilemap.windows || []) {
      const x = w.x1 * T, y = w.y1 * T + 6;
      const ww = (w.x2 - w.x1 + 1) * T;
      this._px(ctx, x+4, y, ww-8, 16, this.C.window_frame);
      this._px(ctx, x+7, y+3, ww-14, 10, this.C.window_glass);
      // 像素云/星点（M1 静态白天）
      this._px(ctx, x+16, y+6, 14, 3, '#d8f0ff');
      this._px(ctx, x+44, y+4, 10, 2, '#c8e8ff');
    }
  },

  _drawDoors(ctx) {
    const T = this.TILE;
    for (const d of this._tilemap.doors || []) {
      // 打开底墙门洞：覆盖底墙，画木门槛
      const x = d.x * T, y = d.y * T;
      ctx.fillStyle = this.C.floor_cor;
      ctx.fillRect(x, y, T*2, T);
      ctx.fillStyle = this.C.door;
      ctx.fillRect(x+4, y+22, T*2-8, 8);
      ctx.fillStyle = this.C.door_dk;
      ctx.fillRect(x+4, y+29, T*2-8, 3);
    }
  },

  _drawBedroomFurniture(ctx) {
    const T = this.TILE, st = this._seats;
    // 地毯
    const rug = st.bedroomProps.rug;
    this._rect(ctx, rug.x1, rug.y1, rug.x2-rug.x1+1, rug.y2-rug.y1+1, this.C.rug);
    this._outline(ctx, rug.x1, rug.y1, rug.x2-rug.x1+1, rug.y2-rug.y1+1, this.C.rug_d, 1);
    // 床
    for (const b of st.beds) this._drawBed(ctx, b);
    // 衣柜
    const wd = st.bedroomProps.wardrobe;
    this._rect(ctx, wd.x1, wd.y1, wd.x2-wd.x1+1, wd.y2-wd.y1+1, this.C.wardrobe);
    this._outline(ctx, wd.x1, wd.y1, wd.x2-wd.x1+1, wd.y2-wd.y1+1, this.C.wardrobe_l, 1);
    // 闹钟
    const a = st.bedroomProps.alarm_clock;
    const ax = a.x*T, ay = a.y*T;
    this._px(ctx, ax+8, ay+12, 16, 14, this.C.alarm);
    this._px(ctx, ax+11, ay+15, 10, 8, this.C.alarm_face);
    this._px(ctx, ax+15, ay+18, 2, 2, '#101020');
  },

  _drawBed(ctx, b) {
    const T = this.TILE;
    // 支持竖床和横床
    const xs = b.tiles.map(t => t[0]), ys = b.tiles.map(t => t[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const w = x2-x1+1, h = y2-y1+1;
    this._rect(ctx, x1, y1, w, h, this.C.bed_frame);
    this._px(ctx, x1*T+4, y1*T+4, w*T-8, h*T-8, this.C.bed_sheet);
    this._px(ctx, x1*T+7, y1*T+7, Math.max(18, w*T-14), 12, this.C.bed_pillow);
    this._px(ctx, x1*T+6, y1*T+24, w*T-12, Math.max(12, h*T-30), this.C.bed_blanket);
    // 夜灯
    const [lx, ly] = b.lampTile;
    this._drawLamp(ctx, lx, ly, false);
  },

  _drawLoungeFurniture(ctx) {
    const st = this._seats, T = this.TILE;
    // 三人沙发
    this._drawSofa3(ctx, 12, 4);
    // 单人沙发
    this._drawSofa1(ctx, 16, 3, 'west');
    this._drawSofa1(ctx, 16, 7, 'west');
    // 茶几
    const tb = st.loungeProps.coffee_table;
    this._rect(ctx, tb.x1, tb.y1, tb.x2-tb.x1+1, 1, this.C.table);
    this._px(ctx, tb.x1*T+4, tb.y1*T+4, (tb.x2-tb.x1+1)*T-8, 16, this.C.table_top);
    // 咖啡机 / 饮水机 / 跑步机 / 绿植
    const cm = st.loungeProps.coffee_machine;
    this._drawMachine(ctx, cm.x, cm.y, 'coffee');
    const wd = st.loungeProps.water_dispenser;
    this._drawMachine(ctx, wd.x, wd.y, 'water');
    const tr = st.loungeProps.treadmill;
    this._rect(ctx, tr.x1, tr.y1, tr.x2-tr.x1+1, tr.y2-tr.y1+1, this.C.treadmill);
    this._px(ctx, tr.x1*T+8, tr.y1*T+8, (tr.x2-tr.x1+1)*T-16, (tr.y2-tr.y1+1)*T-16, this.C.treadmill_belt);
    this._drawPlant(ctx, st.loungeProps.plant1.x, st.loungeProps.plant1.y);
    this._drawPlant(ctx, st.loungeProps.plant2.x, st.loungeProps.plant2.y);
  },

  _drawWorkspaceFurniture(ctx) {
    const st = this._seats, T = this.TILE;
    for (const ws of st.workstations) this._drawWorkstation(ctx, ws);
    // 白板
    const wb = st.workspaceProps.whiteboard;
    this._rect(ctx, wb.x1, wb.y1, wb.x2-wb.x1+1, wb.y2-wb.y1+1, this.C.whiteboard_fr);
    this._px(ctx, wb.x1*T+4, wb.y1*T+4, (wb.x2-wb.x1+1)*T-8, (wb.y2-wb.y1+1)*T-8, this.C.whiteboard);
    ctx.fillStyle = '#607080';
    ctx.font = '9px monospace';
    ctx.fillText('PLAN', wb.x1*T+8, wb.y1*T+18);
    ctx.fillRect(wb.x1*T+8, wb.y1*T+28, 34, 2);
    ctx.fillRect(wb.x1*T+8, wb.y1*T+38, 44, 2);
    // 打印机/文件柜/绿植
    const pr = st.workspaceProps.printer;
    this._rect(ctx, pr.x1, pr.y1, pr.x2-pr.x1+1, pr.y2-pr.y1+1, this.C.printer);
    this._px(ctx, pr.x1*T+8, pr.y1*T+10, 36, 8, this.C.printer_acc);
    const cb = st.workspaceProps.filing_cabinet;
    this._rect(ctx, cb.x1, cb.y1, cb.x2-cb.x1+1, cb.y2-cb.y1+1, this.C.cabinet);
    for (let yy=cb.y1; yy<=cb.y2; yy++) this._px(ctx, cb.x1*T+8, yy*T+8, 42, 2, this.C.cabinet_l);
    this._drawPlant(ctx, st.workspaceProps.plant1.x, st.workspaceProps.plant1.y);
  },

  _drawWorkstation(ctx, ws) {
    const T = this.TILE;
    // 桌子（可能 1-2 tile 宽）
    const xs = ws.deskTiles.map(t => t[0]), ys = ws.deskTiles.map(t => t[1]);
    const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
    const w = x2-x1+1;
    this._rect(ctx, x1, y1, w, 1, this.C.desk);
    this._px(ctx, x1*T+3, y1*T+3, w*T-6, 18, this.C.desk_top);
    // 显示器
    this._px(ctx, x1*T+8, y1*T+5, Math.min(34, w*T-16), 14, this.C.monitor_fr);
    this._px(ctx, x1*T+11, y1*T+8, Math.min(28, w*T-22), 8, this.C.monitor_sc);
    // 键盘
    this._px(ctx, x1*T+9, y1*T+22, Math.min(30, w*T-18), 4, this.C.keyboard);
    // 椅子
    this._px(ctx, ws.x*T+8, ws.y*T+7, 16, 18, this.C.chair);
    this._px(ctx, ws.x*T+10, ws.y*T+10, 12, 10, this.C.chair_seat);
    this._drawLamp(ctx, ws.lampTile[0], ws.lampTile[1], false);
  },

  _drawSofa3(ctx, x, y) {
    const T = this.TILE;
    this._px(ctx, x*T, y*T+4, 4*T, 44, this.C.sofa3);
    this._px(ctx, x*T+4, y*T+20, 4*T-8, 24, this.C.sofa3_d);
    this._px(ctx, x*T, y*T+10, 10, 38, this.C.sofa3_arm);
    this._px(ctx, x*T+4*T-10, y*T+10, 10, 38, this.C.sofa3_arm);
    this._px(ctx, x*T+T, y*T+8, 2, 34, '#6a5a80');
    this._px(ctx, x*T+2*T, y*T+8, 2, 34, '#6a5a80');
  },

  _drawSofa1(ctx, x, y) {
    const T = this.TILE;
    this._px(ctx, x*T+2, y*T+2, 2*T-4, 2*T-4, this.C.sofa1);
    this._px(ctx, x*T+6, y*T+20, 2*T-12, 28, this.C.sofa3_d);
    this._px(ctx, x*T+2, y*T+10, 8, 42, this.C.sofa1_arm);
    this._px(ctx, x*T+2*T-10, y*T+10, 8, 42, this.C.sofa1_arm);
  },

  _drawMachine(ctx, x, y, type) {
    const T = this.TILE;
    if (type === 'coffee') {
      this._px(ctx, x*T+5, y*T+5, 22, 24, this.C.coffee_m);
      this._px(ctx, x*T+9, y*T+8, 14, 7, this.C.coffee_acc);
      this._px(ctx, x*T+12, y*T+20, 8, 5, '#d8c090');
    } else {
      this._px(ctx, x*T+8, y*T+4, 16, 24, this.C.water_btm);
      this._px(ctx, x*T+10, y*T+2, 12, 12, this.C.water_d);
      this._px(ctx, x*T+13, y*T+7, 6, 4, '#b8e8ff');
    }
  },

  _drawLamp(ctx, x, y, on) {
    const T = this.TILE;
    this._px(ctx, x*T+15, y*T+12, 2, 16, this.C.lamp_pole);
    this._px(ctx, x*T+9, y*T+8, 14, 8, on ? '#e8d840' : this.C.lamp_shade);
    this._px(ctx, x*T+11, y*T+26, 10, 3, this.C.lamp_off);
  },

  _drawPlant(ctx, x, y) {
    const T = this.TILE;
    this._px(ctx, x*T+10, y*T+20, 12, 9, this.C.plant_pot);
    this._px(ctx, x*T+13, y*T+9, 6, 14, this.C.plant_leaf);
    this._px(ctx, x*T+7, y*T+13, 10, 6, this.C.plant_leaf2);
    this._px(ctx, x*T+15, y*T+5, 10, 8, this.C.plant_leaf);
  },

  _drawCorridorDecor(ctx) {
    const T = this.TILE;
    // 主走廊方向箭头和厕所淡出提示（M1 静态）
    ctx.fillStyle = '#2a3a5a';
    for (let x = 2; x < 28; x += 4) {
      ctx.fillRect(x*T+10, 16*T+14, 14, 4);
      ctx.fillRect(x*T+20, 16*T+10, 4, 12);
    }
    ctx.fillStyle = '#c8d8f0';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('洗手间', 28*T+6, 14*T+16);
    // 右侧淡出区框线
    ctx.strokeStyle = '#3a4a6a';
    ctx.strokeRect(28*T+2, 14*T+2, 2*T-4, 4*T-4);
  },

  _drawRoomLabels(ctx) {
    const label = (text, x, y, color) => {
      const T = this.TILE;
      ctx.fillStyle = 'rgba(5,8,16,0.65)';
      ctx.fillRect(x*T+4, y*T+4, 76, 18);
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(text, x*T+10, y*T+17);
    };
    label('卧室区', 1, 1, '#a090d8');
    label('休息区', 11, 1, '#ffb0c8');
    label('工位区', 21, 1, '#00f5d4');
  },

  // ── M3：A* 路径与 actor 运行时 ──
  _buildWalkGrid() {
    const W = this.W_TILES, H = this.H_TILES;
    const grid = Array.from({ length: H }, () => Array(W).fill(0));
    const mark = (x1, y1, x2, y2, v) => {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
        if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = v;
      }
    };
    // 房间内部和主走廊可走；墙体/外部/下方装饰不可走。
    const r = this._tilemap.rooms;
    for (const key of ['bedroom', 'lounge', 'workspace', 'corridor']) {
      const rr = r[key];
      mark(rr.x, rr.y, rr.x + rr.w - 1, rr.y + rr.h - 1, 1);
    }
    // 门洞连接房间与走廊。
    for (const d of this._tilemap.doors || []) mark(d.x, d.y, d.x + 1, d.y + 1, 1);

    // 主要家具避障。目标坐席稍后会被强制放开，避免“走不到椅子/床上”。
    const st = this._seats;
    const blockRect = (x1, y1, x2, y2) => mark(x1, y1, x2, y2, 0);
    for (const ws of st.workstations || []) for (const [x,y] of ws.deskTiles || []) blockRect(x, y, x, y);
    for (const b of st.beds || []) for (const [x,y] of b.tiles || []) blockRect(x, y, x, y);
    const lp = st.loungeProps || {};
    if (lp.coffee_table) blockRect(lp.coffee_table.x1, lp.coffee_table.y1, lp.coffee_table.x2, lp.coffee_table.y2);
    if (lp.treadmill) blockRect(lp.treadmill.x1, lp.treadmill.y1, lp.treadmill.x2, lp.treadmill.y2);
    const wp = st.workspaceProps || {};
    if (wp.whiteboard) blockRect(wp.whiteboard.x1, wp.whiteboard.y1, wp.whiteboard.x2, wp.whiteboard.y2);
    if (wp.printer) blockRect(wp.printer.x1, wp.printer.y1, wp.printer.x2, wp.printer.y2);
    if (wp.filing_cabinet) blockRect(wp.filing_cabinet.x1, wp.filing_cabinet.y1, wp.filing_cabinet.x2, wp.filing_cabinet.y2);
    const bp = st.bedroomProps || {};
    if (bp.wardrobe) blockRect(bp.wardrobe.x1, bp.wardrobe.y1, bp.wardrobe.x2, bp.wardrobe.y2);

    // 所有最终坐/睡目标点强制可达。
    for (const ws of st.workstations || []) mark(ws.x, ws.y, ws.x, ws.y, 1);
    for (const b of st.beds || []) mark(b.x, b.y, b.x, b.y, 1);
    for (const s of st.loungeSeats || []) mark(s.x, s.y, s.x, s.y, 1);
    this._walkGrid = grid;
  },

  _isWalkable(x, y) {
    x = Math.round(x); y = Math.round(y);
    return !!(this._walkGrid && this._walkGrid[y] && this._walkGrid[y][x]);
  },

  _isReservedActorTile(x, y) {
    // 座位/床位是“可抵达的角色锚点”，但普通移动/多人事件不应站到这些实体锚点上。
    x = Math.round(x); y = Math.round(y);
    const same = (pt) => pt && Math.round(pt.x) === x && Math.round(pt.y) === y;
    const st = this._seats || {};
    return (st.workstations || []).some(same) || (st.beds || []).some(same) || (st.loungeSeats || []).some(same);
  },

  _hasStandingClearance(x, y) {
    // V21-M5 hotfix: Scene/persona 临时站立点要避开实体“视觉占用区”。
    // 桌子像素宽度会占据 desk tile 及左右相邻一点，站在同一排相邻 tile 会像踩在桌面上。
    x = Math.round(x); y = Math.round(y);
    const st = this._seats || {};
    for (const ws of st.workstations || []) {
      for (const [dx, dy] of ws.deskTiles || []) {
        if (y === Math.round(dy) && Math.abs(x - Math.round(dx)) <= 1) return false;
      }
      if (x === Math.round(ws.x) && y === Math.round(ws.y)) return false;
    }
    const lp = st.loungeProps || {};
    const inRect = (r) => r && x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
    if (inRect(lp.coffee_table) || inRect(lp.treadmill)) return false;
    return true;
  },

  _nearestWalkable(x, y, opts={}) {
    const ox = Number(x), oy = Number(y);
    x = Math.round(Number.isFinite(ox) ? ox : 0);
    y = Math.round(Number.isFinite(oy) ? oy : 0);
    const avoid = opts.avoid || null;
    const allowReserved = opts.allowReserved !== false;
    const ok = (xx, yy) => {
      const key = `${Math.round(xx)},${Math.round(yy)}`;
      if (avoid && avoid.has(key)) return false;
      if (!this._isWalkable(xx, yy)) return false;
      if (!allowReserved && this._isReservedActorTile(xx, yy)) return false;
      if (!allowReserved && !this._hasStandingClearance(xx, yy)) return false;
      return true;
    };
    if (ok(x, y)) return { x, y };
    let best = null;
    for (let r = 1; r <= 6; r++) {
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
        if (Math.abs(xx - x) + Math.abs(yy - y) > r || !ok(xx, yy)) continue;
        const score = Math.hypot(xx - ox, yy - oy) + Math.abs(xx - x) * 0.02 + Math.abs(yy - y) * 0.02;
        if (!best || score < best.score) best = { x: xx, y: yy, score };
      }
      if (best) return { x: best.x, y: best.y };
    }
    return { x, y };
  },

  _safeTarget(target, opts={}) {
    if (!target || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) return target;
    const pt = this._nearestWalkable(Number(target.x), Number(target.y), opts);
    return { ...target, x: pt.x, y: pt.y, rawX: target.rawX ?? target.x, rawY: target.rawY ?? target.y };
  },

  _findPath(start, goal) {
    const s = this._nearestWalkable(start.x, start.y);
    const g = this._nearestWalkable(goal.x, goal.y);
    const key = (p) => p.x + ',' + p.y;
    const h = (p) => Math.abs(p.x - g.x) + Math.abs(p.y - g.y);
    const open = [s], came = {}, gScore = { [key(s)]: 0 }, fScore = { [key(s)]: h(s) };
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (open.length) {
      open.sort((a,b) => (fScore[key(a)] ?? 9999) - (fScore[key(b)] ?? 9999));
      const cur = open.shift();
      const ck = key(cur);
      if (cur.x === g.x && cur.y === g.y) {
        const path = [cur];
        let k = ck;
        while (came[k]) { const p = came[k]; path.push(p); k = key(p); }
        return path.reverse();
      }
      for (const [dx,dy] of dirs) {
        const nb = { x: cur.x + dx, y: cur.y + dy };
        if (!this._isWalkable(nb.x, nb.y)) continue;
        const nk = key(nb);
        const tentative = (gScore[ck] ?? 9999) + 1;
        if (tentative < (gScore[nk] ?? 9999)) {
          came[nk] = cur;
          gScore[nk] = tentative;
          fScore[nk] = tentative + h(nb);
          if (!open.some(p => p.x === nb.x && p.y === nb.y)) open.push(nb);
        }
      }
    }
    return [s, g]; // 兜底：至少直线靠近，避免角色丢失
  },

  _syncActor(p, target, profiles) {
    // 最后一层兜底：除硬坐席/床位外，任何移动最终目标都吸附到附近可行走 tile，避免站到桌子/白板/沙发等实体上。
    target = this._safeTarget(target, { allowReserved: !!target.hard || ['sleep', 'sleep_bed', 'work', 'thinking', 'lounge'].includes(String(target.kind).split(':')[0]) });
    const name = p.profile || p.name || 'default';
    const targetKey = `${target.kind}:${target.x},${target.y}`;
    let a = this._actors[name];
    if (!a) {
      // 初次加载直接落位，避免页面刷新后所有人从左上角跑一遍。
      a = this._actors[name] = {
        name, x: target.x, y: target.y, tx: target.x, ty: target.y,
        targetKey, mode: 'idle', path: [], dir: target.facing || 'south',
        behavior: null, behaviorPhase: null, behaviorUntil: 0, cooldownUntil: 0,
        homeTarget: target.hard ? { ...target } : null,
        lastHardTarget: target.hard ? `${target.kind}:${target.x},${target.y}:${target.sceneState || ''}:${target.dataStatus || ''}` : null,
        failSafeUntil: 0, sceneState: target.sceneState || null, dataStatus: target.dataStatus || null,
        hidden: false,
        workMode: target.workMode || null,
        persona: null,
        personaCooldowns: {},
        nextPersonaAt: 0,
        recentPersonaTypes: [],
        sceneEventId: null,
        sceneRole: null,
        sceneTarget: null,
        scenePhrase: null,
      };
      this._scheduleNextPersona(a, target.workMode || 'offwork', true);
      return a;
    }
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) {
      a.x = target.x; a.y = target.y; a.tx = target.x; a.ty = target.y;
      a.path = []; a.mode = 'idle'; a.targetKey = targetKey;
      a.hidden = false; a.behavior = null; a.persona = null; a.sceneEventId = null; a.sceneRole = null; a.sceneTarget = null; a.scenePhrase = null;
      this._scheduleNextPersona(a, target.workMode || a.workMode || 'offwork', true);
    }
    if (target.hard) {
      const hardKey = `${target.kind}:${target.x},${target.y}:${target.sceneState || ''}:${target.dataStatus || ''}:${target.workMode || ''}`;
      // P0：后端硬状态/Scene State 变化立即打断软行为/场景事件，清 hidden，回新的 homeTarget。
      if (a.lastHardTarget && a.lastHardTarget !== hardKey) { this._releaseSceneEvent('data-change'); this._cancelPersona(a, target, 90); }
      a.lastHardTarget = hardKey;
      a.homeTarget = { ...target };
      a.sceneState = target.sceneState || null;
      a.dataStatus = target.dataStatus || null;
      a.workMode = target.workMode || null;
    }
    this._applyBehaviorFailSafe(a, target);
    if (a.targetKey !== targetKey) {
      const path = this._findPath({ x: Math.round(a.x), y: Math.round(a.y) }, { x: target.x, y: target.y });
      a.tx = target.x; a.ty = target.y; a.targetKey = targetKey;
      a.path = path.slice(1);
      a.mode = a.path.length ? 'walk' : 'idle';
    }
    return a;
  },

  _cancelBehavior(a, homeTarget, cooldown=180) {
    if (!a) return;
    a.behavior = null;
    a.persona = null;
    a.behaviorPhase = null;
    a.behaviorUntil = 0;
    a.hidden = false;
    a.cooldownUntil = Math.max(a.cooldownUntil || 0, this._frame + cooldown);
    this._scheduleNextPersona(a, a.workMode || homeTarget?.workMode || 'offwork', false);
    if (homeTarget) {
      a.homeTarget = { ...homeTarget };
      a.failSafeUntil = this._frame + 900;
    }
  },

  _applyBehaviorFailSafe(a, target) {
    if (!a) return;
    const b = a.behavior || a.persona;
    if (b && b.timeoutAt && this._frame > b.timeoutAt) {
      this._cancelBehavior(a, a.homeTarget || target, 240);
      return;
    }
    // 没有行为但长期 hidden，强制恢复，避免厕所淡出后永远消失。
    if (!b && a.hidden) a.hidden = false;
    // failSafe 到期还离 home 很远时，清空路径重回 homeTarget。
    if (!b && a.failSafeUntil && this._frame > a.failSafeUntil && a.homeTarget) {
      if (Math.hypot(a.x - a.homeTarget.x, a.y - a.homeTarget.y) > 0.5) {
        a.targetKey = '__failsafe__';
      }
      a.failSafeUntil = 0;
    }
  },

  _stepActor(a) {
    if (!a || !a.path || !a.path.length) { if (a) a.mode = 'idle'; return; }
    const n = a.path[0];
    const speed = 0.055; // tiles/frame，约 1.6 tile/s @30fps
    const dx = n.x - a.x, dy = n.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? 'east' : 'west';
    else if (Math.abs(dy) > 0.001) a.dir = dy > 0 ? 'south' : 'north';
    if (dist <= speed) {
      a.x = n.x; a.y = n.y; a.path.shift();
      if (!a.path.length) { a.x = a.tx; a.y = a.ty; a.mode = 'idle'; }
    } else {
      a.x += dx / dist * speed;
      a.y += dy / dist * speed;
      a.mode = 'walk';
    }
  },

  // ── M2/M3：动态角色层 ──
  _profileOrder() { return ['default', 'pm', 'tech', 'claude-code']; },

  _profileName(p) {
    // V21-M1: Inspector may pass a profile string while avatar drawing passes profile object.
    const raw = (typeof p === 'string') ? p : (p?.profile || p?.name || 'default');
    if (raw === 'default') return 'AI助手';
    if (raw === 'pm') return 'PM';
    if (raw === 'tech') return '研发经理';
    if (raw === 'claude-code') return 'CC研发';
    const cleaned = raw.replace(/^(agent-|profile-|sub-|child-)/i, '');
    return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : raw;
  },

  _profileColor(name) {
    if (this.COLORS[name]) return this.COLORS[name];
    if (!this._colorMap[name]) {
      const used = new Set(Object.values(this.COLORS).concat(Object.values(this._colorMap)));
      this._colorMap[name] = this.PALETTE.find(c => !used.has(c)) || this.PALETTE[Object.keys(this._colorMap).length % this.PALETTE.length];
    }
    return this._colorMap[name];
  },

  _profileIndex(name, profiles) {
    const fixed = this._profileOrder().indexOf(name);
    if (fixed >= 0) return fixed;
    const dynamic = profiles.map(p => p.profile || p.name).filter(n => !this._profileOrder().includes(n));
    return this._profileOrder().length + Math.max(0, dynamic.indexOf(name));
  },

  _statusOf(p) {
    const s = p?.status || 'idle';
    return ['working', 'thinking', 'sleeping', 'idle', 'error'].includes(s) ? s : 'idle';
  },

  // v20-M5：后端真实状态只派生 Work Gate；左侧表象由 Persona State 自主决定。
  _workModeFromData(p) {
    const s = this._statusOf(p);
    if (s === 'working' || s === 'thinking') return 'work';
    if (s === 'error') return 'error';
    return 'offwork';
  },

  // v20-M2：Data State（后端真实状态）与 Scene State（左侧场景演绎）分离。
  // 右侧服务器区仍显示真实 status；左侧 sleeping 仅在睡觉窗口表现为卧室上床。
  _sceneStateForProfile(p) {
    const status = this._statusOf(p);
    const sleepWindow = this._isSleepWindow();
    if (status === 'working') return 'work_sit';
    if (status === 'thinking') return 'work_think';
    if (status === 'sleeping') return sleepWindow ? 'sleep_bed' : 'lounge_idle';
    if (status === 'idle') return 'lounge_idle';
    if (status === 'error') return 'lounge_idle';
    return 'lounge_idle';
  },

  _targetForProfile(p, profiles) {
    const hard = this._hardTargetForProfile(p, profiles);
    return this._personaTargetForProfile(p, hard, profiles);
  },

  _hardTargetForProfile(p, profiles) {
    const name = p.profile || p.name || 'default';
    const idx = this._profileIndex(name, profiles);
    const st = this._seats;
    const status = this._statusOf(p);
    const mode = this._workModeFromData(p);
    const scene = this._sceneStateForProfile(p); // 兼容 M4 灯光/屏幕，不再作为 M5 行为主驱动。
    if (mode === 'work') {
      const ws = st.workstations[idx % st.workstations.length];
      const kind = status === 'thinking' ? 'thinking' : 'work';
      return { kind, workMode: mode, sceneState: scene, dataStatus: status, seat: ws, x: ws.x, y: ws.y, facing: ws.facing || 'south', hard: true };
    }
    if (mode === 'error') {
      const lounge = st.loungeSeats[idx % st.loungeSeats.length];
      return { kind: 'lounge', workMode: mode, sceneState: scene, dataStatus: status, seat: lounge, x: lounge.x, y: lounge.y, facing: lounge.facing || 'south', hard: true };
    }
    if (this._isSleepWindow()) {
      const bed = st.beds[idx % st.beds.length];
      return { kind: 'sleep', workMode: mode, sceneState: 'persona_offwork', dataStatus: status, seat: bed, x: bed.x, y: bed.y, facing: bed.facing || 'south', hard: true };
    }
    const lounge = st.loungeSeats[idx % st.loungeSeats.length];
    return { kind: 'lounge', workMode: mode, sceneState: 'persona_offwork', dataStatus: status, seat: lounge, x: lounge.x, y: lounge.y, facing: lounge.facing || 'south', hard: true };
  },

  _personaTargetForProfile(p, hard, profiles) {
    const name = p.profile || p.name || 'default';
    const a = this._actors[name];
    if (!a) return hard;

    const hardKey = `${hard.kind}:${hard.x},${hard.y}:${hard.sceneState || ''}:${hard.dataStatus || ''}:${hard.workMode || ''}`;
    if (a.lastHardTarget && a.lastHardTarget !== hardKey) this._cancelPersona(a, hard, 90);
    a.lastHardTarget = hardKey;
    a.homeTarget = { ...hard };
    a.sceneState = hard.sceneState || null;
    a.dataStatus = hard.dataStatus || null;
    a.workMode = hard.workMode || null;

    if (a.sceneEventId && a.sceneTarget) return { ...a.sceneTarget, kind: a.sceneTarget.kind || 'scene' };
    if (hard.workMode === 'error') { this._releaseSceneEvent('actor-error'); this._cancelPersona(a, hard, 240); return hard; }
    this._applyBehaviorFailSafe(a, hard);
    if (!a.persona && !a.behavior) this._maybeStartPersona(p, hard, profiles, a);
    const b = a.persona || a.behavior;
    if (!b) return hard;

    if (b.type === 'restroom') {
      const exit = { kind: 'restroom', x: 28, y: 16, facing: 'east', workMode: hard.workMode, dataStatus: hard.dataStatus };
      if (b.phase === 'exit' && Math.hypot(a.x - exit.x, a.y - exit.y) < 0.18) {
        b.phase = 'hidden'; b.until = this._frame + (b.hiddenHold || 900); a.hidden = true; a.path = [];
      }
      if (b.phase === 'hidden') {
        if (this._frame < b.until) return exit;
        b.phase = 'return'; a.hidden = false; a.x = exit.x; a.y = exit.y; a.path = []; a.targetKey = '__restroom_return__';
      }
      if (b.phase === 'return') {
        if (Math.hypot(a.x - hard.x, a.y - hard.y) < 0.18) this._finishPersona(a, hard);
        return { ...hard, kind: hard.kind + ':return' };
      }
      return exit;
    }

    if (b.type === 'corridor_pace') {
      const pts = (b.waypoints && b.waypoints.length) ? b.waypoints : [{x:10,y:11},{x:18,y:11},{x:12,y:12}];
      if (!Number.isInteger(b.wpIndex)) b.wpIndex = 0;
      const pt = pts[b.wpIndex % pts.length];
      if (Math.hypot(a.x - pt.x, a.y - pt.y) < 0.22) {
        b.wpIndex++;
        if (b.wpIndex >= Math.min(pts.length, 4)) { if (!b.until) b.until = this._frame + 50; }
      }
      if (b.until && this._frame >= b.until) this._finishPersona(a, hard);
      return (a.persona || a.behavior) ? { kind: 'corridor_pace', x: pt.x, y: pt.y, facing: b.facing || 'east', workMode: hard.workMode, dataStatus: hard.dataStatus } : hard;
    }

    const tgt = { kind: b.type, x: Number.isFinite(b.x) ? b.x : hard.x, y: Number.isFinite(b.y) ? b.y : hard.y, facing: b.facing || hard.facing || 'south', workMode: hard.workMode, dataStatus: hard.dataStatus };
    if (!Number.isFinite(tgt.x) || !Number.isFinite(tgt.y)) {
      this._cancelPersona(a, hard, 240);
      return hard;
    }
    if (Math.hypot(a.x - tgt.x, a.y - tgt.y) < 0.18) {
      if (!b.until) b.until = this._frame + (b.hold || 180);
      if (this._frame >= b.until) this._finishPersona(a, hard);
    }
    return (a.persona || a.behavior) ? tgt : hard;
  },

  _cancelPersona(a, homeTarget, cooldown=180) {
    if (!a) return;
    a.persona = null;
    this._cancelBehavior(a, homeTarget, cooldown);
  },

  _finishPersona(a, hard) {
    if (!a) return;
    const b = a.persona || a.behavior;
    const type = b?.type || b?.state;
    a.persona = null;
    a.behavior = null;
    a.behaviorPhase = null;
    a.behaviorUntil = 0;
    a.hidden = false;
    const mode = a.workMode || hard?.workMode || 'offwork';
    const finishCd = this._rules?.persona?.cooldowns?.finish || {};
    let cool = Number(finishCd[mode]) || (mode === 'work' ? 1500 : 1200);
    if (type && Number.isFinite(Number(finishCd[type]))) cool = Number(finishCd[type]);
    a.cooldownUntil = this._frame + cool + (this._hashName(a.name) % 900);
    if (type) {
      a.personaCooldowns = a.personaCooldowns || {};
      a.personaCooldowns[type] = this._frame + cool * 2;
      a.recentPersonaTypes = [type].concat(a.recentPersonaTypes || []).slice(0, 3);
    }
    this._scheduleNextPersona(a, mode, false);
  },

  _finishBehavior(a, hard) {
    if (!a) return;
    const b = a.behavior;
    a.behavior = null;
    a.behaviorPhase = null;
    a.behaviorUntil = 0;
    a.hidden = false;
    const status = a.dataStatus || hard?.dataStatus || 'idle';
    const base = hard?.kind || 'lounge';
    let cool = base === 'lounge' ? 1800 : 2700;
    if (status === 'thinking') cool = 1350;
    if (status === 'working') cool = 2400;
    a.cooldownUntil = this._frame + cool + ((this._hashName(a.name) % 900));
  },

  _hashName(name) {
    return Array.from(String(name || 'default')).reduce((h, ch) => (h * 33 + ch.charCodeAt(0)) >>> 0, 5381);
  },

  _initRandomSeed() {
    let extra = 0;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        extra = arr[0] >>> 0;
      } else {
        extra = Math.floor(Math.random() * 0xffffffff) >>> 0;
      }
    } catch (e) {
      extra = Math.floor(Math.random() * 0xffffffff) >>> 0;
    }
    this._sessionSeed = (Date.now() ^ extra ^ Math.floor(performance.now() * 1000)) >>> 0;
    this._randState = this._sessionSeed || 0x9e3779b9;
  },

  _rand() {
    // xorshift32: session-local random stream, good enough for visual scheduling.
    let x = (this._randState || this._sessionSeed || 0x9e3779b9) >>> 0;
    x ^= (x << 13); x >>>= 0;
    x ^= (x >>> 17); x >>>= 0;
    x ^= (x << 5); x >>>= 0;
    this._randState = x >>> 0;
    return (this._randState >>> 0) / 4294967296;
  },

  _randInt(min, max) {
    min = Math.ceil(min); max = Math.floor(max);
    if (max <= min) return min;
    return min + Math.floor(this._rand() * (max - min + 1));
  },

  _scheduleNextPersona(a, mode='offwork', initial=false) {
    if (!a) return;
    if (mode === 'error') { a.nextPersonaAt = Infinity; return; }
    const night = this._isSleepWindow();
    const section = initial ? 'initial' : 'next';
    const key = mode === 'work' ? 'work' : (night ? 'offwork_night' : 'offwork_day');
    const fb = initial ? (mode === 'work' ? [120,720] : (night ? [360,1200] : [180,900])) : (mode === 'work' ? [900,1800] : (night ? [1200,2400] : [700,1700]));
    const [min, max] = this._rangeFromRule(['persona','scheduler',section,key], fb);
    const jitterMod = Math.max(1, this._ruleNumber(['persona','scheduler','actor_jitter_mod'], 180));
    const actorJitter = this._hashName(a.name) % jitterMod;
    a.nextPersonaAt = this._frame + this._randInt(min, max) + actorJitter;
  },

  _startBehavior(a, spec, timeoutFrames=1800) {
    a.behavior = { ...spec, startedAt: this._frame, timeoutAt: this._frame + timeoutFrames };
    a.behaviorPhase = spec.phase || spec.type;
    a.behaviorUntil = 0;
  },

  _weightedChoice(options) {
    const usable = (options || []).filter(o => (o.weight || 0) > 0);
    const total = usable.reduce((n, o) => n + o.weight, 0);
    if (!usable.length || total <= 0) return null;
    let r = this._rand() * total;
    for (const o of usable) {
      r -= o.weight;
      if (r < 0) return o;
    }
    return usable[usable.length - 1];
  },

  _maybeStartPersona(p, hard, profiles, a) {
    if (a.persona || a.behavior || a.mode === 'walk' || a.hidden || this._frame < (a.cooldownUntil || 0)) return;
    const name = p.profile || p.name || 'default';
    const mode = hard.workMode || this._workModeFromData(p);
    // V21-M5 热修：睡觉窗口内，status=sleeping 的人不触发新行为（除非被叫醒）。
    const status = this._statusOf(p);
    if (this._isSleepWindow() && status === 'sleeping') return;
    if (!Number.isFinite(a.nextPersonaAt || 0)) this._scheduleNextPersona(a, mode, true);
    if (!a.nextPersonaAt) this._scheduleNextPersona(a, mode, true);
    if (this._frame < (a.nextPersonaAt || 0)) return;

    const options = this._personaOptionsFromRules(name, mode, hard, profiles, a);
    const choice = this._weightedChoice(options);
    if (!choice) { this._scheduleNextPersona(a, mode, false); return; }

    const global = this._globalEventCooldowns || (this._globalEventCooldowns = {});
    const globalCd = this._rules?.persona?.cooldowns?.global || {};
    if (choice.type === 'phone') global.phone = this._frame + (Number(globalCd.phone) || 2400);
    if (choice.type === 'restroom') global.restroom = this._frame + (Number(globalCd.restroom) || 3000);

    const timeout = Number(choice.timeout) || (choice.type === 'restroom' ? 1800 : (choice.type === 'sleep_bed' ? 2400 : 1500));
    a.persona = { ...choice, state: choice.type, mode, startedAt: this._frame, timeoutAt: this._frame + timeout, returnTarget: { ...hard }, interruptible: true, reason: 'v21-m4-rule-config' };
    a.behavior = a.persona; // 兼容 M4 绘制函数，右侧不读取此字段。
    a.behaviorPhase = choice.phase || choice.type;
    a.behaviorUntil = 0;
  },

  _maybeStartBehavior(p, hard, profiles, a) {
    // M5 兼容入口：旧调用统一转入 Persona State。
    return this._maybeStartPersona(p, hard, profiles, a);
  },

  // ── V21-M3：Scene Event Scheduler（多人事件必须有对象） ──
  _scheduleNextSceneEvent(initial=false) {
    const key = initial ? 'initial' : 'next';
    const fb = initial ? [240, 900] : [1200, 2600];
    const [min, max] = this._rangeFromRule(['sceneEvents','scheduler',key], fb);
    this._nextSceneEventAt = this._frame + this._randInt(min, max);
  },

  _tickSceneEvent(profiles) {
    if (!this._nextSceneEventAt) this._scheduleNextSceneEvent(true);
    if (this._sceneEvent) {
      this._updateSceneEvent(profiles);
      return;
    }
    if (this._frame >= this._nextSceneEventAt) this._maybeStartSceneEvent(profiles);
  },

  _sceneAvailableProfiles(profiles, preferWork=false) {
    return (profiles || []).filter(p => {
      const name = p.profile || p.name || 'default';
      const a = this._actors[name];
      if (!a || a.hidden || a.sceneEventId || a.mode === 'walk') return false;
      const status = this._statusOf(p);
      if (status === 'error') return false;
      const mode = this._workModeFromData(p);
      if (preferWork && mode !== 'work') return false;
      const b = a.persona || a.behavior;
      if (b && b.type === 'restroom') return false;
      // V21-M5 热修：睡觉窗口内，status=sleeping 的人不参与多人事件，除非被叫醒（work/thinking）。
      const s = this._statusOf(p);
      if (this._isSleepWindow() && s === 'sleeping') return false;
      if (this._isSleepWindow() && mode !== 'work') return false;
      return Number.isFinite(a.x) && Number.isFinite(a.y);
    });
  },

  _maybeStartSceneEvent(profiles, forcedType=null) {
    const now = this._frame;
    const cd = this._sceneEventCooldowns || (this._sceneEventCooldowns = {});
    const all = this._sceneAvailableProfiles(profiles, false);
    const work = this._sceneAvailableProfiles(profiles, true);
    const rules = this._sceneEventRules();
    const candidates = [];
    const addCandidate = (rule) => {
      if (!rule || !rule.type || now < (cd[rule.type] || 0)) return;
      const w = rule.when || {};
      if (w.notSleepWindow && this._isSleepWindow()) return;
      if (Number.isFinite(Number(w.workCountAtLeast)) && work.length < Number(w.workCountAtLeast)) return;
      if (Number.isFinite(Number(w.allCountAtLeast)) && all.length < Number(w.allCountAtLeast)) return;
      const participants = this._sceneParticipantsFromRule(rule, all, work);
      const names = new Set(participants.map(p => p.profile || p.name));
      const weight = Number(rule.weight) || 0;
      if (participants.length >= 2 && names.size >= 2 && weight > 0) candidates.push({ type: rule.type, participants: participants.slice(0, 2), weight });
    };
    const events = Array.isArray(rules.events) ? rules.events : [];
    for (const rule of events) addCandidate(rule);
    // Safe fallback if rules are missing: keep M3's proven candidate set.
    if (!candidates.length && !events.length) {
      const byName = (n) => all.find(p => (p.profile || p.name) === n);
      const pushPair = (type, parts, weight) => {
        const uniq = (parts || []).filter(Boolean);
        const names = new Set(uniq.map(p => p.profile || p.name));
        if (uniq.length >= 2 && names.size >= 2 && now >= (cd[type] || 0)) candidates.push({ type, participants: uniq.slice(0, 2), weight });
      };
      const pm = byName('pm'), tech = byName('tech'), def = byName('default'), cc = byName('claude-code');
      pushPair('review_pair', [pm, tech], 18);
      pushPair('debug_pair', [tech, def], 14);
      pushPair('sync_pair', [pm, def || tech || cc], 16);
      // V22: CC研发（claude-code）参与联合事件
      pushPair('cc_review', [cc, tech], 17);         // CC + tech 代码评审
      pushPair('cc_sync', [cc, pm], 15);              // CC + PM 同步对齐
      pushPair('cc_debug', [cc, def || tech], 13);    // CC + default/tech 调bug
      if (work.length >= 2) pushPair('whiteboard_pair', work.slice(0, 2), 12);
      if (!this._isSleepWindow() && all.length >= 2) pushPair('chat_pair', all.slice(0, 2), 10);
    }
    if (forcedType) {
      const forced = candidates.find(c => c.type === forcedType) || candidates[0];
      if (forced) return this._startSceneEvent(forced.type, forced.participants);
      return null;
    }
    const choice = this._weightedChoice(candidates);
    if (!choice) { this._scheduleNextSceneEvent(false); return null; }
    return this._startSceneEvent(choice.type, choice.participants);
  },

  _sceneParticipantsFromRule(rule, all, work) {
    const spec = rule?.participants || {};
    const byName = (n) => all.find(p => (p.profile || p.name) === n);
    let parts = [];
    if (Array.isArray(spec.names)) parts = spec.names.map(byName).filter(Boolean);
    if (parts.length < 2 && Array.isArray(spec.fallbackNames)) parts = spec.fallbackNames.map(byName).filter(Boolean);
    if (parts.length < 2 && spec.from) {
      const source = spec.from === 'work' ? work : all;
      const count = Math.max(2, Number(spec.count) || 2);
      parts = source.slice(0, count);
    }
    const seen = new Set();
    return parts.filter(p => { const n = p && (p.profile || p.name); if (!n || seen.has(n)) return false; seen.add(n); return true; });
  },

  _sceneLayout(type, participants) {
    const layoutRule = this._sceneEventRules()?.layouts?.[type] || {};
    const center = layoutRule.center || ((type === 'chat_pair') ? { x: 14.5, y: 6.5 } : { x: 24, y: 5 });
    const offsets = Array.isArray(layoutRule.offsets) && layoutRule.offsets.length ? layoutRule.offsets : (participants.length >= 3 ? [[-1,1],[1,1],[0,2]] : [[-0.8,1],[0.8,1]]);
    const phrases = Array.isArray(layoutRule.phrases) && layoutRule.phrases.length ? layoutRule.phrases : ['同步', 'OK'];
    const avoid = new Set();
    return participants.map((p, i) => {
      const off = offsets[i % offsets.length] || [0, 1];
      const raw = { x: Number(center.x) + Number(off[0] || 0), y: Number(center.y) + Number(off[1] || 0) };
      const safe = this._safeTarget({ kind: type, x: raw.x, y: raw.y, facing: i % 2 ? 'west' : 'east', scene: true }, { allowReserved: false, avoid });
      avoid.add(`${Math.round(safe.x)},${Math.round(safe.y)}`);
      return {
        profile: p.profile || p.name || 'default',
        target: safe,
        role: i === 0 ? 'lead' : 'peer',
        phrase: phrases[i % phrases.length]
      };
    });
  },

  _startSceneEvent(type, participants) {
    if (!participants || participants.length < 2) return null;
    const id = `scene-${++this._sceneEventSeq}`;
    const layout = this._sceneLayout(type, participants);
    const event = {
      id, type,
      participants: layout.map(x => x.profile),
      phase: 'gather',
      startedAt: this._frame,
      interactAt: 0,
      timeoutAt: this._frame + this._ruleNumber(['sceneEvents','scheduler','timeout'], 2200),
      releaseAt: 0,
      layout
    };
    for (const item of layout) {
      const a = this._actors[item.profile];
      if (!a) continue;
      this._cancelPersona(a, a.homeTarget, 90);
      a.sceneEventId = id;
      a.sceneRole = item.role;
      a.sceneTarget = item.target;
      a.scenePhrase = item.phrase;
      a.targetKey = '__scene_start__';
      a.hidden = false;
    }
    this._sceneEvent = event;
    return event;
  },

  _updateSceneEvent(profiles) {
    const ev = this._sceneEvent;
    if (!ev) return;
    const invalid = ev.participants.some(name => {
      const p = (profiles || []).find(x => (x.profile || x.name) === name);
      const a = this._actors[name];
      return !p || !a || this._statusOf(p) === 'error' || (this._isSleepWindow() && this._workModeFromData(p) !== 'work');
    });
    if (invalid || this._frame > ev.timeoutAt) { this._releaseSceneEvent(invalid ? 'invalid' : 'timeout'); return; }
    const arrived = ev.participants.every(name => {
      const a = this._actors[name], t = a?.sceneTarget;
      return a && t && Math.hypot(a.x - t.x, a.y - t.y) < 0.28;
    });
    if (ev.phase === 'gather' && arrived) {
      ev.phase = 'interact';
      ev.interactAt = this._frame;
      const [holdMin, holdMax] = this._rangeFromRule(['sceneEvents','scheduler','interactHold'], [360, 760]);
      ev.releaseAt = this._frame + this._randInt(holdMin, holdMax);
    }
    if (ev.phase === 'interact' && this._frame >= ev.releaseAt) this._releaseSceneEvent('done');
  },

  _releaseSceneEvent(reason='done') {
    const ev = this._sceneEvent;
    if (!ev) return;
    const cd = this._sceneEventCooldowns || (this._sceneEventCooldowns = {});
    cd[ev.type] = this._frame + this._ruleNumber(['sceneEvents','scheduler','cooldown'], 3600);
    for (const name of ev.participants || []) {
      const a = this._actors[name];
      if (!a) continue;
      a.sceneEventId = null;
      a.sceneRole = null;
      a.sceneTarget = null;
      a.scenePhrase = null;
      a.targetKey = '__scene_release__';
      a.cooldownUntil = Math.max(a.cooldownUntil || 0, this._frame + 360);
      this._scheduleNextPersona(a, a.workMode || 'offwork', false);
    }
    this._sceneEvent = null;
    this._scheduleNextSceneEvent(false);
  },

  _drawProfiles(ctx) {
    const profiles = (this._data && this._data.profiles) ? this._data.profiles : [];
    this._hitboxes = [];
    if (!profiles.length || !this._seats) return;
    this._tickSceneEvent(profiles);
    const items = [];
    for (const p of profiles) {
      const target = this._targetForProfile(p, profiles);
      const actor = this._syncActor(p, target, profiles);
      this._stepActor(actor);
      items.push({ p, target, actor });
    }
    // y 排序，移动过程中也按当前 y 排序。
    items.sort((a, b) => (a.actor.y - b.actor.y) || (a.actor.x - b.actor.x));
    for (const it of items) this._drawProfileActor(ctx, it.p, it.target, it.actor);
  },

  _drawProfileActor(ctx, p, target, actor) {
    const name = p.profile || p.name || 'default';
    const color = this._profileColor(name);
    const cx = actor.x * this.TILE + this.TILE / 2;
    const cy = actor.y * this.TILE + this.TILE / 2;
    if (actor.hidden) return;
    const baseKind = String(target.kind).split(':')[0];
    if (actor.mode === 'walk') this._drawWalkingAvatar(ctx, cx, cy, color, name, p, actor.dir || 'south');
    else if (baseKind === 'sleep' || baseKind === 'sleep_bed') this._drawSleepingAvatar(ctx, cx, cy, color, name, p);
    else this._drawSittingAvatar(ctx, cx, cy, color, name, p, baseKind);
    this._recordHitbox(name, p, actor, target, cx, cy, color);
    this._drawSelectionHalo(ctx, cx, cy, name, color);
    this._drawBehaviorEffect(ctx, cx, cy, actor, p, baseKind);
  },

  _recordHitbox(name, p, actor, target, cx, cy, color) {
    const cam = this._camera || { scale: 1, dx: 0, dy: 0 };
    const scale = cam.scale || 1;
    const sx = cam.dx + cx * scale;
    const sy = cam.dy + cy * scale;
    const w = 34 * scale;
    const h = 52 * scale;
    this._hitboxes.push({
      profile: name,
      x: sx - w / 2,
      y: sy - h * 0.72,
      w, h,
      screenX: sx,
      screenY: sy,
      actor,
      target,
      data: p,
      color
    });
  },

  _drawSelectionHalo(ctx, cx, cy, name, color) {
    if (name !== this._selectedProfile && name !== this._hoverProfile) return;
    const f = this._frame || 0;
    const selected = name === this._selectedProfile;
    ctx.save();
    ctx.globalAlpha = selected ? 0.55 + 0.20 * Math.sin(f / 12) : 0.30;
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 9, selected ? 21 : 17, selected ? 8 : 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  _drawInspector(ctx, viewW, viewH) {
    const profile = this._selectedProfile || this._hoverProfile;
    if (this._debugInspector) this._drawDebugOverlay(ctx);
    if (!profile) return;
    const hit = this._hitboxes.find(h => h.profile === profile);
    const p = hit?.data || this._profileByName(profile);
    const a = hit?.actor || this._actors[profile];
    const t = hit?.target || a?.homeTarget;
    if (!p || !a) return;
    const color = this._profileColor(profile);
    const lines = this._inspectorLines(profile, p, a, t);
    const anchorX = hit ? hit.screenX : (viewW * 0.5);
    const anchorY = hit ? hit.y : 80;
    this._drawInspectorTooltip(ctx, anchorX, anchorY, lines, color, viewW, viewH, !!this._selectedProfile);
  },

  _inspectorLines(profile, p, a, t) {
    const status = this._statusOf(p);
    const model = p?.metadata?.model || 'unknown';
    const persona = (a.persona || a.behavior);
    const targetText = t ? `${t.kind || '?'} ${Number(t.x).toFixed(1)},${Number(t.y).toFixed(1)}` : 'N/A';
    const posText = `${Number(a.x).toFixed(1)},${Number(a.y).toFixed(1)}`;
    const last = p?.last_active || p?.last_updated || 'N/A';
    const nextPersona = Number.isFinite(a.nextPersonaAt) ? Math.max(0, Math.round(a.nextPersonaAt - this._frame)) : 'N/A';
    const cooldown = Math.max(0, Math.round((a.cooldownUntil || 0) - this._frame));
    const lines = [
      { text: `${this._profileName(profile)} / ${profile}`, strong: true },
      { text: `真实状态：${status}` },
      { text: `工作模式：${a.workMode || this._workModeFromData(p)}` },
      { text: `位置：${posText}` },
      { text: `目标：${targetText}` },
      { text: `表象：${persona?.type || persona?.state || 'idle'}` },
    ];

    // V22-M2: Active scene events — human-readable EVENTS section
    const ev = this._sceneEvent;
    if (ev && ev.participants && ev.participants.length >= 2) {
      const actorNames = ev.participants.map(n => this._profileName(n) || n);
      const label = this._sceneEventLabel(ev.type);
      const dot = ev.phase === 'interact' ? '🟢' : '🟡';
      const startedMin = Math.round((this._frame - ev.startedAt) / 60);
      lines.push({ text: `${dot} 事件: ${actorNames.join(' ↔ ')} ${label} (${startedMin}m)` });
    } else {
      lines.push({ text: '⚪ 事件: 无' });
    }

    if (this._debugInspector) {
      lines.push({ text: `规则：${this._rules?.version || 'unknown'}` });
      lines.push({ text: `reason：${persona?.reason || '-'}` });
      lines.push({ text: `scene：${a.scenePhrase || '-'} / next=${nextPersona} cd=${cooldown}` });
    }
    lines.push({ text: `模型：${model}` });
    lines.push({ text: `最近活跃：${String(last).slice(0, 19)}` });

    // V22-M3: "正在" behavior line
    lines.push({ text: `正在: ${this._behaviorLabel(a, p)}` });

    // CC研发专用指标卡（hover/选中时显示）
    if (profile === 'claude-code') {
      const mt = this._serverMetrics?.profiles?.find(m => m.profile === 'claude-code');
      if (mt) {
        const fmtK = (n) => { n = Number(n || 0); return n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n); };
        lines.push({ text: `───────` });
        lines.push({ text: `今日消耗  ${fmtK(mt.today_tokens)}`, strong: true });
        lines.push({ text: `输入/输出  ${fmtK(mt.today_input_tokens)} / ${fmtK(mt.today_output_tokens)}` });
        lines.push({ text: `活跃时长  ${Math.round(Number(mt.active_minutes_today || 0))} 分钟` });
        lines.push({ text: `───────` });
      }
    }

    return lines;
  },

  // V22-M3: Map persona/behavior type to human-readable action description
  _behaviorLabel(a, p) {
    const b = a.persona || a.behavior;
    if (!b || !b.type) return '发呆中';
    const type = b.type;
    const map = {
      water:          '去接水',
      phone:          '看手机',
      coffee:         '冲咖啡',
      restroom:       '洗手间中',
      thinking:       '思考中',
      thinking_plan:  '规划中',
      rest:           '休息中',
      stretch:        '伸懒腰',
      whiteboard:     '白板协作',
      window:         '窗边放空',
      read_doc:       '看文档',
      search_idle:    '检索中',
      corridor_pace:  '走廊踱步',
      corridor_walk:  '走动中',
      micro_nap:      '小憩中',
      sofa_nap:       '沙发休息',
      overtime_walk:  '加班踱步',
      sleep:          '睡觉中',
      coding:         '写代码',
      chat:           '聊天中',
    };
    return map[type] || b.state || b.type || '发呆中';
  },

  _drawInspectorTooltip(ctx, anchorX, anchorY, lines, color, viewW, viewH, locked=false) {
    ctx.save();
    const pad = 9;
    const lineH = 15;
    ctx.font = '11px sans-serif';
    const width = Math.min(245, Math.max(168, ...lines.map(l => ctx.measureText(l.text).width + pad * 2)));
    const height = pad * 2 + lineH * lines.length;
    let x = anchorX + 16;
    let y = anchorY - height - 8;
    if (x + width > viewW - 8) x = anchorX - width - 16;
    if (x < 8) x = 8;
    if (y < 48) y = Math.min(viewH - height - 8, anchorY + 18);
    const r = 10;
    const g = ctx.createLinearGradient(x, y, x, y + height);
    g.addColorStop(0, 'rgba(16,22,39,0.88)');
    g.addColorStop(1, 'rgba(7,10,20,0.78)');
    ctx.fillStyle = g;
    ctx.strokeStyle = locked ? color : 'rgba(160,190,220,0.34)';
    ctx.lineWidth = locked ? 1.4 : 1;
    this._roundRect(ctx, x, y, width, height, r, true, true);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x + width - 28, y + 18, 24, 8, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    lines.forEach((line, i) => {
      ctx.font = line.strong ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.fillStyle = line.strong ? color : '#d8e0f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(line.text, x + pad, y + pad + i * lineH);
    });
    ctx.restore();
  },

  _drawDebugOverlay(ctx) {
    const cam = this._camera || { scale: 1, dx: 0, dy: 0 };
    ctx.save();
    ctx.font = '10px Courier, monospace';
    ctx.textBaseline = 'top';
    for (const h of this._hitboxes) {
      const a = h.actor, t = h.target || {};
      ctx.strokeStyle = h.profile === this._selectedProfile ? h.color : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x, h.y, h.w, h.h);
      ctx.fillStyle = h.color;
      const next = Number.isFinite(a?.nextPersonaAt) ? Math.max(0, Math.round(a.nextPersonaAt - this._frame)) : '-';
      ctx.fillText(`${h.profile} ${a?.workMode || ''} ${a?.persona?.type || a?.behavior?.type || 'idle'} n=${next}`, h.x, h.y - 12);
      if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) {
        const tx = cam.dx + (t.x * this.TILE + this.TILE / 2) * cam.scale;
        const ty = cam.dy + (t.y * this.TILE + this.TILE / 2) * cam.scale;
        ctx.strokeStyle = 'rgba(255,220,80,0.45)';
        ctx.beginPath(); ctx.moveTo(h.screenX, h.screenY); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = 'rgba(255,220,80,0.75)';
        ctx.fillRect(tx - 2, ty - 2, 4, 4);
      }
      const path = a?.path || [];
      if (path.length > 1) {
        ctx.strokeStyle = 'rgba(0,245,212,0.35)';
        ctx.beginPath();
        path.forEach((pt, i) => {
          const px = cam.dx + (pt.x * this.TILE + this.TILE / 2) * cam.scale;
          const py = cam.dy + (pt.y * this.TILE + this.TILE / 2) * cam.scale;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
    }
    const ev = this._sceneEvent;
    const selected = this._selectedProfile ? this._actors[this._selectedProfile] : null;
    const persona = selected ? (selected.persona || selected.behavior) : null;
    const lines = [
      `M5 Rule Inspector  rules=${this._rules?.version || 'unknown'} frame=${this._frame}`,
      `phase=${this._timePhase().key} sleep=${this._isSleepWindow()} hitboxes=${this._hitboxes.length} selected=${this._selectedProfile || '-'}`,
      `scene=${ev ? `${ev.type}/${ev.phase}/${(ev.participants||[]).join('+')}` : '-'} nextScene=${Math.max(0, Math.round((this._nextSceneEventAt || 0) - this._frame))}`,
      `persona=${persona?.type || persona?.state || '-'} nextPersona=${selected && Number.isFinite(selected.nextPersonaAt) ? Math.max(0, Math.round(selected.nextPersonaAt - this._frame)) : '-'} cd=${selected ? Math.max(0, Math.round((selected.cooldownUntil || 0) - this._frame)) : '-'}`,
      `last=${this._debugLastAction ? `${this._debugLastAction.action}:${this._debugLastAction.ok ? 'ok' : this._debugLastAction.reason}` : '-'} cmd: forceSceneEvent()/forcePersona()/clearDebugEvent()`
    ];
    ctx.fillStyle = 'rgba(5,8,16,0.66)';
    this._roundRect(ctx, 10, 48, 430, 82, 10, true, false);
    ctx.fillStyle = '#00f5d4';
    lines.forEach((line, i) => ctx.fillText(line, 18, 56 + i * 14));
    ctx.restore();
  },

  _roundRect(ctx, x, y, w, h, r, fill=true, stroke=false) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  },

  // ── M4：昼夜、灯光、行为效果 ──
  _cnHour() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = t => Number((parts.find(p => p.type === t) || {}).value || 0);
    return get('hour') + get('minute') / 60;
  },

  _timePhase() {
    const h = Number.isFinite(this._debugHour) ? this._debugHour : this._cnHour();
    if (h >= 6 && h < 8) return { key: 'dawn', color: '#ffd4a0', alpha: 0.30, label: '黎明' };
    if (h >= 8 && h < 17) return { key: 'day', color: '#ffffff', alpha: 0.00, label: '白天' };
    if (h >= 17 && h < 19) return { key: 'dusk', color: '#ff8060', alpha: 0.25, label: '黄昏' };
    if (h >= 19 && h < 22) return { key: 'evening', color: '#4060a0', alpha: 0.20, label: '傍晚' };
    return { key: 'night', color: '#1a2050', alpha: 0.50, label: '深夜' };
  },

  // v20-M6 sleep-window tuning: 人物进入卧室/上床睡觉的时间窗口独立于视觉昼夜相位。
  // 视觉上 19:00~22:00 仍可显示“傍晚”，但人物 offwork 从 21:00 起即可回卧室睡觉，直到次日 08:00。
  _isSleepWindow() {
    const h = Number.isFinite(this._debugHour) ? this._debugHour : this._cnHour();
    return h >= 21 || h < 8;
  },

  _drawDynamicWindows(ctx, phase) {
    const T = this.TILE;
    const sky = phase.key === 'day' ? '#5a8aa8' : phase.key === 'dawn' ? '#d98a68' : phase.key === 'dusk' ? '#b85068' : phase.key === 'evening' ? '#25355f' : '#101838';
    for (const w of this._tilemap.windows || []) {
      const x = w.x1 * T, y = w.y1 * T + 6;
      const ww = (w.x2 - w.x1 + 1) * T;
      this._px(ctx, x+7, y+3, ww-14, 10, sky);
      if (phase.key === 'night') {
        ctx.fillStyle = '#f8e7a0';
        for (let i=0; i<3; i++) ctx.fillRect(x + 18 + i*22, y + 5 + (i%2)*3, 2, 2);
        ctx.fillRect(x + ww - 26, y + 4, 5, 5);
      } else {
        this._px(ctx, x+16, y+6, 14, 3, '#d8f0ff');
        this._px(ctx, x+44, y+4, 10, 2, '#c8e8ff');
      }
    }
  },

  _drawLights(ctx, profiles, phase) {
    const T = this.TILE, st = this._seats;
    const evening = phase.key === 'evening', night = phase.key === 'night';
    const glow = (x, y, r, color) => {
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(255,220,90,0)');
      ctx.fillStyle = g; ctx.fillRect(x-r, y-r, r*2, r*2);
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const activeAt = new Map();
    for (const p of profiles || []) {
      const hard = this._hardTargetForProfile(p, profiles);
      activeAt.set(`${hard.x},${hard.y}`, { p, hard });
    }
    for (const ws of st.workstations || []) {
      const hit = activeAt.get(`${ws.x},${ws.y}`);
      const status = this._statusOf(hit?.p);
      const on = !!hit && (status === 'working' || status === 'thinking') && (evening || night || status === 'working');
      if (on) { this._drawLamp(ctx, ws.lampTile[0], ws.lampTile[1], true); glow((ws.lampTile[0]+0.5)*T, (ws.lampTile[1]+0.8)*T, night ? 62 : 42, 'rgba(255,220,100,0.36)'); }
    }
    if (evening || night) {
      glow(15*T, 16.5*T, 160, evening ? 'rgba(255,220,120,0.18)' : 'rgba(120,150,255,0.10)');
      glow(14*T, 6*T, 110, evening ? 'rgba(255,190,120,0.16)' : 'rgba(255,220,130,0.08)');
    }
    if (night) {
      for (const b of st.beds || []) if (activeAt.get(`${b.x},${b.y}`)) { this._drawLamp(ctx, b.lampTile[0], b.lampTile[1], true); glow((b.lampTile[0]+0.5)*T, (b.lampTile[1]+0.8)*T, 44, 'rgba(255,210,120,0.18)'); }
    }
    ctx.restore();
  },

  // v20-M4：按角色绘制工位屏幕内容。只覆盖屏幕内区域，不改静态家具结构。
  _drawActiveWorkstationScreens(ctx, profiles) {
    const st = this._seats;
    if (!st) return;
    for (const p of profiles || []) {
      const hard = this._hardTargetForProfile(p, profiles);
      if (hard.kind !== 'work' && hard.kind !== 'thinking') continue;
      const ws = hard.seat;
      if (!ws || !ws.deskTiles) continue;
      this._drawProfileScreen(ctx, ws, p, hard.kind);
    }
  },

  _drawProfileScreen(ctx, ws, p, kind) {
    const T = this.TILE;
    const name = p.profile || p.name || 'default';
    const xs = ws.deskTiles.map(t => t[0]), ys = ws.deskTiles.map(t => t[1]);
    const x1 = Math.min(...xs), y1 = Math.min(...ys);
    const screenX = x1*T + 11, screenY = y1*T + 8;
    const screenW = Math.max(10, Math.min(28, ws.deskTiles.length*T - 22));
    const screenH = 8;
    const f = this._frame;
    ctx.save();
    ctx.beginPath(); ctx.rect(screenX, screenY, screenW, screenH); ctx.clip();
    ctx.fillStyle = kind === 'thinking' ? '#152542' : '#06313a';
    ctx.fillRect(screenX, screenY, screenW, screenH);
    if (name === 'pm') {
      ctx.fillStyle = '#ff8ab8'; ctx.fillRect(screenX+2, screenY+1, 9, 1);
      ctx.fillStyle = '#ffd0e0';
      for (let i=0; i<3; i++) ctx.fillRect(screenX+2, screenY+3+i*2, Math.min(screenW-4, 14 + (i%2)*5), 1);
      ctx.fillStyle = '#ff6b9d'; ctx.fillRect(screenX+screenW-7, screenY+2, 4, 4);
    } else if (name === 'tech') {
      ctx.fillStyle = '#00f5d4';
      for (let i=0; i<4; i++) {
        const w = kind === 'thinking' ? 10 + (i%2)*4 : 9 + ((f/8 + i*3) % 14);
        ctx.fillRect(screenX+2, screenY+1+i*2, Math.min(screenW-4, w), 1);
      }
      ctx.fillStyle = '#8affea'; if ((f % 50) < 25) ctx.fillRect(screenX+screenW-4, screenY+screenH-2, 2, 1);
    } else {
      ctx.fillStyle = '#7dd3fc'; ctx.fillRect(screenX+3, screenY+2, Math.max(4, screenW-8), 2);
      ctx.fillStyle = '#d8f3ff'; ctx.fillRect(screenX+5, screenY+3, 2, 1);
      ctx.fillStyle = '#a78bfa';
      for (let i=0; i<3; i++) if (((f/20|0)+i) % 3 !== 0) ctx.fillRect(screenX+4+i*6, screenY+6, 3, 1);
    }
    if (kind === 'thinking') {
      ctx.fillStyle = (f % 60) < 30 ? '#e8f4ff' : '#4b6f78';
      ctx.fillRect(screenX + screenW - 3, screenY + screenH - 2, 2, 1);
    }
    ctx.restore();
  },

  // v20-M4：让白板、咖啡机、饮水机、沙发区有“被使用”的动态细节。
  _drawSceneActivityDetails(ctx) {
    const st = this._seats, T = this.TILE, f = this._frame;
    if (!st) return;
    const activeBehaviors = Object.values(this._actors || {}).map(a => a.persona || a.behavior).filter(Boolean);

    if (activeBehaviors.some(b => b.type === 'whiteboard')) {
      const wb = st.workspaceProps.whiteboard;
      const x = wb.x1*T, y = wb.y1*T;
      ctx.strokeStyle = '#00f5d4'; ctx.lineWidth = 1;
      ctx.strokeRect(x+10, y+48, 16, 10); ctx.strokeRect(x+34, y+48, 16, 10); ctx.strokeRect(x+22, y+64, 18, 9);
      ctx.beginPath(); ctx.moveTo(x+26, y+53); ctx.lineTo(x+34, y+53); ctx.moveTo(x+30, y+58); ctx.lineTo(x+31, y+64); ctx.stroke();
      ctx.fillStyle = '#ff6b9d'; ctx.fillRect(x+12+(f%20<10?1:0), y+73, 34, 2);
    }

    const cm = st.loungeProps.coffee_machine;
    if (activeBehaviors.some(b => b.type === 'coffee') || (f % 240) < 80) {
      ctx.fillStyle = 'rgba(240,224,192,0.72)';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('~', cm.x*T + 13, cm.y*T + 2 - (f%30)/10);
      ctx.fillText('~', cm.x*T + 20, cm.y*T + 5 - (f%36)/12);
    }

    const wd = st.loungeProps.water_dispenser;
    if (activeBehaviors.some(b => b.type === 'water')) {
      ctx.fillStyle = (f % 24) < 12 ? '#e0fbff' : '#72d7ff';
      ctx.fillRect(wd.x*T + 13, wd.y*T + 7, 6, 4);
      ctx.fillStyle = '#9ee7ff'; ctx.fillRect(wd.x*T + 15, wd.y*T + 15, 2, 9);
    }

    if (activeBehaviors.some(b => b.type === 'phone')) {
      const tb = st.loungeProps.coffee_table;
      ctx.fillStyle = 'rgba(114,247,255,0.16)';
      ctx.fillRect(tb.x1*T + 10, tb.y1*T + 7, (tb.x2-tb.x1+1)*T - 20, 8);
    }
  },

  _drawSceneEventDetails(ctx) {
    const ev = this._sceneEvent;
    if (!ev || !ev.participants || ev.participants.length < 2) return;
    const T = this.TILE, f = this._frame;
    const actors = ev.participants.map(n => ({ name: n, actor: this._actors[n], color: this._profileColor(n) })).filter(x => x.actor && !x.actor.hidden);
    if (actors.length < 2) return;
    ctx.save();
    ctx.lineWidth = 1.2;
    for (let i = 0; i < actors.length - 1; i++) {
      const a = actors[i], b = actors[i + 1];
      const ax = a.actor.x*T + T/2, ay = a.actor.y*T + T/2 - 18;
      const bx = b.actor.x*T + T/2, by = b.actor.y*T + T/2 - 18;
      const g = ctx.createLinearGradient(ax, ay, bx, by);
      g.addColorStop(0, this._rgba(a.color, 0.52));
      g.addColorStop(1, this._rgba(b.color, 0.52));
      ctx.strokeStyle = g;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = (f % 50) < 25 ? '#fff2a8' : '#72f7ff';
      const t = ((f % 90) / 90);
      ctx.fillRect(ax + (bx-ax)*t - 1, ay + (by-ay)*t - 1, 3, 3);
    }
    if (ev.type.includes('whiteboard') || ev.type.includes('review') || ev.type.includes('sync') || ev.type.includes('debug')) {
      const wb = this._seats?.workspaceProps?.whiteboard;
      if (wb) {
        const x = wb.x1*T, y = wb.y1*T;
        ctx.strokeStyle = (ev.type === 'debug_pair' || ev.type === 'cc_debug') ? '#ffcf5a' : '#00f5d4';
        ctx.lineWidth = 1;
        ctx.strokeRect(x+8, y+44, 48, 30);
        ctx.beginPath();
        ctx.moveTo(x+12, y+68); ctx.lineTo(x+24, y+56); ctx.lineTo(x+38, y+62); ctx.lineTo(x+52, y+50);
        ctx.stroke();
        ctx.fillStyle = '#ff6b9d'; ctx.fillRect(x+12, y+48, 10, 3);
        ctx.fillStyle = '#fbbf24'; ctx.fillRect(x+28, y+48, 10, 3);
      }
    }
    if (ev.phase === 'interact') {
      const midX = actors.reduce((n,x)=>n+x.actor.x,0)/actors.length*T + T/2;
      const midY = actors.reduce((n,x)=>n+x.actor.y,0)/actors.length*T + T/2 - 42;
      const text = this._sceneEventLabel(ev.type);
      this._drawActionWhisper(ctx, midX, midY - 4 - Math.sin(f/14)*2, text, '#f8fafc');
      for (const x of actors) {
        const ax = x.actor.x*T + T/2, ay = x.actor.y*T + T/2;
        if (x.actor.scenePhrase) this._drawActionWhisper(ctx, ax, ay - 40 - ((this._hashName(x.name)+f)%20)/20*3, x.actor.scenePhrase, x.color);
      }
    }
    ctx.restore();
  },

  _sceneEventLabel(type) {
    const map = { chat_pair: '交流中', sync_pair: '同步中', whiteboard_pair: '白板协作', review_pair: '评审中', debug_pair: '排查中', standup_group: '短会', cc_review: 'CC评审', cc_sync: 'CC对齐', cc_debug: 'CC调Bug' };
    return map[type] || '协作中';
  },

  _drawTimeOverlay(ctx, w, h, phase) {
    if (!phase.alpha) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this._rgba(phase.color, phase.alpha);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  },

  _rgba(hex, a) {
    const v = hex.replace('#','');
    const r = parseInt(v.slice(0,2),16), g = parseInt(v.slice(2,4),16), b = parseInt(v.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  },

  _drawBehaviorEffect(ctx, cx, cy, actor, p, kind) {
    const b = actor.behavior;
    const f = this._frame;
    const name = p.profile || p.name || 'default';
    if (b) {
      if (b.type === 'phone') {
        const glow = (f % 40) < 26;
        ctx.fillStyle = '#0b1220'; ctx.fillRect(cx + 9, cy + 1, 7, 10);
        ctx.fillStyle = glow ? '#72f7ff' : '#2a6f78'; ctx.fillRect(cx + 10, cy + 2, 5, 7);
        if (glow) { ctx.fillStyle = 'rgba(114,247,255,0.18)'; ctx.fillRect(cx + 6, cy - 3, 14, 18); }
      }
      if (b.type === 'coffee') { ctx.fillStyle = '#d8c090'; ctx.fillRect(cx+10, cy-6, 6, 7); ctx.fillStyle = '#f0e0c0'; ctx.fillText('~', cx+11, cy-9 - (f%30)/12); }
      if (b.type === 'water') { ctx.fillStyle = '#9ee7ff'; ctx.fillRect(cx+10, cy-10, 5, 10); ctx.fillStyle = '#dff8ff'; ctx.fillRect(cx+12, cy-12, 2, 2); }
      if (b.type === 'restroom' && b.phase === 'exit') { this._drawActionWhisper(ctx, cx, cy - 33, '...', '#cbd5e1'); }
      if (b.type === 'stretch') { ctx.strokeStyle = '#f0c6a8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx-8, cy-10); ctx.lineTo(cx-18, cy-24); ctx.moveTo(cx+8, cy-10); ctx.lineTo(cx+18, cy-24); ctx.stroke(); }
      if (b.type === 'whiteboard') { this._drawActionWhisper(ctx, cx, cy - 33, this._profileThought(name, 'whiteboard'), '#e8e8f0'); }
      if (b.type === 'window') { this._drawActionWhisper(ctx, cx, cy - 33, this._profileThought(name, 'window'), '#9ecbff'); }
      if (b.type === 'overtime-walk') { this._drawPixelEmoji(ctx, cx + 18, cy - 28, (f / 90 | 0) % 2 ? 'sleepy' : 'anger'); }
      if (b.type === 'read_doc') { this._drawActionWhisper(ctx, cx, cy - 33, name === 'pm' ? 'PRD' : '文档', '#f8d7ff'); }
      if (b.type === 'search_idle') { this._drawActionWhisper(ctx, cx, cy - 33, '检索中', '#c4b5fd'); }
      if (b.type === 'corridor_pace' || b.type === 'corridor_walk') { this._drawActionWhisper(ctx, cx, cy - 33, b.type === 'corridor_pace' ? '踱步' : '走走', '#cbd5e1'); }
      if (b.type === 'micro_nap' || b.type === 'sofa_nap') { this._drawPixelEmoji(ctx, cx + 18, cy - 28, 'sleepy'); }
      if (b.type === 'thinking_plan') { this._drawActionWhisper(ctx, cx, cy - 33, this._profileThought(name, 'window'), '#9ecbff'); }
      if (b.type === 'coding') { /* 坐在工位时由键盘/屏幕表现 */ }
    } else if (kind === 'work' && this._timePhase().key === 'night' && (f % 180) < 80) {
      this._drawPixelEmoji(ctx, cx + 18, cy - 28, (f / 360 | 0) % 2 ? 'sleepy' : 'anger');
    }
  },

  _profileThought(name, context) {
    const thoughts = this._rules?.thoughts || {};
    const byProfile = thoughts[name] || thoughts.default || {};
    if (byProfile && byProfile[context]) return byProfile[context];
    if (name === 'pm') return context === 'whiteboard' ? '排期' : 'PRD';
    if (name === 'tech') return context === 'whiteboard' ? '架构' : 'debug';
    return context === 'whiteboard' ? '检索中' : '...';
  },

  _drawPixelEmoji(ctx, x, y, type) {
    if (type === 'anger') {
      ctx.fillStyle = '#ff4d5a';
      ctx.fillRect(x, y+4, 5, 3); ctx.fillRect(x+7, y, 3, 8); ctx.fillRect(x+12, y+5, 6, 3); ctx.fillRect(x+8, y+10, 3, 6);
      ctx.fillStyle = '#ffd0d0'; ctx.fillRect(x+2, y+5, 2, 1); ctx.fillRect(x+13, y+6, 2, 1);
    } else {
      ctx.fillStyle = '#8fd3ff';
      ctx.font = 'bold 11px monospace'; ctx.fillText('Z', x, y+9); ctx.font = 'bold 8px monospace'; ctx.fillText('z', x+9, y+2);
    }
  },

  _drawSittingAvatar(ctx, cx, cy, color, name, p, kind) {
    const f = this._frame;
    const breathe = Math.floor(f / 30) % 2;
    const typing = kind === 'work' && (Math.floor(f / 8) % 2 === 0);
    const thinking = kind === 'thinking';
    const skin = '#f0c6a8';
    const hair = name === 'pm' ? '#7a2d55' : name === 'tech' ? '#064e4a' : '#4c3575';

    // 影子
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(cx - 12, cy + 10, 24, 6);

    // 身体/衣服（坐姿，椅子前方）
    ctx.fillStyle = color;
    ctx.fillRect(cx - 9, cy - 2 + breathe, 18, 17);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(cx - 7, cy + 1 + breathe, 14, 3);

    // 腿/鞋
    ctx.fillStyle = '#1b2430';
    ctx.fillRect(cx - 9, cy + 13, 7, 7);
    ctx.fillRect(cx + 2, cy + 13, 7, 7);
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(cx - 10, cy + 19, 9, 3);
    ctx.fillRect(cx + 1, cy + 19, 9, 3);

    // 头：皮肤 -> 头发 -> 眼睛
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 8, cy - 18 + breathe, 16, 15);
    ctx.fillStyle = hair;
    ctx.fillRect(cx - 8, cy - 19 + breathe, 16, 6);
    ctx.fillRect(cx - 9, cy - 14 + breathe, 3, 5);
    ctx.fillRect(cx + 6, cy - 14 + breathe, 3, 5);
    ctx.fillStyle = '#111827';
    if (thinking && Math.floor(f / 45) % 2 === 0) {
      ctx.fillRect(cx - 4, cy - 10 + breathe, 8, 2); // 抬头/眯眼
    } else {
      ctx.fillRect(cx - 5, cy - 10 + breathe, 2, 2);
      ctx.fillRect(cx + 3, cy - 10 + breathe, 2, 2);
    }

    // 手臂：工作时敲键盘，休息时自然放下
    ctx.fillStyle = skin;
    if (kind === 'work' || kind === 'thinking') {
      const handY = typing ? cy + 5 : cy + 7;
      ctx.fillRect(cx - 13, handY, 6, 4);
      ctx.fillRect(cx + 7, handY + (typing ? 2 : 0), 6, 4);
      // 小键盘闪烁线：强化“坐在工位工作”
      ctx.fillStyle = typing ? '#9fffee' : '#4b6f78';
      ctx.fillRect(cx - 14, cy + 21, 28, 2);
    } else {
      ctx.fillRect(cx - 13, cy + 4, 5, 9);
      ctx.fillRect(cx + 8, cy + 4, 5, 9);
    }

    // 名称标签
    this._drawAvatarLabel(ctx, cx, cy + 31, this._profileName(p), color);

    // 思考气泡
    if (thinking && Math.floor(f / 60) % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(cx + 11, cy - 27, 5, 5);
      ctx.fillRect(cx + 18, cy - 33, 7, 7);
      ctx.fillRect(cx + 28, cy - 40, 12, 9);
      ctx.fillStyle = '#1a2540';
      ctx.fillRect(cx + 32, cy - 36, 2, 2);
      ctx.fillRect(cx + 36, cy - 36, 2, 2);
    }
  },

  _drawWalkingAvatar(ctx, cx, cy, color, name, p, dir) {
    const f = this._frame;
    const step = Math.floor(f / 8) % 4;
    const bob = (step === 1 || step === 3) ? -1 : 0;
    const leg = (step === 0 || step === 2) ? 1 : -1;
    const skin = '#f0c6a8';
    const hair = name === 'pm' ? '#7a2d55' : name === 'tech' ? '#064e4a' : '#4c3575';

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(cx - 11, cy + 12, 22, 5);

    // 腿部摆动
    ctx.fillStyle = '#1b2430';
    if (dir === 'east' || dir === 'west') {
      ctx.fillRect(cx - 7 + leg * 2, cy + 8, 6, 10);
      ctx.fillRect(cx + 1 - leg * 2, cy + 8, 6, 10);
    } else {
      ctx.fillRect(cx - 8, cy + 8 + leg, 6, 10);
      ctx.fillRect(cx + 2, cy + 8 - leg, 6, 10);
    }

    // 身体
    ctx.fillStyle = color;
    ctx.fillRect(cx - 9, cy - 6 + bob, 18, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(cx - 7, cy - 3 + bob, 14, 3);

    // 手臂摆动
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 13, cy - 3 - leg + bob, 5, 11);
    ctx.fillRect(cx + 8, cy - 3 + leg + bob, 5, 11);

    // 头部
    ctx.fillStyle = skin;
    ctx.fillRect(cx - 8, cy - 22 + bob, 16, 15);
    ctx.fillStyle = hair;
    ctx.fillRect(cx - 8, cy - 23 + bob, 16, 6);
    ctx.fillRect(cx - 9, cy - 18 + bob, 3, 5);
    ctx.fillRect(cx + 6, cy - 18 + bob, 3, 5);
    ctx.fillStyle = '#111827';
    const eyeOffset = dir === 'east' ? 2 : dir === 'west' ? -2 : 0;
    ctx.fillRect(cx - 5 + eyeOffset, cy - 14 + bob, 2, 2);
    ctx.fillRect(cx + 3 + eyeOffset, cy - 14 + bob, 2, 2);

    this._drawAvatarLabel(ctx, cx, cy + 31, this._profileName(p), color);
  },

  _drawSleepingAvatar(ctx, cx, cy, color, name, p) {
    const f = this._frame;
    const breathe = Math.floor(f / 45) % 2;
    const skin = '#f0c6a8';
    const hair = name === 'pm' ? '#7a2d55' : name === 'tech' ? '#064e4a' : '#4c3575';

    // 睡姿横躺在床上，略向下偏移，盖在被子上
    const x = cx - 12;
    const y = cy + 4 + breathe;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x - 2, y + 8, 30, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x + 8, y, 20, 10);
    ctx.fillStyle = skin;
    ctx.fillRect(x - 2, y - 2, 12, 12);
    ctx.fillStyle = hair;
    ctx.fillRect(x - 4, y - 3, 8, 12);
    ctx.fillStyle = '#111827';
    ctx.fillRect(x + 3, y + 3, 5, 1); // 闭眼

    // Zzz 动画
    if (Math.floor(f / 40) % 3 !== 0) {
      ctx.fillStyle = '#d8d0ff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('Z', cx + 13, cy - 8 - (f % 40) / 8);
      ctx.font = 'bold 8px monospace';
      ctx.fillText('z', cx + 23, cy - 16 - (f % 40) / 10);
    }
    this._drawAvatarLabel(ctx, cx, cy + 31, this._profileName(p), color);
  },

  _drawAvatarLabel(ctx, cx, y, text, color) {
    // v20-M5 微调：人物下方身份说明去方框，改为更小的描边文字，减少遮挡。
    ctx.save();
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(5,8,16,0.82)';
    ctx.strokeText(text, cx, y - 3);
    ctx.fillStyle = this._rgba(color, 0.96);
    ctx.fillText(text, cx, y - 3);
    ctx.restore();
  },

  _drawActionWhisper(ctx, cx, y, text, color) {
    // v20-M5 微调：头顶动作说明改为漂浮轻提示，不再复用姓名标签的板正方框。
    const f = this._frame;
    const drift = Math.sin((f + cx * 0.37) / 38) * 2.2;
    const bob = Math.sin((f + y * 0.19) / 27) * 1.4;
    const x = cx + drift;
    const yy = y + bob;
    const pulse = 0.50 + 0.12 * Math.sin(f / 24);

    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = Math.ceil(ctx.measureText(text).width);

    // 柔和光晕 + 细小尾点：有气泡语义，但没有硬边框/矩形块。
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = this._rgba(color, 0.12 + pulse * 0.10);
    ctx.beginPath();
    ctx.ellipse(x, yy, Math.max(13, w / 2 + 7), 8, Math.sin(f / 60) * 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.66;
    ctx.fillStyle = this._rgba(color, 0.32);
    ctx.beginPath(); ctx.arc(x - 10, yy + 10, 2.0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 16, yy + 15, 1.2, 0, Math.PI * 2); ctx.fill();

    // 文字用暗描边保证可读，不画外框。
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,16,0.72)';
    ctx.strokeText(text, x, yy);
    ctx.fillStyle = this._rgba(color, 0.96);
    ctx.fillText(text, x, yy);

    // 一点像素星尘，让提示更“飘”。
    ctx.fillStyle = this._rgba(color, 0.55);
    ctx.fillRect(Math.round(x + w / 2 + 5), Math.round(yy - 8), 2, 2);
    if ((f % 90) < 45) ctx.fillRect(Math.round(x - w / 2 - 8), Math.round(yy - 5), 1.5, 1.5);
    ctx.restore();
  }
};

window.PixelOffice = PixelOffice;
