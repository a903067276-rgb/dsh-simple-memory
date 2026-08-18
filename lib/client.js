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
     * 1. 记忆按钮（conversation.input.left）：点击往输入框塞"记忆流程指令"，
     *    模型走规范流程（回顾→提议→确认→写入→产出物→commit）。
     * 2. 设置侧边栏页（settings.section）：记忆管理页（状态/初始化/浏览）。
     * 3. 插件卡片（settings.plugin.item）：同管理页（配置项区入口）。
     * 4. 记忆浏览器（shell.overlay）：列活跃记忆 + 点开读。
     */

    // ── 记忆流程指令（固定模板，100% 走规范流程）──
    const INSTRUCTION =
      "现在执行记忆流程（按全局 AGENTS.md「记忆规范」）：① 回顾本轮对话，列出值得记的内容（决策/踩坑/新约定/偏好）② 逐条提议，等用户确认 ③ 确认后调用 memory-write 工具写入 ④ 贴出产出物 ⑤ 顺手 git commit（mem: 记 xxx）";

    // ── 模块级共享状态（按钮/管理页/浏览器跨组件同步）──
    let snapshot = { browserOpen: false, status: null, files: null, content: null, busy: false };
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

    // ── 样式（幂等注入，全部 dsw token）──
    if (typeof document !== "undefined" && !document.getElementById("dsh-simple-memory-style")) {
      const tag = document.createElement("style");
      tag.id = "dsh-simple-memory-style";
      tag.textContent = [
        ".smem-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;padding:0;}",
        ".smem-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".smem-btn:disabled{opacity:.5;cursor:default;}",
        ".smem-panel{position:fixed;top:16px;right:16px;width:360px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;z-index:9999;background:var(--dsw-specific-sidebar-fill,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:10px;box-shadow:var(--dsw-shadow-lv2,0 4px 16px rgba(0,0,0,0.12));padding:14px;color:var(--dsw-alias-label-primary,#333);font-size:13px;line-height:1.6;pointer-events:auto;box-sizing:border-box;font-family:inherit;}",
        ".smem-panel h3{margin:0 0 10px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#333);}",
        ".smem-panel .row{margin:6px 0;color:var(--dsw-alias-label-secondary,#666);}",
        ".smem-panel .file{cursor:pointer;padding:4px 6px;border-radius:6px;color:var(--dsw-alias-label-primary,#333);}",
        ".smem-panel .file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".smem-panel .content{white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-border-l1,#f2f2f2);border-radius:6px;padding:8px;margin-top:8px;color:var(--dsw-alias-label-secondary,#555);font-size:12px;max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,#e5e5e5);}",
        ".smem-card{background:var(--dsw-specific-sidebar-fill,#fff);border:1px solid var(--dsw-alias-border-l1,#e5e5e5);border-radius:10px;padding:12px;color:var(--dsw-alias-label-primary,#333);font-size:13px;line-height:1.6;}",
        ".smem-card h3{margin:0 0 8px;font-size:14px;font-weight:600;}",
        ".smem-card .row{margin:5px 0;color:var(--dsw-alias-label-secondary,#666);}",
        ".smem-card .btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-primary,#333);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;margin:4px 4px 0 0;}",
        ".smem-card .btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
        ".smem-card .btn:disabled{opacity:.5;cursor:default;}",
        ".smem-card .ok{color:var(--dsw-alias-state-success-primary,#2e9e44);}",
        ".smem-card .warn{color:var(--dsw-alias-state-warn-primary,#e8a13a);}",
        ".smem-card .err{color:var(--dsw-alias-state-error-primary,#d03050);}",
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

    // ── 记忆管理页（设置侧边栏页 / 插件卡片共用）──
    function MemorySettingsPage() {
      const snap = react.useSyncExternalStore(subscribe, getSnapshot);
      const [msg, setMsg] = react.useState(null);
      async function refresh() {
        emit({ busy: true });
        try {
          const st = await host.call("memory-status");
          emit({ status: st });
        } catch (e) { emit({ status: { ok: false, error: String(e && e.message ? e.message : e) } }); }
        emit({ busy: false });
      }
      react.useEffect(() => { refresh(); }, []);
      async function init() {
        setMsg(null);
        try {
          const r = await host.call("memory-init");
          setMsg(r && r.ok ? { kind: "ok", text: r.message || "完成" } : { kind: "err", text: (r && r.error) || "失败" });
          refresh();
        } catch (e) { setMsg({ kind: "err", text: String(e && e.message ? e.message : e) }); }
      }
      async function browse() {
        emit({ busy: true });
        try {
          const r = await host.call("memory-list");
          emit({ files: r && r.ok ? r : null, content: null, browserOpen: true });
        } catch (e) { emit({ files: null, content: null, browserOpen: true }); }
        emit({ busy: false });
      }
      const st = snap.status;
      const busy = snap.busy;
      return react.createElement("div", { className: "smem-card", style: { maxWidth: 560 } },
        react.createElement("h3", null, "记忆管理"),
        react.createElement("div", { className: "row" },
          st && st.ok
            ? react.createElement("span", null, "全局活跃 " + st.globalIndexCount + " 条 · 升格暂存池 " + st.stagingCount + " 条")
            : react.createElement("span", { className: "err" }, (st && st.error) || "状态读取中…")
        ),
        react.createElement("div", { className: "row" }, "记忆根目录：~/Documents/DSH/memory/（配置项，跨平台可改）"),
        react.createElement("div", null,
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: init }, "初始化记忆仓库"),
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: browse }, "浏览记忆"),
          react.createElement("button", { type: "button", className: "btn", disabled: busy, onClick: refresh }, "刷新状态")
        ),
        msg ? react.createElement("div", { className: "row " + (msg.kind === "ok" ? "ok" : "err") }, msg.text) : null,
        react.createElement("div", { className: "row", style: { marginTop: 10, fontSize: 12 } },
          "用法：输入框的灯泡按钮一键走记忆流程；记忆规范见全局 AGENTS.md「记忆规范」段落。"
        )
      );
    }

    // ── 记忆浏览器（overlay）──
    function MemoryBrowser() {
      const snap = react.useSyncExternalStore(subscribe, getSnapshot);
      if (!snap.browserOpen) return null;
      async function openFile(name) {
        try {
          const r = await host.call("memory-read", { name });
          emit({ content: r && r.ok ? r.content : "读取失败：" + ((r && r.error) || "") });
        } catch (e) { emit({ content: "读取失败：" + String(e && e.message ? e.message : e) }); }
      }
      const files = snap.files && snap.files.ok ? snap.files : null;
      const sections = [];
      if (files) {
        if (files.project && files.project.length > 0) {
          sections.push(react.createElement("div", { key: "p", className: "row" }, "项目 memory/"));
          files.project.forEach((f) => sections.push(
            react.createElement("div", { key: "p" + f, className: "file", onClick: () => openFile("memory/" + f) }, "📄 " + f)
          ));
        }
        if (files.global && files.global.length > 0) {
          sections.push(react.createElement("div", { key: "g", className: "row" }, "全局 common/"));
          files.global.forEach((f) => sections.push(
            react.createElement("div", { key: "g" + f, className: "file", onClick: () => openFile("~/Documents/DSH/memory/common/" + f) }, "📄 " + f)
          ));
        }
        if ((!files.project || files.project.length === 0) && (!files.global || files.global.length === 0)) {
          sections.push(react.createElement("div", { key: "e", className: "row" }, "暂无记忆。点输入框的记忆按钮或让 agent 记一条。"));
        }
      } else {
        sections.push(react.createElement("div", { key: "e", className: "row" }, "加载中…"));
      }
      return react.createElement("div", { className: "smem-panel" },
        react.createElement("h3", null, "记忆浏览"),
        sections,
        snap.content !== null
          ? react.createElement("div", { key: "c", className: "content" }, snap.content)
          : null,
        react.createElement("div", { className: "row", style: { marginTop: 10 } },
          react.createElement("button", {
            type: "button", className: "smem-btn", style: { width: "auto", padding: "0 10px" },
            onClick: () => emit({ browserOpen: false, content: null }),
          }, "关闭")
        )
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;

      // 1. 记忆按钮：点击 → 往输入框塞记忆流程指令
      slots.inject("conversation.input.left", () => slots.register(
        { name: "conversation.input.left", id: "simple-memory" },
        (props) => {
          const inputState = props.input;
          const currentDraft = inputState && typeof inputState.draft === "string" ? inputState.draft : "";
          function onClick() {
            const inputActions = props.inputActions;
            if (inputActions && typeof inputActions.setDraft === "function") {
              inputActions.setDraft(currentDraft === "" ? INSTRUCTION : currentDraft + "\n" + INSTRUCTION);
            }
          }
          return react.createElement("button", {
            type: "button", className: "smem-btn", onClick,
            title: "记忆：一键走规范记忆流程", "aria-label": "记忆",
          }, MemIcon());
        }
      ));

      // 2. 设置侧边栏页（记忆管理）
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "simple-memory-settings", order: 30, label: "记忆" },
        () => react.createElement(MemorySettingsPage)
      ));

      // 3. 插件卡片（配置项区，与侧边栏页同内容）
      slots.inject("settings.plugin.item", () => slots.register(
        { name: "settings.plugin.item", key: "simple-memory" },
        () => react.createElement(MemorySettingsPage)
      ));

      // 4. 记忆浏览器（overlay）
      slots.inject("shell.overlay", () => slots.register(
        { name: "shell.overlay", id: "simple-memory-browser" },
        () => react.createElement(MemoryBrowser)
      ));

      console.log("[dsh-simple-memory] client loaded");
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
