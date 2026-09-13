window.__ModuleLoader__.load({
  id: "dsh-simple-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    /**
     * dsh-simple-memory — Client 半
     *
     * 1. 记忆按钮（conversation.input.left）：点击弹出**四动作菜单**（2026-09-12 改版）
     *    —— 联想 / 升格 / 查记忆库 / 做梦：
     *      · 联想：塞指令让模型回顾本轮、列候选，用户点头才写
     *      · 升格：塞指令让模型整理 staging 与 dreams 两个池子、提议去向
     *      · 查记忆库：就地弹浮层（分组列表 + 搜索框 + 点开读全文）
     *      · 做梦：塞指令让模型随机组合记忆找洞察，产出进做梦池等确认
     * 2. 设置侧边栏页（settings.section）：记忆管理页（状态/初始化/浏览）。
     * 3. 插件卡片（settings.plugin.item）：同管理页（配置项区入口）。
     * 4. 设置页内嵌记忆浏览：列活跃记忆 + 点开读（不用 shell.overlay，避免与 HUD 重叠）。
     */

    // ── 记忆指令模板（三条，各自自包含、不引用外部文件）──
    // 联想：发现值得记的 → 提议（标项目/全局 + 理由）→ 等确认 → 写入 → commit
    const PROMPT_RECALL =
      "现在做一次记忆联想：① 回顾本轮对话，列出值得记的内容（决策/踩坑/新约定/偏好）② 逐条标明记到哪：项目（仅本项目有用）或 全局（跨项目复用），各附一句理由 ③ 等我确认；确认后调用 memory-write 写入（scope 与提议一致；文件名 分类-主题.md，≤2KB，首行日期）④ 贴出产出物 ⑤ 顺手 git commit（mem: 记 xxx）";
    // 升格：整理 staging + dreams 两个池子 → 提议去向 → 等确认 → 执行升格并出池
    const PROMPT_PROMOTE =
      "现在做一次记忆升格整理：① 读记忆库根目录的 staging.md（升格暂存池）和 dreams.md（做梦池，若不存在就说明暂无）② 逐条判断去向：该升格进 common/（跨项目通用）还是对应项目记忆；与已有记忆重复或已被新实践替代的，建议弃用 ③ 把整理方案列给我（每条：来源池 → 建议去向 + 一句理由），等我确认 ④ 确认后执行升格（写入 + git commit「mem: 升格 xxx」），并从池中删除该条；已弃的留一行痕迹（防重复梦/重复捞）⑤ 贴出产出物";
    // 做梦：随机组合 3~5 条记忆找跨界洞察 → 最多 2~3 条 → 写入做梦池（不直接进正式记忆）
    const PROMPT_DREAM =
      "现在做一次「做梦」（随机组合记忆找洞察）：① 从记忆库**纯随机**抽 3~5 条（尽量跨项目、跨分类，优先没组合过的；可用 memory_search/读文件） ② **联想策略（2026-09-13 调整）**：抽样保持纯随机，但**先从「零碎经验」下手**（踩坑类 / 还没被消化的原始记录）——优先在它们之间找共性、迁移；**成熟决策之间硬凑的连接要克制**；产出的结论必须是**入场记忆原文里都没明说**的（只是复述原文不算洞察，不许写进池子）；抠不出真东西就直说「这次没梦到」，池子留空 ③ 值得写时，每条给出：入场的记忆清单 + 梦到的连接（类型：共性/矛盾/迁移/空白）+ 建议去向（全局 or 哪个项目）+ 一句价值判断；**最多 2~3 条**，宁缺毋滥 ④ 把产出追加写入记忆库根目录 dreams.md，每条一行、严格按格式：`- 日期 [待确认] 入场：记忆A、记忆B、记忆C → 连接：xxx（类型：共性/矛盾/迁移/空白）→ 建议去向：全局 or 项目X → 价值：一句话`；**不要直接写进 common/ 或 projects/** ⑤ 告诉我池里新增了几条、分别是什么，等我看完决定升格还是弃用";


    // ── 模块级共享状态（按钮/管理页/浏览器跨组件同步）──
    let snapshot = { browserOpen: false, status: null, files: null, content: null, busy: false, sessionId: null };
    const listeners = new Set();
    function getSnapshot() { return snapshot; }
    function subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }
    function emit(patch) {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    }

    // ── 与 host 半通信（静态 bundle：HTTP 路由 /api/dsh-simple-memory/*）──
    async function api(path, query, method, body) {
      const q = query ? "?" + new URLSearchParams(query).toString() : "";
      const res = await fetch("/api/dsh-simple-memory" + path + q, {
        cache: "no-store",
        method: method || "GET",
        ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    // ── 样式（幂等注入，全部 dsw token）──
    if (typeof document !== "undefined" && !document.getElementById("dsh-simple-memory-style")) {
      const tag = document.createElement("style");
      tag.id = "dsh-simple-memory-style";
      tag.textContent = [
        ".smem-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}",
        ".smem-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".smem-btn:disabled{opacity:.5;cursor:default;}",
        // ── 四动作菜单 + 记忆浏览浮层（2026-09-12；对齐官方菜单壳：--dsw-specific-menu 底 /
        //    圆角 20px / 无边框 / --dsw-elevation-prominent 阴影 / 项 34px·radius 10px）──
        ".smem-wrap{position:relative;display:inline-flex;}",
        ".smem-menu{position:absolute;bottom:calc(100% + 8px);left:0;z-index:60;min-width:204px;box-sizing:border-box;padding:4px;display:flex;flex-direction:column;border:0;border-radius:20px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-elevation-prominent);}",
        ".smem-menu-item{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;min-height:34px;box-sizing:border-box;padding:5px 10px;border:none;border-radius:10px;background:transparent;cursor:pointer;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);text-align:left;}",
        ".smem-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}",
        ".smem-menu-item .t{font-weight:600;font-size:13px;}",
        ".smem-menu-item .d{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;}",
        ".smem-float{position:absolute;bottom:calc(100% + 8px);left:0;z-index:60;width:340px;max-height:54vh;overflow:auto;box-sizing:border-box;padding:10px;border:0;border-radius:20px;background:var(--dsw-specific-menu,#fff);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-size:12px;}",
        ".smem-float .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;}",
        ".smem-float .title{font-weight:600;font-size:13px;}",
        ".smem-float .close{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;font-size:14px;line-height:1;padding:2px 5px;border-radius:8px;}",
        ".smem-float .close:hover{background:var(--dsw-alias-interactive-bg-hover);}",
        ".smem-float .pools{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-bottom:6px;}",
        ".smem-float .searchbox{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;font:inherit;font-size:12px;margin-bottom:6px;}",
        ".smem-float .sec{margin:7px 0 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;}",
        ".smem-float .f{display:flex;align-items:center;gap:5px;padding:4px 6px;border-radius:10px;cursor:pointer;color:var(--dsw-alias-label-secondary);}",
        ".smem-float .f:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
        ".smem-float .empty{color:var(--dsw-alias-label-tertiary);padding:4px 0;}",
        ".smem-float .body{margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);max-height:26vh;overflow:auto;font-size:12px;}",
        // 设置内容皮肤（2026-08-21 对齐官方）：官方设置面板 bg-layer-2 已提供背景，
        // settings.section 内容区透明、settings.plugin.item 官方卡片自带 bg-layer-3——
        // 不自造卡片背景/边框/圆角，否则深浅主题下与其他分区不一致（灰底差异）
        ".smem-card{color:var(--dsw-alias-label-primary,#333);font-size:13px;line-height:1.6;}",
        ".smem-card h3{margin:0 0 8px;font-size:14px;font-weight:600;}",
        ".smem-card .row{margin:5px 0;color:var(--dsw-alias-label-secondary,#666);}",
        ".smem-card .btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-primary,#333);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;margin:4px 4px 0 0;}",
        ".smem-card .btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".smem-card .btn:disabled{opacity:.5;cursor:default;}",
        ".smem-card .ok{color:var(--dsw-alias-state-success-primary,#2e9e44);}",
        ".smem-card .warn{color:var(--dsw-alias-state-warn-primary,#e8a13a);}",
        ".smem-card .err{color:var(--dsw-alias-state-error-primary,#d03050);}",
        ".smem-card .btn.is-saved{color:var(--dsw-alias-state-success-primary,#2e9e44);border-color:var(--dsw-alias-state-success-primary,#2e9e44);}",
      ].join("\n");
      document.head.appendChild(tag);
    }

    // ── 记忆图标（灯泡：灵光一闪 = 想起记忆）──
    function MemIcon() {
      return react.createElement("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1.5,
        strokeLinecap: "round", strokeLinejoin: "round",
        style: { flex: "none", display: "block" },
      },
        react.createElement("path", { d: "M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.6.5 1.1 1.2 1.1 2.1h3c0-.9.5-1.6 1.1-2.1A4.5 4.5 0 0 0 8 1.5z" }),
        react.createElement("path", { d: "M6.8 13.5h2.4" }),
        react.createElement("path", { d: "M7.3 11.5h1.4" })
      );
    }

    // 记忆文件图标（2026-08-21，界面图标不用 emoji：文件 + 折角）
    const MEM_FILE_SVG = "<svg width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6 1.5h4.5L14 5v8.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z'/><path d='M10.5 1.5V5H14'/></svg>";

    // ── 官方设置卡片壳（2026-09-02，视觉对齐 dsh 0.1.2 host PluginCard；key 须与宿主命名空间一致）──
    const CARD_CSS = ".dsh-settings-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}.dsh-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dsh-settings-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}.dsh-settings-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dsh-settings-headtext{display:flex;flex-direction:column;flex:1;min-width:0;gap:4px}.dsh-settings-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dsh-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dsh-settings-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dsh-settings-open .dsh-settings-chevron{transform:rotate(180deg)}.dsh-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:10px 0 8px}.dsh-settings-body input,.dsh-settings-body textarea,.dsh-settings-body select{box-sizing:border-box;max-width:100%;min-width:0}";
    let cardCssInjected = false;
    function injectCardCss() {
      if (typeof document === "undefined" || cardCssInjected) return;
      cardCssInjected = true;
      if (document.getElementById("dsh-memory-settings-card-style") !== null) return;
      const tag = document.createElement("style");
      tag.id = "dsh-memory-settings-card-style";
      tag.textContent = CARD_CSS;
      document.head.appendChild(tag);
    }
    function SettingsCardShell(props) {
      const [open, setOpen] = react.useState(false);
      return react.createElement("li", { className: "dsh-settings-card" + (open ? " dsh-settings-open" : "") },
        react.createElement("button", {
          type: "button", className: "dsh-settings-head", "aria-expanded": open,
          onClick: () => setOpen(!open),
          "aria-label": (open ? "折叠" : "展开") + "：" + props.title,
        },
          react.createElement("span", { className: "dsh-settings-headtext" },
            react.createElement("span", { className: "dsh-settings-name" }, props.title),
            react.createElement("span", { className: "dsh-settings-desc" }, props.desc)
          ),
          react.createElement("svg", { className: "dsh-settings-chevron", width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" },
            react.createElement("path", { d: "M4 6.5 8 10.5 12 6.5" })
          )
        ),
        open ? react.createElement("div", { className: "dsh-settings-body" }, props.children) : null
      );
    }

    // ── 记忆浏览的模块级动作（设置页与输入框浮层共用；2026-09-12 抽出）──
    async function browseMemory() {
      emit({ busy: true, browserOpen: true });
      try {
        const r = await api("/list", { session: snapshot.sessionId || "" });
        emit({ files: r && r.ok ? r : null, content: null, browserOpen: true });
      } catch (e) { emit({ files: null, content: null, browserOpen: true }); }
      emit({ busy: false });
    }
    async function openMemoryFile(name) {
      try {
        const r = await api("/read", { name, session: snapshot.sessionId || "" });
        emit({ content: r && r.ok ? r.content : "读取失败：" + ((r && r.error) || "") });
      } catch (e) { emit({ content: "读取失败：" + String(e && e.message ? e.message : e) }); }
    }
    function closeMemoryBrowser() {
      emit({ browserOpen: false, files: null, content: null });
    }
    function memoryFileRow(path, label, key) {
      return react.createElement("div", { key, className: "f", onClick: () => openMemoryFile(path) },
        react.createElement("span", { dangerouslySetInnerHTML: { __html: MEM_FILE_SVG } }),
        react.createElement("span", null, label));
    }

    // ── 记忆浏览浮层（输入框上方；分组列表 + 搜索框 + 点开读全文）2026-09-12 新增 ──
    function MemoryFloat() {
      const snap = react.useSyncExternalStore(subscribe, getSnapshot);
      const [query, setQuery] = react.useState("");
      // 首次打开浮层时补拉一次状态（池子条数用；设置页没开过时 snapshot.status 为空）
      react.useEffect(() => {
        if (snapshot.browserOpen && snapshot.status === null) {
          api("/status").then((st) => { if (st && st.ok) emit({ status: st }); }).catch(() => {});
        }
      }, [snap.browserOpen]);
      if (!snap.browserOpen) return null;
      const st = snap.status;
      const files = snap.files && snap.files.ok ? snap.files : null;
      const q = query.trim().toLowerCase();
      const hit = (s) => q === "" || String(s).toLowerCase().includes(q);
      const rows = [];
      if (files) {
        (files.projects || []).forEach((proj) => {
          const list = (proj.files || []).filter((f) => hit(f) || hit(proj.name));
          if (list.length === 0) return;
          rows.push(react.createElement("div", { key: "ph" + proj.name, className: "sec" }, "项目 " + proj.name));
          list.forEach((f) => rows.push(memoryFileRow("project/" + proj.name + "/" + f, f, "p" + proj.name + f)));
        });
        const gList = (files.global || []).filter(hit);
        if (gList.length > 0) {
          rows.push(react.createElement("div", { key: "gh", className: "sec" }, "全局 common/"));
          gList.forEach((f) => rows.push(memoryFileRow("common/" + f, f, "g" + f)));
        }
        if (rows.length === 0) {
          rows.push(react.createElement("div", { key: "e", className: "empty" }, q !== "" ? "没有匹配「" + query + "」的记忆" : "暂无记忆"));
        }
      } else {
        rows.push(react.createElement("div", { key: "e", className: "empty" }, snap.busy ? "加载中…" : "浏览失败，请重试"));
      }
      return react.createElement("div", { className: "smem-float", onClick: (e) => e.stopPropagation() },
        react.createElement("div", { className: "head" },
          react.createElement("span", { className: "title" }, "记忆库"),
          react.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } },
            react.createElement("span", { className: "pools" },
              st && st.ok ? ("全局 " + st.globalIndexCount + " · 暂存池 " + st.stagingCount + " · 做梦池 " + (st.dreamsCount || 0)) : ""),
            react.createElement("button", { type: "button", className: "close", onClick: closeMemoryBrowser, title: "关闭", "aria-label": "关闭记忆浏览" }, "×")
          )
        ),
        react.createElement("input", {
          className: "searchbox", type: "text", value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "搜索记忆名（如 踩坑 / hud / 沙箱）", "aria-label": "搜索记忆",
        }),
        rows,
        snap.content !== null ? react.createElement("div", { className: "body" }, snap.content) : null
      );
    }

    // ── 记忆管理页（设置侧边栏页 / 插件卡片共用，浏览列表内嵌）──
    function MemorySettingsPage(props) {
      const snap = react.useSyncExternalStore(subscribe, getSnapshot);
      const [msg, setMsg] = react.useState(null);
      async function refresh() {
        emit({ busy: true });
        try {
          const st = await api("/status");
          emit({ status: st });
        } catch (e) { emit({ status: { ok: false, error: String(e && e.message ? e.message : e) } }); }
        emit({ busy: false });
      }
      react.useEffect(() => { refresh(); }, []);
      async function init() {
        setMsg(null);
        try {
          const r = await api("/init", null, "POST");
          setMsg(r && r.ok ? { kind: "ok", text: r.message || "完成" } : { kind: "err", text: (r && r.error) || "失败" });
          refresh();
        } catch (e) { setMsg({ kind: "err", text: String(e && e.message ? e.message : e) }); }
      }
      // 浏览动作复用模块级实现（2026-09-12 抽取，输入框浮层同一套）
      const browse = browseMemory;
      const openFile = openMemoryFile;
      const closeBrowser = closeMemoryBrowser;
      // 记忆根目录配置（读取/保存）
      const [dirDraft, setDirDraft] = react.useState("");
      const [dirMsg, setDirMsg] = react.useState(null);
      // 保存反馈统一口径（2026-08-21）：按钮短暂变绿"✓ 已保存" + 绿字
      const [dirSaved, setDirSaved] = react.useState(false);
      const dirSavedTimer = react.useRef(null);
      async function loadConfig() {
        try {
          const r = await api("/config");
          if (r && r.ok) setDirDraft(r.globalMemoryDir || "");
        } catch (e) { /* 静默：读不到就保持空 */ }
      }
      react.useEffect(() => { loadConfig(); }, []);
      react.useEffect(() => () => {
        if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
      }, []);
      async function saveConfig() {
        setDirMsg(null);
        const dir = (dirDraft || "").trim();
        if (!dir) { setDirMsg({ kind: "err", text: "路径不能为空" }); return; }
        try {
          const r = await api("/config", null, "POST", { globalMemoryDir: dir });
          setDirMsg(r && r.ok ? { kind: "ok", text: r.message || "已保存" } : { kind: "err", text: (r && r.error) || "保存失败" });
          if (r && r.ok) {
            setDirSaved(true);
            if (dirSavedTimer.current !== null) clearTimeout(dirSavedTimer.current);
            dirSavedTimer.current = setTimeout(() => { setDirSaved(false); dirSavedTimer.current = null; }, 2000);
          }
        } catch (e) { setDirMsg({ kind: "err", text: String(e && e.message ? e.message : e) }); }
      }
      const st = snap.status;
      const busy = snap.busy;
      const files = snap.files && snap.files.ok ? snap.files : null;
      const sections = [];
      if (snap.browserOpen) {
        if (files) {
          if (files.projects && files.projects.length > 0) {
            files.projects.forEach((proj) => {
              sections.push(react.createElement("div", { key: "p" + proj.name, className: "row" }, "项目 " + proj.name + "："));
              proj.files.forEach((f) => sections.push(
                react.createElement("div", {
                  key: "p" + proj.name + f, className: "file", onClick: () => openFile("project/" + proj.name + "/" + f),
                  style: { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" },
                },
                  react.createElement("span", { dangerouslySetInnerHTML: { __html: MEM_FILE_SVG } }),
                  react.createElement("span", null, f))
              ));
            });
          }
          if (files.global && files.global.length > 0) {
            sections.push(react.createElement("div", { key: "g", className: "row" }, "全局 common/"));
            files.global.forEach((f) => sections.push(
              react.createElement("div", {
                key: "g" + f, className: "file", onClick: () => openFile("common/" + f),
                style: { display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" },
              },
                react.createElement("span", { dangerouslySetInnerHTML: { __html: MEM_FILE_SVG } }),
                react.createElement("span", null, f))
            ));
          }
          if ((!files.projects || files.projects.length === 0) && (!files.global || files.global.length === 0)) {
            sections.push(react.createElement("div", { key: "e", className: "row" }, "暂无记忆。点输入框的记忆按钮或让 agent 记一条。"));
          }
        } else {
          sections.push(react.createElement("div", { key: "e", className: "row" }, busy ? "加载中…" : "浏览失败，请重试"));
        }
      }
      return react.createElement("div", { className: "smem-card" },
        // 卡片壳内不重复标题
        props && props.inCard ? null : react.createElement("h3", null, "记忆管理"),
        react.createElement("div", { className: "row" },
          st && st.ok
            ? react.createElement("span", null, "全局活跃 " + st.globalIndexCount + " 条 · 升格暂存池 " + st.stagingCount + " 条 · 做梦池 " + (st.dreamsCount || 0) + " 条")
            : react.createElement("span", { className: "err" }, (st && st.error) || "状态读取中…")
        ),
        react.createElement("div", { className: "row" },
          react.createElement("label", { htmlFor: "smem-dir", style: { marginRight: 6 } }, "记忆根目录："),
          react.createElement("input", {
            id: "smem-dir", type: "text", value: dirDraft,
            onChange: (e) => setDirDraft(e.target.value),
            placeholder: "如 /Users/xxx/Documents/DSH/memory",
            style: { width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1,#e5e5e5)", background: "transparent", color: "var(--dsw-alias-label-primary,#333)", fontSize: 12, fontFamily: "inherit" }
          }),
          react.createElement("button", { type: "button", className: "btn" + (dirSaved ? " is-saved" : ""), disabled: busy, onClick: saveConfig, style: { marginLeft: 6 } }, dirSaved ? "✓ 已保存" : "保存"),
          dirMsg ? react.createElement("span", { className: dirMsg.kind === "ok" ? "ok" : "err", style: { marginLeft: 6, fontSize: 12 } }, dirMsg.text) : null
        ),
        react.createElement("div", null,
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: init }, "初始化记忆仓库"),
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: snap.browserOpen ? closeBrowser : browse }, snap.browserOpen ? "收起记忆" : "浏览记忆"),
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: refresh }, "刷新状态")
        ),
        snap.browserOpen ? react.createElement("div", { key: "b", className: "browser", style: { marginTop: 10, borderTop: "1px solid var(--dsw-alias-border-l1,#e5e5e5)", paddingTop: 8 } },
          react.createElement("div", { className: "row" }, "记忆浏览"),
          sections,
          snap.content !== null
            ? react.createElement("div", { key: "c", className: "content" }, snap.content)
            : null
        ) : null,
        msg ? react.createElement("div", { className: "row " + (msg.kind === "ok" ? "ok" : "err") }, msg.text) : null,
        react.createElement("div", { className: "row", style: { marginTop: 10, fontSize: 12 } },
          "用法：输入框的灯泡按钮弹出四动作——联想（回顾本轮列候选，等你确认才写）/ 升格（整理暂存池与做梦池，提议去向）/ 查记忆库（列表 + 搜索 + 读全文）/ 做梦（随机组合记忆找洞察，产出进做梦池等你确认）。"
        )
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;

      // 1. 记忆按钮：点击 → 弹出四动作菜单（联想 / 升格 / 查记忆库 / 做梦）
      slots.inject("conversation.input.left", () => slots.register(
        { name: "conversation.input.left", id: "simple-memory" },
        (props) => {
          const inputState = props.input;
          const currentDraft = inputState && typeof inputState.draft === "string" ? inputState.draft : "";
          // 同步当前会话 id（设置页/浏览器用 session 定位项目记忆）
          const sessionId = typeof props.sessionId === "string" ? props.sessionId : null;
          react.useEffect(() => {
            if (snapshot.sessionId !== sessionId) emit({ sessionId });
          }, [sessionId]);
          const snap = react.useSyncExternalStore(subscribe, getSnapshot);
          const [menuOpen, setMenuOpen] = react.useState(false);
          const wrapRef = react.useRef(null);
          // 点击组件外 → 菜单与浏览浮层一并收起（2026-09-12）
          react.useEffect(() => {
            if (!menuOpen && !snap.browserOpen) return undefined;
            function onDocDown(e) {
              if (wrapRef.current !== null && !wrapRef.current.contains(e.target)) {
                setMenuOpen(false);
                if (snapshot.browserOpen) closeMemoryBrowser();
              }
            }
            document.addEventListener("mousedown", onDocDown);
            return () => document.removeEventListener("mousedown", onDocDown);
          }, [menuOpen, snap.browserOpen]);
          function pushPrompt(text) {
            const inputActions = props.inputActions;
            if (inputActions && typeof inputActions.setDraft === "function") {
              inputActions.setDraft(currentDraft === "" ? text : currentDraft + "\n" + text);
            }
            setMenuOpen(false);
          }
          function doBrowse() {
            setMenuOpen(false);
            if (snap.browserOpen) closeMemoryBrowser(); else browseMemory();
          }
          // 按钮切换（2026-09-12 用户要求）：浮层开着 → 再点按钮即收起；否则开关菜单（叉照旧保留）
          function onButtonClick() {
            if (snap.browserOpen) { setMenuOpen(false); closeMemoryBrowser(); return; }
            setMenuOpen(!menuOpen);
          }
          const items = [
            { key: "recall", t: "联想", d: "回顾本轮，列出值得记的", run: () => pushPrompt(PROMPT_RECALL) },
            { key: "promote", t: "升格", d: "整理两个池子，提议去向", run: () => pushPrompt(PROMPT_PROMOTE) },
            { key: "browse", t: "查记忆库", d: "列表 + 搜索 + 读全文", run: doBrowse },
            { key: "dream", t: "做梦", d: "随机组合记忆，找跨界洞察", run: () => pushPrompt(PROMPT_DREAM) },
          ];
          return react.createElement("span", { className: "smem-wrap", ref: wrapRef },
            react.createElement("button", {
              type: "button", className: "smem-btn",
              onClick: onButtonClick,
              title: "记忆：联想 / 升格 / 查记忆库 / 做梦", "aria-label": "记忆",
            }, MemIcon()),
            menuOpen ? react.createElement("div", { className: "smem-menu", role: "menu" },
              items.map((it) => react.createElement("button", {
                key: it.key, type: "button", className: "smem-menu-item", role: "menuitem", onClick: it.run,
              },
                react.createElement("span", { className: "t" }, it.t),
                react.createElement("span", { className: "d" }, it.d)
              ))
            ) : null,
            snap.browserOpen ? react.createElement(MemoryFloat) : null
          );
        }
      ));

      // 2. 设置侧边栏页（记忆管理）
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "dsh-simple-memory-settings", order: 30, label: "记忆" },
        () => react.createElement(MemorySettingsPage)
      ));

      // 3. 插件卡片（配置项区，与侧边栏页同内容）
      injectCardCss();
      slots.inject("settings.plugin.item", () => slots.register(
        { name: "settings.plugin.item", key: "simple-memory", id: "simple-memory" },
        () => react.createElement(SettingsCardShell, { title: "记忆", desc: "侧车 Markdown 记忆：索引注入、一键记录与检索" },
          react.createElement(MemorySettingsPage, { inCard: true }))
      ));

      console.log("[dsh-simple-memory] client loaded");
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
