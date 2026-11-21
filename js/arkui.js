/* ===== js/arkui.js ===== */
/* ============================================================
 * arkui.js · ArkUI 风格声明式 UI 框架（网页运行时）
 * ------------------------------------------------------------
 * 让闪星卡的界面代码以接近鸿蒙 ArkTS/ArkUI 的声明式、组件化
 * 形式编写，最终仍渲染为浏览器 DOM。界面逻辑与渲染方式对齐
 * ArkUI（Column/Row/Stack/Text/Button、build()、响应式 state、
 * 链式通用属性），为日后把本项目迁移到鸿蒙原生应用铺路。
 *
 * 用法示例：
 *   class Counter extends ArkUI.Component {
 *     build() {
 *       return ArkUI.Column({ space: 12 }).padding(16).children([
 *         ArkUI.Text(String(this.state.count)).fontSize(28).fontWeight(600),
 *         ArkUI.Button('+1', { type: 'primary' })
 *           .onClick(() => { this.state.count += 1; })
 *       ]);
 *     }
 *   }
 *   new Counter().mount(document.getElementById('app'));
 * ============================================================ */
(function (global) {
  'use strict';

  // ------------------------------------------------------------ 工具
  function isStr(v) { return typeof v === 'string'; }
  function isNum(v) { return typeof v === 'number'; }
  function toCssNum(v) { return isNum(v) ? v + 'px' : v; }

  function flatten(arr) {
    const out = [];
    (function walk(a) {
      if (a == null || a === false) return;
      if (Array.isArray(a)) { a.forEach(walk); return; }
      out.push(a);
    })(arr);
    return out;
  }

  // padding / margin：单值 | '12px 16px' | {top,right,bottom,left}
  function spacing(v) {
    if (isNum(v)) return v + 'px';
    if (isStr(v)) return v;
    if (v && typeof v === 'object') {
      const t = v.top != null ? toCssNum(v.top) : '0';
      const r = v.right != null ? toCssNum(v.right) : '0';
      const b = v.bottom != null ? toCssNum(v.bottom) : '0';
      const l = v.left != null ? toCssNum(v.left) : '0';
      return t + ' ' + r + ' ' + b + ' ' + l;
    }
    return '';
  }

  // ------------------------------------------------------------ 元素节点
  class El {
    constructor(tag, text) {
      this.tag = tag;
      this._style = {};
      this._attrs = {};
      this._events = {};
      this._children = [];
      this._html = null;
      this._text = text != null ? String(text) : null;
    }

    // ---- 尺寸 / 间距（对齐 ArkUI 通用属性）----
    width(v) { this._style.width = toCssNum(v); return this; }
    height(v) { this._style.height = toCssNum(v); return this; }
    minWidth(v) { this._style['min-width'] = toCssNum(v); return this; }
    maxWidth(v) { this._style['max-width'] = toCssNum(v); return this; }
    minHeight(v) { this._style['min-height'] = toCssNum(v); return this; }
    maxHeight(v) { this._style['max-height'] = toCssNum(v); return this; }
    padding(v) { this._style.padding = spacing(v); return this; }
    paddingTop(v) { this._style['padding-top'] = toCssNum(v); return this; }
    paddingRight(v) { this._style['padding-right'] = toCssNum(v); return this; }
    paddingBottom(v) { this._style['padding-bottom'] = toCssNum(v); return this; }
    paddingLeft(v) { this._style['padding-left'] = toCssNum(v); return this; }
    margin(v) { this._style.margin = spacing(v); return this; }
    marginTop(v) { this._style['margin-top'] = toCssNum(v); return this; }
    marginRight(v) { this._style['margin-right'] = toCssNum(v); return this; }
    marginBottom(v) { this._style['margin-bottom'] = toCssNum(v); return this; }
    marginLeft(v) { this._style['margin-left'] = toCssNum(v); return this; }
    gap(v) { this._style.gap = toCssNum(v); return this; }

    // ---- 弹性布局 ----
    display(v) { this._style.display = v; return this; }
    flex(v) { this._style.flex = v; return this; }
    flexGrow(v) { this._style['flex-grow'] = v; return this; }
    flexShrink(v) { this._style['flex-shrink'] = v; return this; }
    flexBasis(v) { this._style['flex-basis'] = toCssNum(v); return this; }
    flexDirection(v) { this._style['flex-direction'] = v; return this; }
    flexWrap(v) { this._style['flex-wrap'] = v; return this; }
    alignItems(v) { this._style['align-items'] = v; return this; }
    alignSelf(v) { this._style['align-self'] = v; return this; }
    justifyContent(v) { this._style['justify-content'] = v; return this; }

    // ---- 外观 ----
    backgroundColor(v) { this._style['background-color'] = v; return this; }
    color(v) { this._style.color = v; return this; }
    borderRadius(v) { this._style['border-radius'] = toCssNum(v); return this; }
    border(v) { this._style.border = v; return this; }
    borderTop(v) { this._style['border-top'] = v; return this; }
    borderBottom(v) { this._style['border-bottom'] = v; return this; }
    borderLeft(v) { this._style['border-left'] = v; return this; }
    borderRight(v) { this._style['border-right'] = v; return this; }
    boxShadow(v) { this._style['box-shadow'] = v; return this; }
    opacity(v) { this._style.opacity = v; return this; }
    cursor(v) { this._style.cursor = v; return this; }
    overflow(v) { this._style.overflow = v; return this; }
    overflowX(v) { this._style['overflow-x'] = v; return this; }
    overflowY(v) { this._style['overflow-y'] = v; return this; }
    objectFit(v) { this._style['object-fit'] = v; return this; }
    background(v) { this._style.background = v; return this; }
    backgroundImage(v) { this._style['background-image'] = v; return this; }
    backgroundSize(v) { this._style['background-size'] = v; return this; }
    backgroundPosition(v) { this._style['background-position'] = v; return this; }
    position(v) { this._style.position = v; return this; }
    top(v) { this._style.top = toCssNum(v); return this; }
    right(v) { this._style.right = toCssNum(v); return this; }
    bottom(v) { this._style.bottom = toCssNum(v); return this; }
    left(v) { this._style.left = toCssNum(v); return this; }
    zIndex(v) { this._style['z-index'] = v; return this; }
    inset(v) { this._style.inset = toCssNum(v); return this; }

    // ---- 文本 ----
    fontSize(v) { this._style['font-size'] = toCssNum(v); return this; }
    fontColor(v) { this._style.color = v; return this; }
    fontWeight(v) { this._style['font-weight'] = v; return this; }
    textAlign(v) { this._style['text-align'] = v; return this; }
    lineHeight(v) { this._style['line-height'] = toCssNum(v); return this; }
    letterSpacing(v) { this._style['letter-spacing'] = toCssNum(v); return this; }
    whiteSpace(v) { this._style['white-space'] = v; return this; }
    textOverflow(v) { this._style['text-overflow'] = v; return this; }
    wordBreak(v) { this._style['word-break'] = v; return this; }
    textDecoration(v) { this._style['text-decoration'] = v; return this; }

    // ---- 属性 ----
    id(v) { this._attrs.id = v; return this; }
    cls(v) { if (v) this._attrs.class = v; return this; }
    title(v) { if (v != null) this._attrs.title = String(v); return this; }
    role(v) { this._attrs.role = v; return this; }
    tabindex(v) { this._attrs.tabindex = v; return this; }
    type(v) { this._attrs.type = v; return this; }
    name(v) { this._attrs.name = v; return this; }
    src(v) { this._attrs.src = v; return this; }
    alt(v) { this._attrs.alt = v; return this; }
    href(v) { this._attrs.href = v; return this; }
    target(v) { this._attrs.target = v; return this; }
    placeholder(v) { if (v != null) this._attrs.placeholder = String(v); return this; }
    value(v) { if (v != null) this._attrs.value = String(v); return this; }
    checked(v) { this._attrs.checked = v ? true : false; return this; }
    disabled(v) { this._attrs.disabled = v ? true : false; return this; }
    readonly(v) { this._attrs.readonly = v ? true : false; return this; }
    autofocus(v) { this._attrs.autofocus = v ? true : false; return this; }
    maxlength(v) { this._attrs.maxlength = v; return this; }
    accept(v) { this._attrs.accept = v; return this; }
    rows(v) { this._attrs.rows = v; return this; }
    cols(v) { this._attrs.cols = v; return this; }
    for_(v) { this._attrs.for = v; return this; }
    // data-* 委托属性（事件委托核心：data-act / data-i / data-rating / data-src ...）
    attr(name, value) {
      if (value == null || value === false) delete this._attrs['data-' + name];
      else this._attrs['data-' + name] = String(value);
      return this;
    }
    act(v) { return this.attr('act', v); }
    // 任意内联样式
    style(k, v) { this._style[k] = v; return this; }

    // ---- 事件 ----
    onClick(fn) { this._events.click = fn; return this; }
    onInput(fn) { this._events.input = fn; return this; }
    onChange(fn) { this._events.change = fn; return this; }
    onFocus(fn) { this._events.focus = fn; return this; }
    onBlur(fn) { this._events.blur = fn; return this; }
    onKeydown(fn) { this._events.keydown = fn; return this; }
    onKeyup(fn) { this._events.keyup = fn; return this; }
    onMouseenter(fn) { this._events.mouseenter = fn; return this; }
    onMouseleave(fn) { this._events.mouseleave = fn; return this; }

    // ---- 内容 ----
    children(list) { this._children = flatten(list); return this; }
    child(v) { this._children.push(v); return this; }
    html(h) { this._html = h; this._children = []; this._text = null; return this; }
    text(t) { this._text = String(t); this._children = []; this._html = null; return this; }

    // 渲染为真实 DOM
    toNode() {
      // svg 必须用 SVG 命名空间创建，否则 innerHTML 里的 <path> 无法渲染（声明式图标全靠它）
      const node = this.tag === 'svg'
        ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        : document.createElement(this.tag);
      for (const k in this._attrs) {
        const v = this._attrs[k];
        if (v == null || v === false) continue;
        node.setAttribute(k, v === true ? '' : v);
      }
      let css = '';
      for (const k in this._style) { if (this._style[k] != null && this._style[k] !== '') css += k + ':' + this._style[k] + ';'; }
      if (css) node.setAttribute('style', css);
      for (const k in this._events) node.addEventListener(k, this._events[k]);
      if (this._html != null) {
        node.innerHTML = this._html;
      } else if (this._text != null) {
        node.textContent = this._text;
      } else {
        for (let i = 0; i < this._children.length; i++) node.appendChild(toNode(this._children[i]));
      }
      return node;
    }
  }

  // ------------------------------------------------------------ 通用属性注入
  function applyOpts(e, opts) {
    if (!opts) return e;
    if (opts.space != null) e.gap(opts.space);
    if (opts.gap != null) e.gap(opts.gap);
    if (opts.padding != null) e.padding(opts.padding);
    if (opts.margin != null) e.margin(opts.margin);
    if (opts.alignItems != null) e.alignItems(opts.alignItems);
    if (opts.justifyContent != null) e.justifyContent(opts.justifyContent);
    if (opts.align != null) e.alignItems(opts.align);
    if (opts.justify != null) e.justifyContent(opts.justify);
    if (opts.flex != null) e.flex(opts.flex);
    if (opts.flexGrow != null) e.flexGrow(opts.flexGrow);
    if (opts.width != null) e.width(opts.width);
    if (opts.height != null) e.height(opts.height);
    if (opts.minWidth != null) e.minWidth(opts.minWidth);
    if (opts.maxWidth != null) e.maxWidth(opts.maxWidth);
    if (opts.bg != null) e.backgroundColor(opts.bg);
    if (opts.background != null) e.background(opts.background);
    if (opts.color != null) e.color(opts.color);
    if (opts.radius != null) e.borderRadius(opts.radius);
    if (opts.border != null) e.border(opts.border);
    if (opts.shadow != null) e.boxShadow(opts.shadow);
    if (opts.opacity != null) e.opacity(opts.opacity);
    if (opts.overflow != null) e.overflow(opts.overflow);
    if (opts.position != null) e.position(opts.position);
    if (opts.top != null) e.top(opts.top);
    if (opts.right != null) e.right(opts.right);
    if (opts.bottom != null) e.bottom(opts.bottom);
    if (opts.left != null) e.left(opts.left);
    if (opts.zIndex != null) e.zIndex(opts.zIndex);
    if (opts.fontSize != null) e.fontSize(opts.fontSize);
    if (opts.fontColor != null) e.fontColor(opts.fontColor);
    if (opts.fontWeight != null) e.fontWeight(opts.fontWeight);
    if (opts.textAlign != null) e.textAlign(opts.textAlign);
    if (opts.lineHeight != null) e.lineHeight(opts.lineHeight);
    if (opts.cursor != null) e.cursor(opts.cursor);
    if (opts.cls) e.cls(opts.cls);
    if (opts.id) e.id(opts.id);
    if (opts.title != null) e.title(opts.title);
    if (opts.onClick) e.onClick(opts.onClick);
    if (opts.onInput) e.onInput(opts.onInput);
    if (opts.onChange) e.onChange(opts.onChange);
    if (opts.act) e.act(opts.act);
    if (opts.attr) { for (const k in opts.attr) e.attr(k, opts.attr[k]); }
    if (opts.style) { for (const k in opts.style) e.style(k, opts.style[k]); }
    return e;
  }

  // ------------------------------------------------------------ 内置组件
  function Column(opts) { return applyOpts(new El('div').display('flex').flexDirection('column'), opts); }
  function Row(opts) { return applyOpts(new El('div').display('flex').flexDirection('row').alignItems('center'), opts); }
  function Stack(opts) { return applyOpts(new El('div').position('relative'), opts); }
  function Flex(opts) { return applyOpts(new El('div').display('flex'), opts); }
  function Text(content, opts) { return applyOpts(new El('span', content), opts); }
  function Span(content, opts) { return applyOpts(new El('span', content), opts); }
  function Paragraph(content, opts) { return applyOpts(new El('p', content), opts); }

  function Button(label, opts) {
    opts = opts || {};
    const type = opts.type || 'default';
    let cls = 'btn';
    if (type === 'primary') cls += ' btn-primary';
    else if (type === 'danger') cls += ' btn-danger';
    else if (type === 'ghost') cls += ' btn-ghost';
    else if (type === 'text') cls += ' btn-text';
    else if (type === 'soft') cls += ' btn-soft';
    const e = new El('button', label).cls(cls);
    return applyOpts(e, opts);
  }

  function Image(src, opts) { const e = new El('img').src(src).alt(''); return applyOpts(e, opts); }
  function Divider(opts) { const e = new El('div').cls('divider'); return applyOpts(e, opts); }
  function Spacer(opts) { const e = new El('div').cls('spacer'); return applyOpts(e, opts); }
  function List(opts) { const e = new El('div').cls('ark-list').display('flex').flexDirection('column'); return applyOpts(e, opts); }
  function ListItem(opts) { return applyOpts(new El('div').cls('ark-list-item'), opts); }
  function Badge(content, opts) { return applyOpts(new El('span', content).cls('badge'), opts); }
  function Chip(content, opts) { return applyOpts(new El('span', content).cls('chip'), opts); }
  function Input(opts) { const e = new El('input'); return applyOpts(e, opts); }
  function TextArea(opts) { const e = new El('textarea'); return applyOpts(e, opts); }
  function Select(opts) { const e = new El('select'); return applyOpts(e, opts); }
  function Option(content, opts) { return applyOpts(new El('option', content), opts); }
  function Label(content, opts) { return applyOpts(new El('label', content), opts); }

  // 原始 HTML 片段（SVG 图标、头像等；注意内容需可信）
  function Html(html) { return new El('span').html(html); }
  function RawNode(node) { return node; }

  // ------------------------------------------------------------ 条件 / 循环
  function If(cond, a, b) { return cond ? a : (b == null ? null : b); }
  function ForEach(arr, fn) {
    if (!arr) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) out.push(fn(arr[i], i));
    return flatten(out);
  }

  // ------------------------------------------------------------ 组件基类
  class Component {
    constructor(props) {
      this.props = props || {};
      this.state = this._reactive({});
      this._host = null;
      this._root = null;
      this._pending = false;
      this._disposed = false;
    }

    _reactive(obj) {
      const self = this;
      return new Proxy(obj, {
        set: function (t, k, v) {
          if (t[k] === v) return true;
          t[k] = v;
          self._schedule();
          return true;
        },
        deleteProperty: function (t, k) { delete t[k]; self._schedule(); return true; }
      });
    }

    _schedule() {
      if (this._pending || this._disposed) return;
      this._pending = true;
      const self = this;
      Promise.resolve().then(function () { self._pending = false; self.invalidate(); });
    }

    // 子类覆写：返回 El / Component / 字符串 / 数组
    build() { return null; }

    render() { return this.build(); }

    mount(container) {
      this._host = container;
      this._renderInto();
      this._mounted = true;
      return this;
    }

    _renderInto() {
      if (!this._host) return;
      const vnode = this.render();
      this._host.innerHTML = '';
      this._host.appendChild(toNode(vnode));
    }

    invalidate() {
      if (!this._host || this._disposed) return;
      this._renderInto();
    }

    dispose() {
      this._disposed = true;
      if (this._host) this._host.innerHTML = '';
      this._host = null;
    }
  }

  // ------------------------------------------------------------ 树 → DOM
  function toNode(vnode) {
    if (vnode == null || vnode === false) return document.createTextNode('');
    if (Array.isArray(vnode)) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < vnode.length; i++) frag.appendChild(toNode(vnode[i]));
      return frag;
    }
    if (isStr(vnode)) return document.createTextNode(vnode);
    if (isNum(vnode)) return document.createTextNode(String(vnode));
    if (vnode instanceof El) return vnode.toNode();
    if (vnode instanceof Component) {
      const host = document.createElement('div');
      vnode.mount(host);
      return host.firstChild || host;
    }
    if (vnode instanceof Node) return vnode;
    return document.createTextNode(String(vnode));
  }

  // ------------------------------------------------------------ 导出
  const ArkUI = {
    Component: Component,
    El: El,
    Column: Column, Row: Row, Stack: Stack, Flex: Flex,
    Text: Text, Span: Span, Paragraph: Paragraph,
    Button: Button, Image: Image, Divider: Divider, Spacer: Spacer,
    List: List, ListItem: ListItem, Badge: Badge, Chip: Chip,
    Input: Input, TextArea: TextArea, Select: Select, Option: Option, Label: Label,
    Html: Html, RawNode: RawNode,
    If: If, ForEach: ForEach,
    toNode: toNode, spacing: spacing, flatten: flatten
  };

  global.ArkUI = ArkUI;
})(window);


