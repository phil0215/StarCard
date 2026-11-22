/* ===== js/ui.js ===== */
/**
 * 闪星卡（StarCard）UI 渲染层 · 返回 HTML 字符串
 * 仅依赖 window.FC，不依赖 app.js（动作由 app.js 的事件委托处理）。
 * 图标：全部为内联 SVG 线性图标，无表情符号。
 */
(function (global) {
  'use strict';
  const FC = global.FC;
  const A = global.ArkUI;

  function esc(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------- 图标库
  const IC = {
    cards: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M5 15.7A2.7 2.7 0 0 1 3 13V5.7A2.7 2.7 0 0 1 5.7 3H13A2.7 2.7 0 0 1 15.7 5"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9.5h18"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />',
    grid: '<rect width="7" height="7" x="3" y="3" rx="2" /> <rect width="7" height="7" x="14" y="3" rx="2" /> <rect width="7" height="7" x="14" y="14" rx="2" /> <rect width="7" height="7" x="3" y="14" rx="2" />',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" />',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /> <circle cx="12" cy="12" r="3" />',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />',
    plus: '<path d="M5 12h14" /> <path d="M12 5v14" />',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <polyline points="7 10 12 15 17 10" /> <line x1="12" x2="12" y1="15" y2="3" />',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <polyline points="17 8 12 3 7 8" /> <line x1="12" x2="12" y1="3" y2="15" />',
    trash: '<path d="M3 6h18" /> <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /> <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /> <line x1="10" x2="10" y1="11" y2="17" /> <line x1="14" x2="14" y1="11" y2="17" />',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="2" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" />',
    check: '<path d="M20 6 9 17l-5-5" />',
    checkCircle: '<circle cx="12" cy="12" r="10" /> <path d="m9 12 2 2 4-4" />',
    closeCircle: '<circle cx="12" cy="12" r="10" /> <path d="m15 9-6 6" /> <path d="m9 9 6 6" />',
    chevronRight: '<path d="m9 18 6-6-6-6" />',
    chevronLeft: '<path d="m15 18-6-6 6-6" />',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <path d="M16 3.13a4 4 0 0 1 0 7.75" />',
    link: '<path d="M9 17H7A5 5 0 0 1 7 7h2" /> <path d="M15 7h2a5 5 0 1 1 0 10h-2" /> <line x1="8" x2="16" y1="12" y2="12" />',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <circle cx="9" cy="7" r="4" /> <line x1="19" x2="19" y1="8" y2="14" /> <line x1="22" x2="16" y1="11" y2="11" />',
    package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /> <path d="M12 22V12" /> <path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7" /> <path d="m7.5 4.27 9 5.15" />',
    comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />',
    key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /> <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /> <path d="M4 22h16" /> <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /> <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /> <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />',
    rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" />',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /> <path d="M20 3v4" /> <path d="M22 5h-4" /> <path d="M4 17v2" /> <path d="M5 18H3" />',
    empty: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /> <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />',
    play: '<polygon points="6 3 20 12 6 21 6 3" />',
    clock: '<circle cx="12" cy="12" r="10" /> <polyline points="12 6 12 12 16 14" />',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" />',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /> <polyline points="16 17 21 12 16 7" /> <line x1="21" x2="9" y1="12" y2="12" />',
    search: '<circle cx="11" cy="11" r="8" /> <path d="m21 21-4.3-4.3" />',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /> <line x1="4" x2="4" y1="22" y2="15" />',
    pause: '<rect x="14" y="4" width="4" height="16" rx="2" /> <rect x="6" y="4" width="4" height="16" rx="2" />',
    info: '<circle cx="12" cy="12" r="10" /> <path d="M12 16v-4" /> <path d="M12 8h.01" />',
    undo: '<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /> <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /> <circle cx="9" cy="9" r="2" /> <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
    music: '<path d="M9 18V5l12-2v13" /> <circle cx="6" cy="18" r="3" /> <circle cx="18" cy="16" r="3" />',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" />',
    x: '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
    folderOpen: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />',
    target: '<circle cx="12" cy="12" r="10" /> <circle cx="12" cy="12" r="6" /> <circle cx="12" cy="12" r="2" />',
    speaker: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M16 9a5 5 0 0 1 0 6" /> <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /> <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /> <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />',
    chevronDown: '<path d="m6 9 6 6 6-6" />',
    chevronUp: '<path d="m18 15-6-6-6 6" />',
    more: '<circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" />',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5" /> <path d="M9.5 4v16" />',
    table: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />',
    merge: '<circle cx="18" cy="18" r="3" /> <circle cx="6" cy="6" r="3" /> <path d="M6 21V9a9 9 0 0 0 9 9" />',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0" /> <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />',
    keyboard: '<path d="M10 8h.01" /> <path d="M12 12h.01" /> <path d="M14 8h.01" /> <path d="M16 12h.01" /> <path d="M18 8h.01" /> <path d="M6 8h.01" /> <path d="M7 16h10" /> <path d="M8 12h.01" /> <rect width="20" height="16" x="2" y="4" rx="2" />',
    sun: '<circle cx="12" cy="12" r="4" /> <path d="M12 2v2" /> <path d="M12 20v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="m17.66 17.66 1.41 1.41" /> <path d="M2 12h2" /> <path d="M20 12h2" /> <path d="m6.34 17.66-1.41 1.41" /> <path d="m19.07 4.93-1.41 1.41" />',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" />',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /> <path d="M7 11V7a5 5 0 0 1 10 0v4" />',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /> <circle cx="12" cy="13" r="3" />',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2" /> <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />',
    phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2" /> <path d="M12 18h.01" />',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" /> <path d="m21.854 2.147-10.94 10.939" />',
    cmd: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />',
    robot: '<path d="M12 8V4H8" /> <rect width="16" height="12" x="4" y="8" rx="2" /> <path d="M2 14h2" /> <path d="M20 14h2" /> <path d="M15 13v2" /> <path d="M9 13v2" />',
    calendar: '<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" /> <path d="M8 14h.01" /> <path d="M12 14h.01" /> <path d="M16 14h.01" /> <path d="M8 18h.01" /> <path d="M12 18h.01" /> <path d="M16 18h.01" />',
    sliders: '<line x1="21" x2="14" y1="4" y2="4" /> <line x1="10" x2="3" y1="4" y2="4" /> <line x1="21" x2="12" y1="12" y2="12" /> <line x1="8" x2="3" y1="12" y2="12" /> <line x1="21" x2="16" y1="20" y2="20" /> <line x1="12" x2="3" y1="20" y2="20" /> <line x1="14" x2="14" y1="2" y2="6" /> <line x1="8" x2="8" y1="10" y2="14" /> <line x1="16" x2="16" y1="18" y2="22" />',
    huawei: '<g fill="currentColor" stroke="none" transform="translate(12 12)"><ellipse cx="0" cy="-6.4" rx="2" ry="4.3"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(45)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(90)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(135)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(180)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(225)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(270)"/><ellipse cx="0" cy="-6.4" rx="2" ry="4.3" transform="rotate(315)"/></g>'
  };

  function icon(name, size) {
    return '<svg class="ic' + (size ? ' ' + size : '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
      (IC[name] || IC.card) + '</svg>';
  }

  // 火苗图标：未打卡 = 统一描边图标；已打卡 = 渐变实心 + 内焰，配合 CSS 燃烧动画
  const FLAME_PATH = 'M8.6 14.4A2.4 2.4 0 0 0 11 12c0-1.3-.5-1.9-1-2.9-1-2.1-.2-3.9 2-5.7.5 2.4 1.9 4.7 3.8 6.2 1.9 1.5 2.9 3.4 2.9 5.3a6.7 6.7 0 1 1-13.4 0c0-1.1.4-2.2 1-2.9a2.4 2.4 0 0 0 2.3 2.4z';
  function flameSvgHtml(size) {
    return '<svg class="ic ' + (size || 'i18') + ' sm-fire" viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><linearGradient id="smFireGrad" x1="0" y1="1" x2="0" y2="0">' +
      '<stop offset="0" stop-color="#FF2D1F"/><stop offset=".45" stop-color="#FF6A12"/><stop offset="1" stop-color="#FFC23A"/>' +
      '</linearGradient></defs>' +
      '<path class="sm-fire-outer" fill="url(#smFireGrad)" stroke="none" d="' + FLAME_PATH + '"/>' +
      '<g transform="translate(12.6 15) scale(.44) translate(-12.6 -15)">' +
      '<path class="sm-fire-inner" fill="#FFE9A3" stroke="none" opacity=".92" d="' + FLAME_PATH + '"/></g>' +
      '</svg>';
  }
  function flameIcon(size, lit) {
    return lit ? flameSvgHtml(size) : icon('flame', size);
  }
  function flameEl(size, lit) {
    if (!lit) return iconEl('flame', size);
    const e = new A.El('svg');
    e._attrs.viewBox = '0 0 24 24';
    e._attrs['aria-hidden'] = 'true';
    e._attrs.class = 'ic ' + (size || 'i18') + ' sm-fire';
    e._html = flameSvgHtml(size).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return e;
  }

  // ============================================================
  // ArkUI 声明式基础组件（鸿蒙 ArkTS 风格：返回 El 树）
  // ============================================================
  function iconEl(name, size) {
    const e = new A.El('svg');
    e._attrs.viewBox = '0 0 24 24';
    e._attrs['aria-hidden'] = 'true';
    e._attrs.class = size ? 'ic ' + size : 'ic';
    e._html = IC[name] || IC.card;
    return e;
  }

  function avatarEl(acc, cls) {
    const a = acc || {};
    const n = parseInt(a.avatarColor, 10);
    const c = (n >= 0 && n <= 5) ? n : 0;
    const klass = 'ava ava-c' + c + (cls ? ' ' + cls : '');
    const imgOk = typeof a.avatarData === 'string' &&
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.avatarData);
    if (!a.loggedIn && !imgOk) {
      return new A.El('span').cls(klass + ' ava-anon');
    }
    if (imgOk) {
      return new A.El('span').cls(klass + ' ava-img').child(new A.El('img').src(a.avatarData).alt('头像'));
    }
    const label = a.nickname ? a.nickname.slice(0, 1) : '我';
    return new A.El('span', label).cls(klass);
  }

  // 通用按钮：{ label, type, size, ico, act, id, tab, title, ... } 其余数字/字符串字段转 data-*
  function btnEl(opts) {
    opts = opts || {};
    let cls = 'btn';
    if (opts.type) cls += ' btn-' + opts.type;
    if (opts.size) cls += ' btn-' + opts.size;
    const e = new A.El('button', opts.label).cls(cls);
    if (opts.act) e.attr('act', opts.act);
    const dataKeys = ['id', 'tab', 'view', 'mode', 'page', 'q', 'i', 'status', 'rating', 'flag', 'src', 'key', 'deckId', 'color'];
    for (let i = 0; i < dataKeys.length; i++) {
      const k = dataKeys[i];
      if (opts[k] != null) e.attr(k, opts[k]);
    }
    if (opts.ico) e.child(iconEl(opts.ico, opts.icoSize || 'i14'));
    if (opts.children) e._children = e._children.concat(A.flatten(opts.children));
    if (opts.title) e.title(opts.title);
    return e;
  }

  function sectionTitleEl(text, ico) {
    const e = new A.El('div', text).cls('section-title');
    if (ico) e._children.unshift(iconEl(ico, 'i14'));
    return e;
  }

  function statBoxEl(v, k, accent, ico) {
    return new A.El('div').cls('stat-box').children([
      ico ? new A.El('span').cls('stat-ico').child(iconEl(ico, 'i16')) : null,
      new A.El('div', k).cls('k'),
      new A.El('div', v).cls('v' + (accent ? ' accent' : ''))
    ]);
  }

  function titlebarEl(title, sub, opt) {
    opt = opt || {};
    const e = new A.El('header').cls('topbar');
    if (opt.back) {
      const b = new A.El('button').cls('btn-icon').attr('act', opt.back.act);
      if (opt.back.view !== undefined) b.attr('view', opt.back.view);
      b.child(iconEl('chevronLeft', 'i18'));
      b._attrs['aria-label'] = '返回';
      e.child(b);
    }
    const main = new A.El('div').cls('tb-main').child(new A.El('div').cls('topbar-t').child(new A.El('h1', title || '闪星卡')));
    if (sub) main.child(new A.El('p', sub));
    e.child(main);
    if (opt.actions) e.child(new A.El('div').cls('tb-actions').html(opt.actions));
    return e;
  }

  function emptyBoxEl(iconName, text, btnLabel, act) {
    const e = new A.El('div').cls('empty').children([
      new A.El('div').cls('empty-ico').child(iconEl(iconName, 'i32')),
      new A.El('div', text).cls('empty-t')
    ]);
    if (btnLabel) {
      e.child(new A.El('div').style('margin-top', '16px').child(btnEl({ label: btnLabel, type: 'primary', act: act })));
    }
    return e;
  }

  function tabbarEl(active, app) {
    const acc = (app && app.account) || {};
    const on = !!acc.loggedIn;
    // 浮层页面（小星/面板/通知/备份）与页签互斥：打开浮层时不高亮任何页签
    let pageActive = '';
    if (app) {
      if (app.noticePageOpen || app.backupPageOpen) pageActive = 'notice-open';
    }
    const tabActive = (pageActive || (app && app.folderId)) ? -999 : active;
    const name = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    const children = [];
    const sd = streakStat(app);
    const wk = Array.isArray(sd.week) ? sd.week : [];
    const weekOk = wk.filter(function (d) { return d.ok; }).length;
    const weekPct = wk.length ? Math.round(weekOk / wk.length * 100) : 0;
    const weekBars = new A.El('div').cls('sm-week').title('本周 ' + weekOk + '/' + wk.length + ' 天达标')
      .child(new A.El('span').cls('sm-fill').style('width', weekPct + '%'));
    children.push(new A.El('div').cls('side-brand').children([
      new A.El('span', '闪星卡').cls('sb-name'),
      new A.El('button').cls('sb-search').attr('act', 'side-search').attr('title', '搜索卡片 / 牌组')
        .attr('aria-label', '搜索').child(iconEl('search', 'i18'))
    ]));
    children.push(new A.El('div').html(streakMiniHtml(app)));
    const unread = noticeUnread(app);
    let lastGroup = '';
    for (let i = 0; i < NAV.length; i++) {
      const n = NAV[i];
      if (n.group !== lastGroup) {
        lastGroup = n.group;
        children.push(new A.El('div', lastGroup).cls('nav-label'));
      }
      if (n.kind === 'tab') {
        children.push(new A.El('a').cls('tab' + (n.tab === tabActive ? ' active' : '')).href(pageHref(n.tab)).title(n.label).children([
          new A.El('span').cls('ico').child(iconEl(n.ico, 'i20')),
          new A.El('span', n.label).cls('lab')
        ]));
      } else {
        const isOn = n.act === pageActive;
        const pe = new A.El('div').cls('tab' + (isOn ? ' active' : '')).attr('act', n.act).title(n.label).children([
          new A.El('span').cls('ico').child(iconEl(n.ico, 'i20')),
          new A.El('span', n.label).cls('lab')
        ]);
        if (n.badge && unread > 0) pe.child(new A.El('span', String(unread)).cls('side-badge'));
        children.push(pe);
      }
    }
    // —— 牌组区：与字符串版侧栏保持一致（所有牌组 + 自建文件夹 + 动作）——
    const _st = (app && app.state) || {};
    const _decks = _st.decks || [];
    children.push(new A.El('div', '牌组').cls('nav-label'));
    children.push(new A.El('div').cls('tab side-deck' + (app && app.folderId === '__all' ? ' active' : ''))
      .attr('act', 'folder-open').attr('id', '__all').title('所有牌组（' + _decks.length + ' 个）').children([
        new A.El('span').cls('ico').child(iconEl('layers', 'i20')),
        new A.El('span', '所有牌组').cls('lab')
      ]));
    const _folders = _st.folders || [];
    for (let fi = 0; fi < _folders.length; fi++) {
      const _f = _folders[fi];
      const _n = FC.decksInFolder ? FC.decksInFolder(_st, _f.id).length : 0;
      children.push(new A.El('div').cls('tab side-deck' + (app && app.folderId === _f.id ? ' active' : ''))
        .attr('act', 'folder-open').attr('id', _f.id).title(_f.name + '（' + _n + ' 个牌组）').children([
          new A.El('span').cls('ico').child(iconEl('folder', 'i20')),
          new A.El('span', _f.name).cls('lab')
        ]));
    }
    children.push(new A.El('div').cls('side-decks-actions').children([
      new A.El('button').cls('sd-act').attr('act', 'folder-new').attr('title', '新建文件夹').child(iconEl('plus', 'i18')),
      new A.El('button').cls('sd-act').attr('act', 'import-hub').attr('title', '导入词库（.srcd / .apkg / CSV）').child(iconEl('download', 'i18'))
    ]));
    // 账户行：头像 + 单行小字名字（无箭头、无副行）
    children.push(new A.El('div').cls('side-account' + (on ? ' on' : '')).attr('act', 'account-menu').title('账户菜单').children([
      avatarEl(acc, 'ava-sm'),
      new A.El('span').cls('sa-txt').child(
        new A.El('span', on ? name : '匿名用户').cls('sa-name')
      )
    ]));
    return new A.El('nav').cls('tabbar').children(children);
  }

  // 统一头像：上传图片 / 配色字母。未登录也能用（默认显示「我」），改完立刻可见。
  function avatarFace(acc, cls) {
    const a = acc || {};
    const n = parseInt(a.avatarColor, 10);
    const c = (n >= 0 && n <= 5) ? n : 0;
    const klass = 'ava ava-c' + c + (cls ? ' ' + cls : '');
    const imgOk = typeof a.avatarData === 'string' &&
      /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.avatarData);
    if (!a.loggedIn && !imgOk) {
      return '<span class="' + klass + ' ava-anon"></span>';
    }
    if (imgOk) {
      return '<span class="' + klass + ' ava-img"><img src="' + esc(a.avatarData) + '" alt="头像" /></span>';
    }
    const label = a.nickname ? a.nickname.slice(0, 1) : '我';
    return '<span class="' + klass + '">' + esc(label) + '</span>';
  }

  // 通知：只放"今天要做什么"和"该备份了"，不催、不堆营销话术
  function noticeItems(app) {
    const st = (app && app.state) || {};
    const ov = FC.smartOverview ? FC.smartOverview(st) : null;
    const list = [];
    if (ov && ov.hasData && ov.planned > 0) {
      list.push({
        id: 'today', icon: 'clock', tone: 'brand',
        title: '今天还有 ' + ov.planned + ' 张',
        desc: '新卡 ' + ov.newLeft + ' · 到期 ' + ov.due + ' · 约 ' + ov.minutes + ' 分钟',
        tab: 1, cta: '去工坊'
      });
    }
    if (ov && ov.hasData && ov.streak > 0) {
      list.push({
        id: 'streak', icon: 'zap', tone: 'amber',
        title: '已经连着学了 ' + ov.streak + ' 天',
        desc: '这是从每天的复习记录里算出来的。'
      });
    }
    const last = app && app.lastBackupAt ? app.lastBackupAt() : 0;
    const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
    if (!last) {
      list.push({
        id: 'backup', icon: 'shield', tone: 'red',
        title: '还没备份过',
        desc: '导出一份 .srcd 放到别处，换设备或清缓存都不会丢。',
        page: 'backup', cta: '去备份'
      });
    } else if (days >= 14) {
      list.push({
        id: 'backup', icon: 'shield', tone: 'amber',
        title: '上次备份是 ' + days + ' 天前',
        desc: '顺手导出一份，几十秒的事。',
        page: 'backup', cta: '去备份'
      });
    }
    return list;
  }

  function noticeUnread(app) {
    const items = noticeItems(app);
    if (!items.length) return 0;
    const read = (app && app.noticeReadAt) ? app.noticeReadAt() : 0;
    if (!read) return items.length;
    return FC.dateKey(read) === FC.dateKey(Date.now()) ? 0 : items.length;
  }

  // 隐私开关行
  function privacyRow(key, on, title, desc) {
    return '<div class="privacy-row">' +
      '<div class="pr-txt"><div class="pr-title">' + esc(title) + '</div>' +
      '<div class="pr-desc">' + esc(desc) + '</div></div>' +
      '<button class="switch' + (on ? ' on' : '') + '" data-act="privacy-toggle" data-key="' + key + '"' +
      ' role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="' + esc(title) + '">' +
      '<span class="switch-knob"></span></button></div>';
  }

  // ---------------------------------------------------------------- 导航
  // 侧栏导航：统一页签(tab)与完整页面(page)，tab 序号 0-6 保持稳定
  // 多页面：每个页签对应站点里的一个目录（真实网址，刷新/分享都能直达）
  const PAGE_DIRS = ['', 'books/', 'class/', 'deskmate/', 'battle/', 'stats/', 'settings/', 'store/', 'community/'];
  function siteRootPath() {
    const cur = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '/';
    const mark = '/StarCard/';
    const at = cur.indexOf(mark);
    if (at >= 0) return cur.slice(0, at + mark.length);
    const seg = cur.split('/').filter(function (x) { return !!x; });
    const known = { books: 1, 'class': 1, deskmate: 1, battle: 1, stats: 1, settings: 1, browse: 1, store: 1, community: 1 };
    while (seg.length && (known[seg[seg.length - 1]] || /\.[a-z0-9]+$/i.test(seg[seg.length - 1]))) seg.pop();
    return '/' + seg.join('/') + (seg.length ? '/' : '');
  }
  // 生成某页签的地址；tab 6（设置）也在其中，但没有侧栏高亮
  function pageHref(tab) {
    return siteRootPath() + (PAGE_DIRS[tab] || '');
  }

  const NAV = [
    { kind: 'tab', tab: 1, label: '工坊', ico: 'pencil', group: '学习' },
    { kind: 'act', act: 'study-all', label: '开始复习', ico: 'play', group: '学习' },
    { kind: 'tab', tab: 2, label: '班级', ico: 'users', group: '一起学' },
    { kind: 'tab', tab: 3, label: '同桌', ico: 'link', group: '一起学' },
    { kind: 'tab', tab: 8, label: '社区', ico: 'chat', group: '一起学' },
    { kind: 'tab', tab: 4, label: '比赛', ico: 'zap', group: '一起学' },
    { kind: 'tab', tab: 7, label: '商铺', ico: 'grid', group: '工具' },
    { kind: 'tab', tab: 5, label: '数据', ico: 'chart', group: '工具' }
    // 「通知」移到左下角账户行的铃铛；「设置」在头像弹出的账户菜单
  ];

  function logo() {
    // 闪星卡：直接显示应用图标（与 favicon 同源，原样呈现，无动画）
    return '<span class="logo"><img src="' + pageHref(0) + 'icon-192.png" alt="" /></span>';
  }

  // 连续打卡：标准为「每天 10 分钟 + 100 词」，统一走 FC.checkinStreak
  function streakStat(app) {
    const state = (app && app.state) || {};
    if (FC.checkinStreak) return FC.checkinStreak(state, Date.now());
    return { days: 0, doneToday: false, longest: 0, week: [] };
  }

  const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
  function weekBarTitles(day, goal) {
    return day.key + '（周' + WEEK_CN[(new Date(day.ts).getDay() + 6) % 7] + '）' +
      Math.round(day.minutes) + '/' + goal.minutes + ' 分钟 · ' +
      day.words + '/' + goal.words + ' 词' + (day.makeup ? ' · 补签' : '');
  }
  function weekBarsHtml(sd) {
    const week = Array.isArray(sd.week) ? sd.week : [];
    const ok = week.filter(function (d) { return d.ok; }).length;
    const pct = week.length ? Math.round(ok / week.length * 100) : 0;
    return '<div class="sm-week" title="本周 ' + ok + '/' + week.length + ' 天达标">' +
      '<span class="sm-fill" style="width:' + pct + '%"></span></div>';
  }

  // 侧栏顶部：火苗 + 连续打卡天数 + 本周进度（橙红 = 达标，黑 = 未达标）
  function streakMiniHtml(app) {
    const sd = streakStat(app);
    const days = sd.days > 0 ? sd.days : 0;
    return '<div class="streak-mini' + (sd.doneToday ? ' lit' : '') + '" title="连续打卡 ' + days + ' 天 · 每天 10 分钟 + 100 词">' +
      '<div class="sm-top">' +
      '<span class="sm-flame">' + flameIcon('i18', sd.doneToday) + '</span>' +
      '<span class="sm-txt"><b>' + days + ' 天</b>' +
      '<small>' + (sd.doneToday ? '今日已打卡' : '连续打卡') + '</small></span></div>' +
      weekBarsHtml(sd) + '</div>';
  }

  function tabbar(active, app) {
    const acc = (app && app.account) || {};
    const on = !!acc.loggedIn;
    // 浮层页面与页签互斥：打开浮层时不高亮任何页签
    let pageActive = '';
    if (app) {
      if (app.noticePageOpen || app.backupPageOpen) pageActive = 'notice-open';
    }
    const tabActive = (pageActive || (app && app.folderId)) ? -999 : active;
    const name = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    let html = '<nav class="tabbar' + (app && app.sideHide ? ' side-hidden' : '') + '">' +
      '<div class="side-brand"><span class="sb-name">闪星卡</span>' +
      '<button class="sb-search" data-act="side-search" title="搜索卡片 / 牌组" aria-label="搜索">' + icon('search', 'i18') + '</button></div>' +
      streakMiniHtml(app);
    const unread = noticeUnread(app);
    let lastGroup = '';
    for (let i = 0; i < NAV.length; i++) {
      const n = NAV[i];
      if (n.group !== lastGroup) {
        lastGroup = n.group;
        html += '<div class="nav-label">' + esc(lastGroup) + '</div>';
      }
      if (n.kind === 'tab') {
        html += '<a class="tab' + (n.tab === tabActive ? ' active' : '') + '" href="' + pageHref(n.tab) + '" title="' + n.label + '">' +
          '<span class="ico">' + icon(n.ico, 'i20') + '</span>' +
          '<span class="lab">' + n.label + '</span></a>';
      } else {
        const isOn = n.act === pageActive;
        html += '<div class="tab' + (isOn ? ' active' : '') + '" data-act="' + n.act + '" title="' + n.label + '">' +
          '<span class="ico">' + icon(n.ico, 'i20') + '</span>' +
          '<span class="lab">' + n.label + '</span>' +
          (n.badge && unread > 0 ? '<span class="side-badge">' + unread + '</span>' : '') + '</div>';
      }
    }
    // —— 牌组区：默认「所有牌组」+ 自建文件夹；加号 = 新建文件夹，下载 = 导入词库 ——
    // 工坊只管制作卡片，牌组的陈列与归档都在侧栏（用户要求）。
    const _st = (app && app.state) || {};
    const _decks = _st.decks || [];
    html += '<div class="nav-label">牌组</div>';
    html += '<div class="tab side-deck' + (app && app.folderId === '__all' ? ' active' : '') + '" data-act="folder-open" data-id="__all" title="所有牌组（' + _decks.length + ' 个）">' +
      '<span class="ico">' + icon('layers', 'i20') + '</span>' +
      '<span class="lab">所有牌组</span></div>';
    const _folders = _st.folders || [];
    for (let fi = 0; fi < _folders.length; fi++) {
      const _f = _folders[fi];
      const _n = FC.decksInFolder ? FC.decksInFolder(_st, _f.id).length : 0;
      html += '<div class="tab side-deck' + (app && app.folderId === _f.id ? ' active' : '') + '" data-act="folder-open" data-id="' + esc(_f.id) + '" title="' + esc(_f.name) + '（' + _n + ' 个牌组）">' +
        '<span class="ico">' + icon('folder', 'i20') + '</span>' +
        '<span class="lab">' + esc(_f.name) + '</span></div>';
    }
    html += '<div class="side-decks-actions">' +
      '<button class="sd-act" data-act="folder-new" title="新建文件夹">' + icon('plus', 'i18') + '</button>' +
      '<button class="sd-act" data-act="import-hub" title="导入词库（.srcd / .apkg / CSV）">' + icon('download', 'i18') + '</button>' +
      '</div>';
    html += '<div class="side-account' + (on ? ' on' : '') + '" data-act="account-menu" title="账户菜单">' +
      avatarFace(acc, 'ava-sm') +
      '<span class="sa-txt"><span class="sa-name">' + esc(on ? name : '匿名用户') + '</span></span>' +
      '</div>' +
      '</nav>';
    return html;
  }

  // 全站统一紧凑操作栏：隐藏侧栏 + （返回）+ 标题 + 副题 + 右侧动作
  function titlebar(title, sub, opt) {
    opt = opt || {};
    let html = '<header class="studio-top">';
    html += '<button class="stg-btn" data-act="side-toggle" title="隐藏 / 显示侧栏">' + icon('sidebar', 'i18') + '</button>';
    if (opt.back) {
      html += '<button class="stg-btn stg-back" data-act="' + opt.back.act + '"' +
        (opt.back.view !== undefined ? ' data-view="' + opt.back.view + '"' : '') +
        ' aria-label="返回">' + icon('chevronLeft', 'i18') + '</button>';
    }
    html += '<div class="tb-main stg-main"><span class="stg-title">' + esc(title || '闪星卡') + '</span>' +
      (sub ? '<span class="stg-sub">' + esc(sub) + '</span>' : '') + '</div>';
    if (opt.actions) html += '<div class="tb-actions">' + opt.actions + '</div>';
    return html + '</header>';
  }

  function emptyBox(iconName, text, btnLabel, act) {
    let html = '<div class="empty"><div class="empty-ico">' + icon(iconName, 'i32') + '</div>' +
      '<div class="empty-t">' + esc(text) + '</div>';
    if (btnLabel) {
      html += '<div style="margin-top:16px"><button class="btn btn-primary" data-act="' + act + '">' +
        esc(btnLabel) + '</button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 卡片页
  // 今日概览 Hero：待办 / 预计用时 / 连续打卡 / 一条可执行建议。
  function overviewHero(ov, app) {
    if (!ov) return '';
    const acc = (app && app.account) || {};
    const nm = (app && app.accountDisplayName) ? app.accountDisplayName() : (acc.nickname || '学习者');
    const hr = new Date().getHours();
    const greet = hr < 6 ? '夜深了' : hr < 11 ? '早上好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
    const d = new Date();
    const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
    const dateStr = (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + week;
    const pct = ov.planned > 0
      ? Math.min(100, Math.round(ov.doneToday / (ov.doneToday + ov.planned) * 100))
      : (ov.hasData ? 100 : 0);
    const adv = ov.advice;
    const fig = function (v, k, tone) {
      return '<div class="ov-fig' + (tone ? ' tone-' + tone : '') + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>';
    };
    const ctaCls = adv.tone === 'brand' ? 'btn-primary' : (adv.tone === 'green' ? 'btn-accent' : '');
    return '<div class="overview-hero">' +
      '<span class="hero-float hf-dot" style="top:14%;right:22%"></span>' +
      '<span class="hero-float hf-dot2" style="top:58%;right:9%;animation-delay:-1.3s"></span>' +
      '<span class="hero-float hf-dot3" style="top:20%;right:46%;animation-delay:-2.1s"></span>' +
      '<span class="hero-float hf-pill" style="bottom:16%;right:26%;animation-delay:-.7s">FSRS-5 · 智能间隔重复</span>' +
      '<div class="ov-body"><div class="ov-left">' +
      '<div class="ov-date">' + esc(dateStr) + '</div>' +
      '<div class="ov-hello">' + esc(greet) + '，' + esc(nm) + '</div>' +
      '<div class="ov-caption">' + (ov.hasData
        ? ('已掌握 ' + ov.mastered + ' / ' + ov.total + ' 张 · 真实留存 ' + (ov.retention > 0 ? Math.round(ov.retention * 100) + '%' : '—'))
        : '尚无学习记录，导入内容后即可开始') + '</div>' +
      '<div class="ov-figs">' +
      fig(ov.planned, '今日待学', 'brand') +
      fig(ov.minutes + ' 分', '预计用时') +
      fig(ov.streak + ' 天', '连续打卡', 'amber') +
      '</div></div>' +
      '<div class="ov-ring" style="--pct:' + pct + '"><div class="ov-ring-in">' +
      '<b>' + pct + '%</b><span>今日进度</span></div></div></div>' +
      '<div class="ov-advice tone-' + esc(adv.tone) + '">' +
      '<span class="ov-adv-ico">' + icon(adv.icon, 'i18') + '</span>' +
      '<div class="ov-adv-txt"><div class="ov-adv-title">' + esc(adv.title) + '</div>' +
      '<div class="ov-adv-desc">' + esc(adv.desc) + '</div></div>' +
      '<button class="btn btn-sm ' + ctaCls + '" data-act="' + esc(adv.act) + '"' +
      (adv.tab !== undefined ? ' data-tab="' + adv.tab + '"' : '') + '>' + esc(adv.cta) + '</button>' +
      '</div></div>';
  }

  // 未完成会话的「继续学习」入口：退出学习后回到首页仍可原样续上
  function resumeStudyBanner(app) {
    if (!app.study || app.studyActive !== false || app.study.done) return '';
    const st = app.study;
    const studied = app.studiedCount ? app.studiedCount() : 0;
    const mastered = app.learnedCount ? app.learnedCount() : 0;
    const total = st.total || 0;
    // 进度条口径 = 已掌握词汇，不是学过张数
    const pct = total ? Math.round(Math.min(mastered / total, 1) * 100) : 0;
    let when = '';
    if (st.dueQueue && st.dueQueue.length && !st.activeId) {
      const secs = Math.ceil(app.nextDueIn() / 1000);
      const mm = Math.floor(secs / 60), ss = secs % 60;
      when = '<span class="rsb-when">' + icon('clock', 'i14') + '下一张 ' + (mm > 0 ? mm + ' 分 ' : '') + ss + ' 秒后出现</span>';
    }
    return '<div class="resume-study-banner" data-act="study-resume" role="button" tabindex="0">' +
      '<span class="rsb-ico">' + icon('play', 'i20') + '</span>' +
      '<span class="rsb-main"><b>继续上次学习' + (st.deckName ? ' · ' + esc(st.deckName) : '') + '</b>' +
      '<small>已掌握 ' + mastered + ' / ' + total + ' · 已学 ' + studied + ' · 掌握进度 ' + pct + '%</small>' +
      when + '</span>' +
      '<span class="rsb-cta">继续学习 ' + icon('chevronRight', 'i16') + '</span>' +
      '<span class="rsb-progress"><i style="width:' + pct + '%"></i></span></div>';
  }

  // 首页补充卡片：填满宽屏空白，提供「本周节奏 / 重点复习 / 智能诊断」三个速览
  function homeExtras(app, ov) {
    const st = app.state;
    const now = Date.now();

    // —— 本周复习节奏（近 7 天迷你柱状图）——
    const days = [];
    const dayKeys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * FC.DAY_MS);
      const key = FC.dateKey(d.getTime());
      dayKeys.push(key);
      let n = 0;
      for (let j = 0; j < st.stats.length; j++) {
        if (st.stats[j].date === key) { n = st.stats[j].reviews || 0; break; }
      }
      days.push(n);
    }
    const maxN = Math.max(1, days.reduce(function (a, b) { return Math.max(a, b); }, 0));
    const wkTotal = days.reduce(function (a, b) { return a + b; }, 0);
    const wdNames = ['日', '一', '二', '三', '四', '五', '六'];
    let bars = '';
    for (let i = 0; i < days.length; i++) {
      const d = new Date(now - (6 - i) * FC.DAY_MS);
      const h = Math.round(days[i] / maxN * 100);
      const isToday = i === 6;
      bars += '<div class="wk-col' + (isToday ? ' today' : '') + '">' +
        '<div class="wk-bar-wrap"><span class="wk-bar" style="height:' + Math.max(days[i] ? 8 : 3, h) + '%"' +
        (days[i] ? '' : ' data-zero="1"') + '></span></div>' +
        '<span class="wk-lb">' + wdNames[d.getDay()] + '</span></div>';
    }
    const weekCard = '<div class="home-card week-card">' +
      '<div class="hc-head">' + icon('chart', 'i18') + '<span>本周节奏</span>' +
      '<em>' + wkTotal + ' 次</em></div>' +
      '<div class="wk-chart">' + bars + '</div>' +
      '<div class="hc-foot">最近 7 天复习 · 今天 ' + days[6] + ' 次</div>' +
      '</div>';

    // —— 重点复习（本机 FSRS 算力）——
    let focusCard = '';
    try {
      if (FC.AI && FC.AI.REVIEW_ANALYSIS) {
        const a = FC.AI.REVIEW_ANALYSIS(app);
        if (a && a.hasData) {
          let words = '';
          const top = (a.items || []).slice(0, 3);
          for (let i = 0; i < top.length; i++) {
            const x = top[i];
            const w = String(x.card && x.card.front || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const wt = w.length > 16 ? w.slice(0, 16) + '…' : w;
            words += '<div class="hf-word"><span class="hf-name">' + esc(wt) + '</span>' +
              '<span class="hf-meta">可提取度 ' + esc(x.retention) + '%' +
              (x.overdueDays > 0 ? ' · 逾期 ' + esc(x.overdueDays) + ' 天' : '') + '</span></div>';
          }
        focusCard = '<div class="home-card focus-card">' +
          '<div class="hc-head">' + icon('target', 'i18') + '<span>重点复习</span>' +
          '<em>约 ' + esc(a.minutes) + ' 分钟</em></div>' +
          '<div class="hf-nums"><span><b>' + esc(a.dueCnt) + '</b>张到期</span>' +
          '<span><b>' + esc(a.lowRCnt) + '</b>张记忆偏低</span></div>' +
          (words || '<div class="hc-foot">暂无低留存卡片</div>') +
          '</div>';
        }
      }
    } catch (e) { focusCard = ''; }
    if (!focusCard) {
      focusCard = '<div class="home-card focus-card">' +
        '<div class="hc-head">' + icon('target', 'i18') + '<span>重点复习</span></div>' +
        '<div class="hc-empty">学几张卡后，这里会算出最该多复习的词和所需时间。</div>' +
        '</div>';
    }

    // —— 智能诊断（小星）——
    let diagCard = '';
    try {
      if (FC.AI && FC.AI.DIAGNOSIS) {
        const items = FC.AI.DIAGNOSIS(app) || [];
        let rows = '';
        for (let i = 0; i < Math.min(3, items.length); i++) {
          const it = items[i];
          rows += '<div class="hd-row tone-' + esc(it.tone) + '">' +
            '<span class="hd-ico">' + icon(it.icon, 'i15') + '</span>' +
            '<div><b>' + esc(it.title) + '</b><span>' + esc(it.desc) + '</span></div></div>';
        }
        diagCard = '<div class="home-card diag-card">' +
          '<div class="hc-head">' + icon('sparkles', 'i18') + '<span>智能诊断</span></div>' +
          rows + '</div>';
      }
    } catch (e) { diagCard = ''; }

    if (!weekCard && !focusCard && !diagCard) return '';
    return '<div class="home-extras">' + weekCard + focusCard + diagCard + '</div>';
  }

  function deckPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    const ov = FC.smartOverview ? FC.smartOverview(st) : null;
    const heroHtml = overviewHero(ov, app);
    // 卡片页 = 纯学习场所：只保留学习相关入口，制作 / 导入统一挪到「词书」页。
    let html = titlebar('卡片', 'FSRS-5 间隔重复', {
      actions:
        '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览</button>' +
        '<button class="btn btn-sm" data-act="custom-study">' + icon('layers', 'i14') + '自定义学习</button>' +
        '<button class="btn btn-sm" data-act="export-open" title="导出全部牌组 .srcd">' + icon('upload', 'i14') + '导出</button>'
    }) +
      '<div class="content home-page">' +
      heroHtml +
      resumeStudyBanner(app) +
      (FCUI.aiBriefing ? FCUI.aiBriefing(app) : '') +
      homeExtras(app, ov) +
      '<div class="section-title">牌组 · 点击开始学习</div>';

    if (st.decks.length === 0) {
      html += '<div class="onboard">' +
        '<div class="ob-head"><span class="ob-ico">' + icon('cards', 'i20') + '</span>' +
        '<div><b>快速开始</b>' +
        '<small>所有数据保存在本设备，可离线使用。</small></div></div>' +
        '<div class="ob-steps">' +
        '<div class="ob-step"><span class="ob-n">1</span>' +
        '<div class="ob-txt"><b>导入词库</b><small>支持 .srcd / Anki .apkg / CSV；每个词库会自动成为一个系列</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="import-hub">去导入</button>' +
        '</div>' +
        '<div class="ob-step"><span class="ob-n">2</span>' +
        '<div class="ob-txt"><b>导入自己的内容</b><small>支持 Anki .apkg / .colpkg、.srcd 与 CSV，或新建牌组</small></div>' +
        '<button class="btn btn-sm" data-act="tab" data-tab="1">前往词书</button></div>' +
        '<div class="ob-step"><span class="ob-n">3</span>' +
        '<div class="ob-txt"><b>键盘操作</b><small>空格 / 回车翻面 · 1-4 评分</small></div>' +
        '<button class="btn btn-sm" data-act="shortcuts-help">查看快捷键</button></div>' +
        '</div></div></div>';
      return html + tabbar(0, app);
    }
    const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
    const split = splitDecksBySeries(st, seriesList);
    // 依据 id 稳定分配一个 HarmonyOS 彩色图标（红/橙/黄/绿/青/蓝/紫/绯），同一牌组颜色固定
    function avTone(deck) {
      const key = String((deck && deck.id) || (deck && deck.name) || '');
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return h % 8;
    }
    function deckStudyItem(d) {
      const c = s.deckCounts(d, now);
      const total = d.cards.length;
      const isSat = (d.tags || []).indexOf('sat800') >= 0;
      const cap = (typeof FC.settingsFor === 'function' ? FC.settingsFor(d, st.settings) : st.settings).newCardsPerDay;
      const left = Math.max(0, cap - st.newToday);
      const capped = c[0] > left;
      let inProgress = 0;
      for (let k = 0; k < d.cards.length; k++) {
        const cc = d.cards[k];
        if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
      }
      const masteredCount = Math.max(0, total - c[0] - inProgress);
      const masterPct = total === 0 ? 0 : Math.round(masteredCount / total * 100);
      const tone = avTone(d);
      return '<div class="list-item deck-item dt-' + tone + '" data-act="study-deck" data-id="' + esc(d.id) + '">' +
        '<div class="avatar deck-av av-tone-' + tone + '">' + icon(isSat ? 'book' : 'layers', 'i20') + '</div>' +
        '<div class="li-main"><div class="name">' + esc(d.name) +
        ((c[0] || c[1]) ? '<span class="deck-chips">' +
          (c[0] ? '<span class="dchip dc-new">新 ' + c[0] + '</span>' : '') +
          (c[1] ? '<span class="dchip dc-due">到期 ' + c[1] + '</span>' : '') + '</span>'
          : (total > 0 ? '<span class="deck-chips"><span class="dchip dc-done">今日已完成</span></span>' : '')) + '</div>' +
        '<div class="meta">' + (d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + masteredCount + ' / ' + total + ' 张</div>' +
        (capped ? '<div class="cap-warn" data-act="settings-open" title="点击前往统一设置">' +
          icon('info', 'i13') + '新卡限 ' + left + ' 张 · 调大上限</div>' : '') +
        '<div class="progress deck-prog"><span style="width:' + masterPct + '%"></span></div></div>' +
        '<div class="li-actions">' +
        '<button class="btn btn-sm btn-primary" data-act="study-deck" data-id="' + esc(d.id) + '">学习</button>' +
        '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(d.id) + '" title="更多操作">' +
        icon('more', 'i16') + '</button></div>' +
        '</div>';
    }
    for (let si = 0; si < seriesList.length; si++) {
      const se = seriesList[si];
      const ds = split.bySeries[se.id];
      if (!ds || !ds.length) continue;
      const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
      html += '<div class="series-group' + (collapsed ? ' collapsed' : '') + '">' +
        '<div class="sg-head"><button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>' +
        '<span class="sg-name">' + esc(se.name) + '</span>' +
        '<span class="sg-meta">' + ds.length + ' 个分册</span>' +
        '<button class="btn btn-sm sg-go" data-act="series-open" data-id="' + esc(se.id) + '">查看系列</button></div>';
      for (let i = 0; i < ds.length; i++) html += deckStudyItem(ds[i]);
      html += '</div>';
    }
    if (split.userDecks.length) {
      html += '<div class="section-title">牌组 · 自建</div>';
      for (let i = 0; i < split.userDecks.length; i++) html += deckStudyItem(split.userDecks[i]);
    }
    html += '</div>';
    return html + tabbar(0, app);
  }

  // ---------------------------------------------------------------- 卡片管理
  function cardManagePage(app) {
    const st = app.state;
    const deck = st.decks.find(function (d) { return d.id === app.cardManageDeckId; });
    if (!deck) {
      let html = titlebar('卡片管理', '', { back: { act: 'deck-back' } }) + '<div class="content">';
      html += emptyBox('cards', '未选择牌组');
      return html + tabbar(app.tab, app);
    }
    let html = titlebar(deck.name, '卡片管理 · 共 ' + deck.cards.length + ' 张卡片', {
      back: { act: 'deck-back' },
      actions: '<button class="btn btn-sm" data-act="browser-deck" data-id="' + esc(deck.id) + '">' +
        icon('table', 'i14') + '浏览</button>' +
        '<button class="btn btn-sm" data-act="deck-options" data-id="' + esc(deck.id) + '">' +
        icon('settings', 'i14') + '选项</button>' +
        '<button class="btn btn-sm btn-primary" data-act="card-new" data-id="' + esc(deck.id) + '">' +
        icon('plus', 'i14') + '添加卡片</button>'
    }) + '<div class="content">';

    html += '<div class="page-head">' +
      '<button class="btn btn-sm" data-act="card-batch" data-id="' + esc(deck.id) + '">' +
      icon('clipboard', 'i14') + '批量粘贴</button>' +
      '<span class="subtle">支持基础 / 反向 / 填空三种笔记类型</span></div>';

    if (deck.cards.length === 0) {
      html += emptyBox('card', '这个牌组还没有卡片');
    } else {
      for (let i = 0; i < deck.cards.length; i++) {
        const c = deck.cards[i];
        const stateLabel = FCUI.statusText ? FCUI.statusText(c) : c.state;
        const flag = c.flags ? '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[c.flags] + '"></span>' : '';
        html += '<div class="list-item">' +
          '<div class="avatar gray">' + icon('card', 'i18') + '</div>' +
          '<div class="li-main"><div class="name" style="font-size:14.5px">' + flag + esc(c.front) + '</div>' +
          '<div class="meta">' + esc(String(c.back).slice(0, 80)) + ' · ' + stateLabel +
          (c.notetype === 'cloze' ? ' · 填空' : '') +
          (c.leeched ? ' · Leech' : '') +
          (c.tags.length ? ' · ' + c.tags.map(esc).join('/') : '') + '</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          '<button class="btn btn-sm" data-act="card-info" data-id="' + esc(c.id) + '" title="信息">' +
          icon('info', 'i14') + '</button>' +
          '<button class="btn btn-sm" data-act="card-edit" data-id="' + esc(c.id) + '" title="编辑">' +
          icon('pencil', 'i14') + '</button>' +
          '<button class="btn btn-sm btn-danger" data-act="card-del" data-id="' + esc(c.id) + '" title="删除">' +
          icon('trash', 'i14') + '</button>' +
          '</div></div>';
      }
    }
    html += '</div>';
    return html + tabbar(app.tab, app);
  }

  // ---------------------------------------------------------------- 卡片学习会话
  function studySession(app) {
    const sess = app.study;
    const card = app.currentStudyCard();
    const waiting = !card && app.studyWaiting();
    const pending = (sess.dueQueue && sess.dueQueue.length) || 0;
    const graded = sess.reviewed || 0;
    const studied = app.studiedCount ? app.studiedCount() : 0;
    const mastered = app.learnedCount ? app.learnedCount() : 0;
    const elapsedMs = sess.sessionStartedAt ? Math.max(0, Date.now() - sess.sessionStartedAt) : 0;
    const secs = Math.floor(elapsedMs / 1000);
    const dur = secs >= 60
      ? Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2)
      : secs + 's';
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title">卡片学习' + (sess.deckName ? ' · ' + esc(sess.deckName) : '') + '</div>' +
      // 进度条口径 = 已掌握词汇（以良好/简单毕业的卡），不是「学过/刷过」的张数
      '<div class="rv-meta">' +
      '<span class="rv-chip">已掌握 <b>' + mastered + '</b>/' + sess.total + '</span>' +
      '<span class="rv-chip">已学 <b>' + studied + '</b></span>' +
      '<span class="rv-chip">剩余 <b>' + Math.max(0, sess.total - studied) + '</b></span>' +
      (pending ? '<span class="rv-chip">待复习 <b>' + pending + '</b></span>' : '') +
      '<span class="rv-chip">' + graded + ' 次评分 · ' + dur + '</span>' +
      ((sess.requeued) ? '<span class="rv-chip">重来 ' + sess.requeued + '</span>' : '') + '</div></div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      '<button class="btn btn-sm" data-act="study-stop">退出</button></div></div>' +
      '<div class="progress"><span style="width:' +
      Math.round(sess.total ? Math.min(mastered / sess.total, 1) * 100 : 0) + '%"></span></div>' +
      (FCUI.studyTools ? FCUI.studyTools(app) : '') + '</div>';

    if (!card) {
      if (waiting) {
        // 首轮学完，重来卡还没到点：Anki 式等待 + 倒计时 + 可提前学习
        const secs = Math.ceil(app.nextDueIn() / 1000);
        const mm = Math.floor(secs / 60), ss = secs % 60;
        const cd = (mm > 0 ? mm + ' 分 ' : '') + ss + ' 秒';
        html += '<div class="study-area"><div class="card" style="text-align:center;width:100%;max-width:360px;padding:32px 22px;margin:0">' +
          '<div style="display:flex;justify-content:center;color:var(--primary)">' + icon('clock', 'i44') + '</div>' +
          '<div id="studyCountdown" style="font-weight:700;font-size:18px;margin-top:14px">下一张 ' + cd + ' 后出现</div>' +
          '<div class="subtle" style="margin-top:8px">按 Anki 记忆算法，刚点「重来」的卡会在几分钟后重新出现。' +
          '还有 <strong>' + pending + '</strong> 张在等待到期，到点会自动出现。</div>' +
          '<button class="btn btn-primary" style="margin-top:20px" data-act="study-ahead">提前学习</button>' +
          '<div style="margin-top:10px"><button class="btn btn-sm" data-act="study-stop">结束本次学习</button></div>' +
          '</div></div>';
        return html + '</div>';
      }
      const g = sess.gradeCounts || { 1: 0, 2: 0, 3: 0, 4: 0 };
      const good = (g[3] || 0) + (g[4] || 0);
      const acc = graded ? Math.round(good / graded * 100) : 0;
      const advice = acc >= 85
        ? '本次正确率较高，后续复习间隔将自动延长。'
        : (acc >= 60
          ? '标记「重来」的卡片将在几分钟后再次出现。'
          : '遗忘较多的卡片会安排更频繁的复习。');
      const cell = function (v, label) {
        return '<div class="summary-cell"><b>' + esc(String(v)) + '</b><span>' + label + '</span></div>';
      };
      const g1 = g[1] || 0, g2 = g[2] || 0, g3 = g[3] || 0, g4 = g[4] || 0;
      const seg = function (n, cls) { return n > 0 ? '<span class="rs-seg ' + cls + '" style="flex:' + n + '"></span>' : ''; };
      html += '<div class="study-area"><div class="card study-summary" style="width:100%;max-width:420px;padding:30px 26px;margin:0">' +
        '<div class="summary-ring" style="--p:' + acc + '"><div class="summary-ring-in"><b>' + acc + '%</b><span>正确率</span></div></div>' +
        '<div class="summary-title" style="text-align:center">本组已学完</div>' +
        '<div class="subtle" style="text-align:center;margin-top:6px">已学 ' + studied + ' / ' + sess.total + ' 个单词 · 掌握 ' + mastered + ' 个 · 用时 ' + dur + '</div>' +
        '<div class="summary-grid">' +
          cell(mastered + ' / ' + sess.total, '已掌握') +
          cell(studied + ' / ' + sess.total, '已学') +
          cell(String(graded), '本次评分') +
          cell(dur, '本次用时') +
        '</div>' +
        '<div class="rating-stack" title="评分分布">' + seg(g1, 's1') + seg(g2, 's2') + seg(g3, 's3') + seg(g4, 's4') + '</div>' +
        '<div class="summary-ratings">' +
          '<span class="sr s1">重来 <b>' + g1 + '</b></span>' +
          '<span class="sr s2">困难 <b>' + g2 + '</b></span>' +
          '<span class="sr s3">良好 <b>' + g3 + '</b></span>' +
          '<span class="sr s4">简单 <b>' + g4 + '</b></span>' +
          ((sess.requeued) ? '<span class="sr-extra">途中重来 ' + sess.requeued + ' 次</span>' : '') +
        '</div>' +
        '<div class="summary-advice">' + icon('info', 'i15') + '<span>' + advice + '</span></div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:18px" data-act="study-stop">返回</button></div></div>';
      return html + '</div>';
    }

    const frontHtml = FC.renderCardHtml ? FC.renderCardHtml(card, 'front') : esc(card.front);
    const backHtml = FC.renderCardHtml ? FC.renderCardHtml(card, 'back') : esc(card.back);
    const statusChip = card.leeched ? '<span class="chip red">Leech · 已遗忘 ' + card.scheduling.lapses + ' 次</span>'
      : (card.flags ? '<span class="chip">' + icon('flag', 'i14') + '已标记</span>' : '');

    // 「第 01 组」这类分组标签不是音标，别当成发音塞在单词下面
    const extraTxt = String(card.extra == null ? '' : card.extra).trim();
    const extraIsGroup = !extraTxt || /^第\s*\d+\s*组$/.test(extraTxt);

    const showCardTimer = !!(app.state && app.state.settings && app.state.settings.showTimer);
    // 「只有英文解释」的卡（如转折词）：背面是纯英文、无中文、无 == 标词例句。
    // 这类卡让英文解释干净地落在卡片正中央，不被「新卡片 / 评分提示」挤偏。
    const backTextOnly = String(card.back == null ? '' : card.back).replace(/\[sound:[^\]]+\]/g, '').trim();
    const enOnlyBack = backTextOnly.length > 0 && !/[\u4e00-\u9fa5]/.test(backTextOnly) && backTextOnly.indexOf('==') < 0;
    html += '<div class="study-area">' +
      (statusChip ? '<div class="study-flags">' + statusChip + '</div>' : '') +
      (showCardTimer ? '<div class="card-timer" id="cardTimer" title="本题用时">' + icon('clock', 'i14') + ' <span>0.0s</span></div>' : '') +
      '<div class="flip-card" data-act="study-flip">' +
      '<div class="flip-inner ' + (app.studyRevealed ? 'flipped' : '') + '">' +
      '<div class="flip-face flip-front"><div class="field-html word">' + frontHtml + '</div>' +
      ((!extraIsGroup && card.notetype !== 'cloze') ? '<div class="phon field-html">' + (FC.renderRich ? FC.renderRich(card.extra, card) : esc(card.extra)) + '</div>' : '') +
      (card.tags.length ? '<div style="margin-top:14px">' +
        card.tags.map(function (t) { return '<span class="chip gray">' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="flip-hint">点击卡片翻面</div></div>' +
      '<div class="flip-face flip-back' + (enOnlyBack ? ' en-only' : '') + '">' +
      '<div class="field-html mean">' + backHtml + '</div>' +
      (enOnlyBack ? '' : '<div class="ex">' + esc(card.scheduling.reps > 0
        ? ('已复习 ' + card.scheduling.reps + ' 次 · 遗忘 ' + card.scheduling.lapses + ' 次')
        : '新卡片') + '</div>') +
      (enOnlyBack ? '' : '<div class="flip-hint">选择下方评分继续</div>') + '</div>' +
      '</div></div></div>';

    if (app.studyRevealed) {
      const labels = ['重来', '困难', '良好', '简单'];
      const sub = sess.preview || ['', '', '', ''];
      html += '<div class="rate-bar">';
      for (let r = 1; r <= 4; r++) {
        html += '<button class="rate-btn r' + r + '" data-act="study-rate" data-rating="' + r + '">' +
          '<span class="rate-key">' + String(r) + '</span>' +
          '<span class="rate-label">' + labels[r - 1] + '</span>' +
          '<span class="rate-meta">' + esc(sub[r - 1]) + '</span></button>';
      }
      html += '</div>';
    } else {
      html += '<div class="rate-bar"><button class="rate-btn r3" data-act="study-flip">' +
        '<span class="rate-key">Enter / Space</span>' +
        '<span class="rate-label">显示答案</span>' +
        '<span class="rate-meta">翻面看答案 · 按 Enter 或空格</span></button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 词书页
  function allBooks(app) {
    return app.state.wordBooks.slice();
  }

  // —— 工坊：纯做卡与管理（Anki Browser 式双栏）。牌组的陈列/归档在侧栏「牌组」区，导入入口在侧栏底部 ——
  // 卡片文本的统一读取（新卡片走 fields，旧数据走 front/back，normalizeCard 已双向兜底）
  function cardFrontText(c) { return String((c.fields && c.fields.Front) || c.front || ''); }
  function cardBackText(c) { return String((c.fields && c.fields.Back) || c.back || ''); }

  // 文本框行数按内容估算：400px 详情栏约 28 个全角字符/行，上限 24 行
  function taRows(txt, min) {
    const t = String(txt || '');
    if (!t) return min;
    const lines = t.split('\n').length;
    const est = Math.ceil(t.length / 28) + (lines - 1);
    return Math.max(min, Math.min(24, est + 1));
  }

  function richCard(text) {
    let h = esc(String(text == null ? '' : text));
    h = h.replace(/==([^=\n]{1,60})==/g, '<mark class="sd-hl">$1</mark>');
    h = h.replace(/\*\*([^*\n]{1,60})\*\*/g, '<b>$1</b>');
    h = h.replace(/\n/g, '<br/>');
    return h || '<i class="sd-pv-empty">（空）</i>';
  }

  function studioDetailHtml(app) {
    const st = app.state;
    const sel = app.studio && app.studio.sel;
    if (!sel) {
      const _scope = app.studio && app.studio.scope;
      if (_scope) {
        let _d = null;
        for (let i = 0; i < st.decks.length; i++) if (st.decks[i].id === _scope) { _d = st.decks[i]; break; }
        if (_d && !_d.cards.length) {
          return '<div class="sd-empty">' + icon('card', 'i22') +
            '<b>「' + esc(_d.name) + '」还是空的</b><small>添加第一张卡片，保存后就会出现在左侧列表，随时点开继续编辑。</small>' +
            '<button class="btn btn-primary" data-act="card-new-scope">' + icon('plus', 'i14') + '添加卡片</button></div>';
        }
      }
      return '<div class="sd-empty">' + icon('pencil', 'i22') +
        '<b>选中左侧任意一行</b><small>在这里直接改正面、背面、标签，点「保存」立即生效（Anki Browser 同款操作）。</small></div>';
    }
    let r = null;
    for (let i = 0; i < st.decks.length && !r; i++) {
      for (let j = 0; j < st.decks[i].cards.length; j++) if (st.decks[i].cards[j].id === sel) { r = { deck: st.decks[i], card: st.decks[i].cards[j] }; break; }
    }
    if (!r) return '<div class="sd-empty"><b>这张卡片已被删除</b></div>';
    const c = r.card;
    const f = c.fields || { Front: c.front || '', Back: c.back || '', Extra: c.extra || '', Source: '' };
    const type = c.notetype || 'basic';
    const types = (FC.NOTETYPES || [{ id: 'basic', name: '问答' }, { id: 'cloze', name: '填空' }]);
    let typeOpts = '';
    for (let i = 0; i < types.length; i++) typeOpts += '<option value="' + esc(types[i].id) + '"' + (types[i].id === type ? ' selected' : '') + '>' + esc(types[i].name || types[i].id) + '</option>';
    let flagRow = '<div class="sd-flagrow"><span class="sd-flaglab">旗标</span>';
    for (let fi = 0; fi <= 7; fi++) {
      flagRow += '<button class="sd-flag' + ((c.flags & 7) === fi ? ' on' : '') + '" data-act="studio-flag" data-flag="' + fi + '" title="' + (fi ? ('Shift+' + fi) : 'Shift+0') + '">' +
        (fi ? '<span class="flag-dot big" style="background:' + FC.FLAG_COLORS[fi] + '"></span>' : '<span class="flag-none">无</span>') + '</button>';
    }
    flagRow += '</div>';
    return '<div class="sd-head"><span class="sd-deck-chip">' + icon('layers', 'i14') + esc(r.deck.name) + '</span>' +
      '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(r.deck.id) + '" title="牌组选项">' + icon('more', 'i16') + '</button></div>' +
      flagRow +
      '<div class="sd-preview"><div class="sd-pv-lab">学习者看到的样子</div>' +
      '<div class="sd-pv-front" id="sdPvFront">' + richCard(f.Front) + '</div>' +
      '<div class="sd-pv-back" id="sdPvBack">' + richCard(f.Back) + '</div>' +
      '<div class="sd-pv-note">用 <mark class="sd-hl">==双等号==</mark> 包住的词会高亮，换行保留</div></div>' +
      '<div class="sd-form">' +
      '<label class="sd-label">模板</label><select id="sdType" class="sd-input">' + typeOpts + '</select>' +
      '<label class="sd-label">正面</label><textarea id="sdFront" class="sd-input sd-ta" data-min="2" rows="' + taRows(f.Front, 2) + '">' + esc(f.Front || '') + '</textarea>' +
      '<label class="sd-label">背面</label><textarea id="sdBack" class="sd-input sd-ta" data-min="3" rows="' + taRows(f.Back, 3) + '">' + esc(f.Back || '') + '</textarea>' +
      '<label class="sd-label">补充</label><textarea id="sdExtra" class="sd-input sd-ta" data-min="2" rows="' + taRows(f.Extra, 2) + '">' + esc(f.Extra || '') + '</textarea>' +
      '<label class="sd-label">来源</label><input id="sdSource" class="sd-input" value="' + esc(f.Source || '') + '" />' +
      '<label class="sd-label">标签</label><input id="sdTags" class="sd-input" value="' + esc((c.tags || []).join(' ')) + '" placeholder="空格分隔多个标签" />' +
      '<div class="sd-hint">填空模板的正面需要写成 {{c1::答案}} 的形式。</div>' +
      '<div class="sd-actions"><button class="btn btn-primary" data-act="studio-save" data-id="' + esc(c.id) + '">' + icon('check', 'i14') + '保存</button>' +
      '<button class="btn" data-act="card-del" data-id="' + esc(c.id) + '">' + icon('trash', 'i14') + '删除</button></div>' +
      '</div>';
  }

  // 今日任务：到期 / 新卡 / 掌握度，给工坊与所有牌组共用（v2）
  function todayStat(app) {
    const st = app.state || {};
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    let due = 0, fresh = 0, total = 0, mastered = 0, inProgress = 0;
    for (let i = 0; i < (st.decks || []).length; i++) {
      const d = st.decks[i];
      const c = s.deckCounts(d, now);
      due += c[1]; fresh += c[0]; total += d.cards.length;
      for (let k = 0; k < d.cards.length; k++) {
        const cc = d.cards[k];
        if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
      }
    }
    mastered = Math.max(0, total - due - fresh - inProgress);
    return { due: due, fresh: fresh, total: total, mastered: mastered };
  }

  function dailyHeroHtml(app) {
    const t = todayStat(app);
    const sd = streakStat(app);
    const minutes = Math.max(1, Math.round((t.due + Math.min(t.fresh, 20)) * 0.5));
    const hasWork = (t.due + t.fresh) > 0;
    const label = t.due > 0 ? '开始复习' : (t.fresh > 0 ? '开始学习' : '今天已完成');
    const bigNum = t.due > 0 ? t.due : t.fresh;
    const bigUnit = t.due > 0 ? '张到期' : '张新卡';
    return '<section class="daily-hero">' +
      '<div class="dh-main">' +
        '<span class="dh-tag"><i></i>今日任务</span>' +
        '<div class="dh-num"><b>' + bigNum + '</b><span>' + bigUnit + '</span>' +
          (t.due > 0 && t.fresh > 0 ? '<span style="margin-left:10px">另有 ' + t.fresh + ' 张新卡</span>' : '') + '</div>' +
        '<div class="dh-note">' + (hasWork ? ('预计 ' + minutes + ' 分钟 · ') : '') +
          '连续 ' + (sd.days || 0) + ' 天 · 已掌握 ' + t.mastered + ' / ' + t.total + '</div>' +
        '<div class="dh-acts">' +
          '<button class="btn btn-primary" data-act="study-all"' + (hasWork ? '' : ' disabled') + '>' +
            icon('play', 'i14') + label + '</button>' +
          '<button class="btn" data-act="folder-open" data-id="__all">看所有牌组</button>' +
        '</div>' +
      '</div>' +
      '<div class="dh-stats">' +
        '<div class="dh-stat"><span>卡片总数</span><b>' + t.total + '</b></div>' +
        '<div class="dh-stat"><span>今日待复习</span><b>' + t.due + '</b></div>' +
        '<div class="dh-stat"><span>连续打卡</span><b>' + (sd.days || 0) + ' 天</b></div>' +
        '<div class="dh-stat"><span>累计掌握</span><b>' + (t.total ? Math.round(t.mastered / t.total * 100) : 0) + '%</b></div>' +
      '</div>' +
    '</section>';
  }

  function wordBookPage(app) {
    const st = app.state;
    if (!app.studio) app.studio = { q: '', sel: '', scope: '', fflag: 0 };
    if (app.studio.scope === undefined) app.studio.scope = '';
    // —— 范围（全部 / 某个牌组）与计数 ——
    const scope = app.studio.scope;
    let scopeDeck = null;
    if (scope) {
      for (let i = 0; i < st.decks.length; i++) if (st.decks[i].id === scope) { scopeDeck = st.decks[i]; break; }
      if (!scopeDeck) app.studio.scope = ''; // 牌组被删后自动回到全部
    }
    let totalAll = 0;
    for (let i = 0; i < st.decks.length; i++) totalAll += st.decks[i].cards.length;
    const srcDecks = scopeDeck ? [scopeDeck] : st.decks;
    let html = '<section class="studio-frame">' +
      '<header class="studio-top">' +
      '<button class="stg-btn" data-act="side-toggle" title="隐藏 / 显示侧栏">' + icon('sidebar', 'i18') + '</button>' +
      '<span class="stg-title">工坊</span>';
    if (st.decks.length) {
      html += '<select id="sdScope" class="stg-scope" title="选择要编辑的牌组范围">';
      html += '<option value=""' + (!scopeDeck ? ' selected' : '') + '>全部</option>';
      for (let i = 0; i < st.decks.length; i++) {
        const d = st.decks[i];
        html += '<option value="' + esc(d.id) + '"' + (scopeDeck === d ? ' selected' : '') + '>' + esc(d.name) + '</option>';
      }
      html += '</select>';
    }
    html += '<span class="stg-count">' + (scopeDeck ? scopeDeck.cards.length : totalAll) + ' 张卡片</span>' +
      (totalAll ? '<button class="btn btn-sm btn-primary" data-act="study-all" title="开始复习今天到期的卡片">' +
        icon('play', 'i14') + (function () { const t = todayStat(app); return (t.due > 0 ? '今日 ' + t.due + ' 张到期' : (t.fresh > 0 ? '开始学习' : '去复习')); })() + '</button>' : '') +
      '<button class="btn btn-sm' + (totalAll ? '' : ' btn-primary') + '" data-act="new-deck">' + icon('plus', 'i14') + '添加牌组</button>' +
      '</header><div class="content content--studio">';

    // —— 已移除的词书：默认折叠，可恢复重新显示（避免误删后无处找回）——
    const removedList = typeof FC.removedSeries === 'function' ? FC.removedSeries(st) : [];
    if (removedList.length) {
      html += '<div class="removed-series-box">' +
        '<button class="removed-series-toggle" data-act="series-removed-toggle">' +
        icon('trash', 'i14') + '已移除的词书（' + removedList.length + '）' +
        (app.showRemovedSeries ? icon('chevronUp', 'i14') : icon('chevronDown', 'i14')) + '</button>';
      if (app.showRemovedSeries) {
        html += '<div class="removed-series-list">';
        for (let ri = 0; ri < removedList.length; ri++) {
          const rs = removedList[ri];
          html += '<div class="removed-series-item">' +
            '<div class="rs-info"><div class="rs-name">' + esc(rs.name) + '</div>' +
            '<div class="rs-meta">' + esc(rs.subtitle || '') + ' · 卡片已删除</div></div>' +
            '<button class="btn btn-sm" data-act="series-restore" data-id="' + esc(rs.id) + '">' + icon('rotate', 'i14') + '恢复到词书</button>' +
            '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // —— 收集卡片（按当前范围：全部 / 单个牌组）——
    const rows = [];
    for (let i = 0; i < srcDecks.length; i++) {
      const d = srcDecks[i];
      for (let j = 0; j < d.cards.length; j++) rows.push({ deck: d, card: d.cards[j] });
    }
    // —— 旗标筛选（Shift+1~7 打标，0 清除；筛选条按色过滤）——
    const fflag = app.studio.fflag || 0;
    const flagCounts = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < rows.length; i++) flagCounts[rows[i].card.flags & 7] += 1;
    const visRows = fflag ? rows.filter(function (r) { return (r.card.flags & 7) === fflag; }) : rows;

    if (!totalAll) { // 整个词库都没卡才显示引导；范围内空牌组仍进双栏，方便直接加卡
      html += '<div class="card wide wb-welcome">' +
        '<div class="ww-hero"><span class="ww-ico">' + icon('book', 'i28') + '</span>' +
        '<div><b>从这里开始你的词库</b><small>闪星卡默认不带任何词库。导入一份词库，或自己动手做。</small></div></div>' +
        '<div class="ww-steps">' +
        '<div class="ww-step"><span class="ww-n">1</span><div><b>导入现成词库</b><small>点侧栏底部的「导入」按钮（下载图标），支持 .srcd / .apkg / CSV</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="import-hub">去导入</button></div>' +
        '<div class="ww-step"><span class="ww-n">2</span><div><b>自己制作</b><small>新建牌组手动添加卡片，或按行批量粘贴正反面</small></div>' +
        '<button class="btn btn-sm" data-act="new-deck">新建牌组</button></div>' +
        '<div class="ww-step"><span class="ww-n">3</span><div><b>开始学习</b><small>做好的牌组在侧栏「所有牌组」里，点牌组即可开始 FSRS 复习</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="folder-open" data-id="__all">去所有牌组</button></div>' +
        '</div></div>';
    } else {
      // —— Anki Browser 式双栏：左列卡片行（DOM 过滤，不重渲染保输入法），右列内联详情 ——
      const LIMIT = 300;
      const shown = visRows.slice(0, LIMIT);
      const FF_NAMES = ['红', '橙', '绿', '蓝', '靛', '天蓝', '粉'];
      let sideHtml = '<aside class="stg-side">' +
        '<button class="stg-side-item' + (!fflag ? ' on' : '') + '" data-act="studio-fflag" data-flag="0">' +
        icon('layers', 'i14') + '<span class="stg-side-txt">我的卡片</span><span class="ff-n">' + rows.length + '</span></button>' +
        '<div class="stg-side-lab">旗标</div>';
      for (let fi = 1; fi <= 7; fi++) {
        if (!flagCounts[fi]) continue; // 没人用的旗标不占行，找得更快
        sideHtml += '<button class="stg-side-item' + (fflag === fi ? ' on' : '') + '" data-act="studio-fflag" data-flag="' + fi + '" title="Shift+' + fi + '">' +
          '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[fi] + '"></span><span class="stg-side-txt">' + FF_NAMES[fi - 1] +
          '</span><span class="ff-n">' + flagCounts[fi] + '</span></button>';
      }
      sideHtml += '<div class="stg-side-lab">卡组</div>';
      for (let di = 0; di < st.decks.length; di++) {
        const dd = st.decks[di];
        sideHtml += '<button class="stg-side-item' + (scopeDeck === dd ? ' on' : '') + '" data-act="studio-scope-deck" data-id="' + esc(dd.id) + '" title="' + esc(dd.name) + '">' +
          '<span class="flag-dot deck-dot"></span><span class="stg-side-txt">' + esc(dd.name) + '</span><span class="ff-n">' + dd.cards.length + '</span></button>';
      }
      sideHtml += '<div class="stg-side-hint">Shift+1~7 打标<br/>Shift+0 清除</div></aside>';
      const sel = app.studio.sel;
      html += '<div class="studio2">' + sideHtml +
        '<div class="studio2-list">' +
        '<div class="studio2-search">' + icon('search', 'i16') +
        '<input id="sdQuery" type="text" placeholder="搜索正面 / 背面 / 牌组" value="' + esc(app.studio.q || '') + '" autocomplete="off" />' +
        (scopeDeck ? '<button class="stg-add" data-act="card-new-scope" title="往「' + esc(scopeDeck.name) + '」添加卡片">' + icon('plus', 'i16') + '</button>' : '') +
        '</div>' +
        '<div class="studio2-rows" id="sdRows">';
      for (let i = 0; i < shown.length; i++) {
        const d = shown[i].deck, c = shown[i].card;
        const front = cardFrontText(c), back = cardBackText(c);
        const key = esc((front + ' ' + back + ' ' + d.name).toLowerCase()).replace(/"/g, '&quot;');
        const fdot = (c.flags & 7) ? '<span class="flag-dot" style="background:' + FC.FLAG_COLORS[c.flags & 7] + '"></span>' : '';
        html += '<div class="s2-row' + (sel === c.id ? ' active' : '') + '" data-act="studio-row" data-id="' + esc(c.id) + '" data-key="' + key + '">' +
          '<div class="s2-front">' + fdot + (esc(front) || '<i class="s2-blank">（空白）</i>') + '</div>' +
          '<div class="s2-sub"><span class="s2-deck">' + esc(d.name) + '</span>' + esc(String(back).slice(0, 48)) + '</div></div>';
      }
      if (!visRows.length) html += '<div class="s2-none">' + (fflag ? '没有带这个旗标的卡片。选中卡片按 Shift+1~7 打标。' : '这个牌组还没有卡片，点右上 ＋ 添加。') + '</div>';
      html += '</div>';
      const moreTxt = rows.length > LIMIT ? ('共 ' + rows.length + ' 张，列表只显示前 ' + LIMIT + ' 张，用上面的搜索定位更多。') : ('共 ' + rows.length + ' 张卡片');
      html += '<div class="s2-more" data-total="' + rows.length + '" data-orig="' + esc(moreTxt).replace(/"/g, '&quot;') + '">' + moreTxt + '</div>';
      html += '</div>' +
        '<aside class="studio2-detail" id="sdDetail">' + studioDetailHtml(app) + '</aside>' +
        '</div>';
    }

    html += '</div></section>'; // 闭合 content--studio 与 studio-frame
    return html + tabbar(1, app);
  }

  // 把牌组按系列归组：属于某系列 tagKey 的归到该系列之下，其余算自建牌组。
  // 这样「系列 = 主文件，其分册 / 卡 = 子文件」的层级在「牌组」列表里也一目了然。
  function splitDecksBySeries(st, seriesList) {
    const bySeries = {};
    for (let i = 0; i < seriesList.length; i++) bySeries[seriesList[i].id] = [];
    const userDecks = [];
    for (let i = 0; i < st.decks.length; i++) {
      const d = st.decks[i];
      const tags = d.tags || [];
      let placed = false;
      for (let j = 0; j < seriesList.length; j++) {
        if (tags.indexOf(seriesList[j].tagKey) >= 0) { bySeries[seriesList[j].id].push(d); placed = true; break; }
      }
      if (!placed) userDecks.push(d);
    }
    return { bySeries: bySeries, userDecks: userDecks };
  }

  // 牌组列表项（学习进度 + 管理 / 更多）
  function deckListItem(app, d, s, now, isSat) {
    const c = s.deckCounts(d, now);
    const total = d.cards.length;
    let inProgress = 0;
    for (let k = 0; k < d.cards.length; k++) {
      const cc = d.cards[k];
      if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
    }
    const mastered = Math.max(0, total - c[0] - inProgress);
    const pct = total ? Math.round(mastered / total * 100) : 0;
    const chips = (c[0] || c[1])
      ? '<span class="deck-chips">' + (c[0] ? '<span class="dchip dc-new">新 ' + c[0] + '</span>' : '') +
        (c[1] ? '<span class="dchip dc-due">到期 ' + c[1] + '</span>' : '') + '</span>'
      : (total > 0 ? '<span class="deck-chips"><span class="dchip dc-done">已完成</span></span>' : '');
    return '<div class="list-item deck-item" data-act="deck-open" data-id="' + esc(d.id) + '">' +
      '<div class="avatar deck-av av-tone-' + (function () { let h = 0, k = String(d.id || d.name || ''); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return h % 8; })() + '">' + icon(isSat ? 'book' : 'layers', 'i20') + '</div>' +
      '<div class="li-main"><div class="deck-name-row">' +
      '<div class="name">' + esc(d.name) + '</div>' + chips +
      '<span class="deck-ring' + (pct >= 100 && total > 0 ? ' done' : '') + '" style="--p:' + pct + '" title="已掌握 ' + pct + '%"><b>' + pct + '%</b></span></div>' +
      '<div class="meta">' + (d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + mastered + ' / ' + total + ' 张' +
      (total && mastered >= total ? ' · 全部掌握' : '') + '</div>' +
      '<div class="progress deck-prog"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="li-actions"><span class="row-go">打开' + icon('chevronRight', 'i14') + '</span>' +
      '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(d.id) + '" title="更多操作">' + icon('more', 'i16') + '</button></div>' +
      '</div>';
  }

  // 词书页的系列入口：文件夹式卡片，展示分册数 / 词数 / 掌握进度
  function seriesFolderCard(app, series) {
    const ov = FC.seriesOverview ? FC.seriesOverview(app.state, series) : null;
    const vols = ov ? ov.volumes.length : 0;
    const total = ov ? ov.total : 0;
    const pct = ov ? ov.pct : 0;
    const loaded = ov ? ov.loaded : false;
    const accent = series.accent || 'brand';
    // 分册进度矩阵：每一小格 = 一个分册，颜色表示状态，一眼看全整套进度
    let matrix = '';
    if (loaded && ov.volumes.length) {
      for (let i = 0; i < ov.volumes.length; i++) {
        const v = ov.volumes[i];
        matrix += '<span class="sf-cell s-' + esc(v.status) + '" title="' + esc(v.name) + ' · 掌握 ' + v.mastered + '/' + v.cards + '"></span>';
      }
    }
    return '<div class="series-folder accent-' + esc(accent) + '" data-act="series-open" data-id="' + esc(series.id) + '">' +
      '<div class="sf-cover"><span class="sf-icon">' + icon(series.icon || 'folder', 'i24') + '</span></div>' +
      '<div class="sf-body">' +
      '<div class="sf-head"><div class="sf-name">' + esc(series.name) + '</div>' +
      '<span class="sf-badge">' + esc(loaded ? (pct + '%') : ((series.volCount || vols) + ' 册')) + '</span></div>' +
      '<div class="sf-meta">' + (loaded ? vols : (series.volCount || 0)) + ' 分册 · ' + (loaded ? total : (series.cardCount || 0)) + ' 卡' +
      (loaded ? (' · 掌握 ' + (ov ? ov.mastered : 0)) : ' · 待导入') + '</div>' +
      (matrix ? '<div class="sf-matrix">' + matrix + '</div>' : '') +
      '<div class="progress sf-prog"><span style="width:' + pct + '%"></span></div>' +
      '</div>' +
      '</div>';
  }

  // 牌组行的稳定配色（与卡片页一致：同一牌组颜色固定）
  function avToneOf(d) {
    const key = String((d && d.id) || (d && d.name) || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h % 8;
  }

  // 「所有牌组 / 文件夹」视图里的牌组行：点行=学习，另有 管理 / 更多
  function deckRowStudy(app, d, s, now) {
    const c = s.deckCounts(d, now);
    const total = d.cards.length;
    const isSat = (d.tags || []).indexOf('sat800') >= 0;
    const tone = avToneOf(d);
    let inProgress = 0;
    for (let k = 0; k < d.cards.length; k++) {
      const cc = d.cards[k];
      if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
    }
    const mastered = Math.max(0, total - c[0] - inProgress);
    const pct = total ? Math.round(mastered / total * 100) : 0;
    const chips = (c[0] || c[1])
      ? '<span class="deck-chips">' + (c[0] ? '<span class="dchip dc-new">新 ' + c[0] + '</span>' : '') +
        (c[1] ? '<span class="dchip dc-due">到期 ' + c[1] + '</span>' : '') + '</span>'
      : (total > 0 ? '<span class="deck-chips"><span class="dchip dc-done">今日已完成</span></span>' : '');
    return '<div class="list-item deck-item dt-' + tone + '" data-act="study-deck" data-id="' + esc(d.id) + '">' +
      '<div class="avatar deck-av av-tone-' + tone + '">' + icon(isSat ? 'book' : 'layers', 'i20') + '</div>' +
      '<div class="li-main"><div class="deck-name-row">' +
      '<div class="name">' + esc(d.name) + '</div>' + chips +
      '<span class="deck-ring' + (pct >= 100 && total > 0 ? ' done' : '') + '" style="--p:' + pct + '" title="已掌握 ' + pct + '%"><b>' + pct + '%</b></span></div>' +
      '<div class="meta">' + (d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + mastered + ' / ' + total + ' 张</div>' +
      '<div class="progress deck-prog"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="li-actions"><span class="row-go">' + (c[1] > 0 ? '继续' : '开始') + icon('chevronRight', 'i14') + '</span>' +
      '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(d.id) + '" title="更多操作">' + icon('more', 'i16') + '</button></div>' +
      '</div>';
  }

  // 「所有牌组」：侧栏默认入口。系列词书成组陈列，其余平铺。
  function allDecksPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
    const split = splitDecksBySeries(st, seriesList);
    let html = titlebar('所有牌组', st.decks.length + ' 个牌组 · 点牌组直接开始学习', {
      back: { act: 'folder-back' }
    }) + '<div class="content">' + dailyHeroHtml(app);
    if (!st.decks.length) {
      html += emptyBox('layers', '还没有牌组。点侧栏底部的「导入」拿一份词库，或去「工坊」自己做。');
    } else {
      for (let si = 0; si < seriesList.length; si++) {
        const se = seriesList[si];
        const ds = split.bySeries[se.id];
        if (!ds || !ds.length) continue;
        const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
        html += '<div class="series-group' + (collapsed ? ' collapsed' : '') + '">' +
          '<div class="sg-head"><button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>' +
          '<span class="sg-name">' + esc(se.name) + '</span>' +
          '<span class="sg-meta">' + ds.length + ' 个分册</span>' +
          '<button class="btn btn-sm sg-go" data-act="series-open" data-id="' + esc(se.id) + '">查看系列</button></div>';
        for (let i = 0; i < ds.length; i++) html += deckRowStudy(app, ds[i], s, now);
        html += '</div>';
      }
      if (split.userDecks.length) {
        html += '<div class="section-title">牌组 · 自建</div>';
        for (let i = 0; i < split.userDecks.length; i++) html += deckRowStudy(app, split.userDecks[i], s, now);
      }
    }
    html += '</div>';
    return html + tabbar(app.tab, app);
  }

  // 系列详情页：顶部概览 + 建议 + 分册网格
  // 文件夹详情：列出该自定义文件夹下的牌组，点牌组进入卡片管理
  function folderPage(app) {
    const st = app.state;
    if (app.folderId === '__all') return allDecksPage(app);
    const f = FC.folderById(st, app.folderId);
    if (!f) { app.folderId = ''; return wordBookPage(app); }
    const ds = FC.decksInFolder(st, f.id);
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    let html = titlebar(f.name, '文件夹 · ' + ds.length + ' 个牌组', {
      back: { act: 'folder-back' },
      actions: '<button class="btn btn-sm" data-act="folder-rename" data-id="' + esc(f.id) + '">' + icon('pencil', 'i14') + '重命名</button>' +
        '<button class="btn btn-sm btn-danger" data-act="folder-delete" data-id="' + esc(f.id) + '">' + icon('trash', 'i14') + '删除</button>'
    }) + '<div class="content">';
    if (!ds.length) {
      html += emptyBox('folder', '这个文件夹还是空的。在「所有牌组」里点牌组的「更多」→「移动到文件夹」即可归入。');
    } else {
      for (let i = 0; i < ds.length; i++) html += deckListItem(app, ds[i], s, now, false);
    }
    html += '</div>';
    return html + tabbar(app.tab, app);
  }

  function seriesPage(app) {
    const series = FC.seriesById ? FC.seriesById(app.seriesId, app.state) : null;
    if (!series) {
      return titlebar('系列', '未找到该系列', { actions: '<button class="btn btn-sm" data-act="series-back">返回词书</button>' }) +
        '<div class="content"><div class="card wide subtle">系列不存在或已被移除。</div></div>' + tabbar(1, app);
    }
    const ov = FC.seriesOverview ? FC.seriesOverview(app.state, series) : null;
    const accent = series.accent || 'brand';
    const s = new FC.Scheduler(app.state.settings);
    const now = Date.now();

    let html = titlebar(series.name, '系列 · ' + (series.subtitle || ''), {
      actions: '<button class="btn btn-sm" data-act="series-back">' + icon('chevronLeft', 'i14') + '返回词书</button>' +
        (ov && ov.loaded ? '<button class="btn btn-sm btn-primary" data-act="series-export" data-id="' + esc(series.id) + '">' +
          icon('upload', 'i14') + '导出词库</button>' : '') +
        (ov && ov.loaded ? '<button class="btn btn-sm btn-danger" data-act="series-delete" data-id="' + esc(series.id) + '">' +
          icon('trash', 'i14') + '删除整个词库</button>' : '')
    }) + '<div class="content">';

    // 系列头：文件夹封面 + 指标 + 进度环 + 建议条（复用克制仪表盘风）
    const adv = ov.advice;
    const ctaCls = adv.tone === 'brand' ? 'btn-primary' : (adv.tone === 'green' ? 'btn-accent' : 'btn-sm');
    const figs = function (v, k, tone) {
      return '<div class="ov-fig' + (tone ? ' tone-' + tone : '') + '"><b>' + esc(v) + '</b><span>' + esc(k) + '</span></div>';
    };
    html += '<div class="overview-hero series-hero accent-' + esc(accent) + '">' +
      '<div class="ov-body"><div class="series-cover accent-' + esc(accent) + '">' + icon(series.icon || 'folder', 'i44') + '</div>' +
      '<div class="ov-left">' +
      '<div class="ov-date">系列 · 可导入词库 · ' + (series.source ? esc(series.source) : '') + '</div>' +
      '<div class="ov-hello">' + esc(series.name) + '</div>' +
      '<div class="ov-caption">' + esc(series.description || series.subtitle || '') + '</div>' +
      '<div class="ov-figs">' +
      figs(ov.loaded ? ov.volumes.length : (series.volCount || 0), '分册') +
      figs(ov.loaded ? ov.total : (series.cardCount || 0), '总卡片') +
      figs(ov.mastered, '已掌握', 'brand') +
      figs(ov.due, '待复习', 'amber') +
      '</div></div>' +
      '<div class="ov-ring" style="--pct:' + ov.pct + '"><div class="ov-ring-in">' +
      '<b>' + ov.pct + '%</b><span>掌握进度</span></div></div></div>' +
      '<div class="ov-advice tone-' + esc(adv.tone) + '">' +
      '<span class="ov-adv-ico">' + icon(adv.icon, 'i18') + '</span>' +
      '<div class="ov-adv-txt"><div class="ov-adv-title">' + esc(adv.title) + '</div>' +
      '<div class="ov-adv-desc">' + esc(adv.desc) + '</div></div>' +
      '<button class="btn btn-sm ' + ctaCls + '" data-act="' + esc(adv.act) + '"' +
      (adv.sid ? ' data-id="' + esc(adv.sid) + '"' : '') +
      (adv.tab !== undefined ? ' data-tab="' + adv.tab + '"' : '') + '>' + esc(adv.cta) + '</button>' +
      '</div></div>';

    if (!ov.loaded) {
      html += '<div class="card wide series-note">' + icon('download', 'i18') +
        '<span>本系列是独立词库文件，尚未导入。请在软件旁的 <b>decks</b> 文件夹中找到 <b>' + esc(series.file || '对应 .srcd') + '</b>，点击右侧按钮选择它。导入后 ' +
        (series.volCount || 0) + ' 个分册会作为独立牌组出现在「卡片」页，进度在此汇总。</span>' +
        '<button class="btn btn-primary btn-sm" data-act="series-import" data-id="' + esc(series.id) + '">导入卡片</button></div>';
    } else {
      html += '<div class="section-title">' + icon('layers', 'i14') + '分册目录 · 按 List 顺序学习</div>';
      html += '<div class="series-vols">';
      for (let i = 0; i < ov.volumes.length; i++) {
        const v = ov.volumes[i];
        const stIcon = v.status === 'mastered' ? 'checkCircle' : (v.status === 'learning' ? 'rotate' :
          (v.status === 'progress' ? 'play' : 'play'));
        const stText = v.status === 'mastered' ? '已掌握' : (v.status === 'learning' ? '巩固中' :
          (v.status === 'progress' ? '学习中' : '未开始'));
        const todo = ' · 待学 ' + (v.fresh + v.due) + (v.due ? '（复习 ' + v.due + '）' : '');
        html += '<div class="vol-card status-' + esc(v.status) + '">' +
          '<div class="vol-top">' +
          '<div class="vol-no">' + esc(v.label) + '</div>' +
          '<span class="vol-status s-' + esc(v.status) + '">' + icon(stIcon, 'i14') + esc(stText) + '</span>' +
          '</div>' +
          '<div class="vol-cards">' + v.cards + ' 张卡' + todo + '</div>' +
          '<div class="progress vol-prog"><span style="width:' + v.pct + '%"></span></div>' +
          '<div class="vol-mastered">已掌握 ' + v.mastered + ' / ' + v.cards + '</div>' +
          '<div class="vol-actions">' +
          '<button class="btn btn-sm btn-primary" data-act="study-deck" data-id="' + esc(v.id) + '">' + icon('play', 'i14') + '学习</button>' +
          '<button class="btn btn-sm" data-act="deck-open" data-id="' + esc(v.id) + '">管理</button>' +
          '<button class="btn btn-sm btn-more" data-act="deck-menu" data-id="' + esc(v.id) + '" title="更多操作">' + icon('more', 'i16') + '</button>' +
          '</div></div>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html + tabbar(1, app);
  }

  function bookCard(app, b, prog, custom) {
    const pct = b.words.length ? Math.round(prog[0] / b.words.length * 100) : 0;
    return '<div class="book-card">' +
      '<div class="row" style="align-items:flex-start">' +
      '<div class="avatar">' + icon('book', 'i20') + '</div>' +
      '<div class="li-main"><div class="name">' + esc(b.name) + '</div>' +
      '<div class="meta">' + (b.category ? esc(b.category) + ' · ' : '') + b.words.length + ' 词</div></div>' +
      '</div>' +
      '<div class="progress" style="margin-top:14px"><span style="width:' + pct + '%"></span></div>' +
      '<div class="between" style="margin-top:8px">' +
      '<span class="subtle">已掌握 ' + prog[0] + ' / ' + b.words.length + '</span>' +
      '<span class="subtle">模糊 ' + prog[1] + '</span></div>' +
      '<div class="book-actions">' +
      '<button class="btn btn-sm btn-primary" data-act="wb-start" data-id="' + esc(b.id) + '">' +
      icon('play', 'i14') + '学习</button>' +
      '<button class="btn btn-sm" data-act="wb-review" data-id="' + esc(b.id) + '">复习模糊</button>' +
      (custom ? '<span style="flex:1"></span><button class="btn btn-sm btn-danger" data-act="wb-del" data-id="' +
        esc(b.id) + '">' + icon('trash', 'i14') + '</button>' : '') +
      '</div></div>';
  }

  function wordBookSession(app) {
    const w = app.wb;
    // 会话数据可能来自旧版本本地存档：字段缺失时不要抛错白屏，给一个可退出的提示页
    if (!w || !w.queue || !w.words) {
      return '<div class="fullscreen"><div class="battle-head"><div class="h-title">词书学习</div></div>' +
        '<div class="study-area"><div class="card" style="text-align:center;max-width:360px;padding:28px 22px;margin:0">' +
        '<div style="font-weight:700;font-size:16px">这次学习记录无法恢复</div>' +
        '<div class="subtle" style="margin-top:8px">进度数据不完整，返回后重新选择词书即可。</div>' +
        '<button class="btn btn-primary" style="margin-top:18px" data-act="wb-stop">返回</button>' +
        '</div></div></div>';
    }
    const total = w.queue.length;
    const pct = total ? Math.round(w.pos / total * 100) : 0;
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title">' + esc(w.bookName) + '</div>' +
      '<div class="subtle" style="margin-top:3px">' + (w.mode === 1 ? '复习模糊词' : '顺序学习') +
      ' · ' + w.pos + ' / ' + total + '</div></div>' +
      '<button class="btn btn-sm btn-ghost" data-act="wb-stop">退出</button></div>' +
      '<div class="progress" style="margin-top:14px"><span style="width:' + pct + '%"></span></div></div>';

    if (w.pos >= w.queue.length) {
      html += '<div class="study-area"><div class="card" style="text-align:center;width:100%;max-width:350px;padding:32px 22px;margin:0">' +
        '<div style="display:flex;justify-content:center;color:var(--green)">' + icon('checkCircle', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:14px">本轮完成</div>' +
        '<div class="subtle" style="margin-top:8px">认识 ' + w.known + ' · 模糊 ' + w.fuzzy + ' · 不认识 ' + w.unknown + '</div>' +
        '<button class="btn btn-primary" style="margin-top:20px" data-act="wb-stop">返回</button></div></div>';
      return html + '</div>';
    }
    const entry = w.words[w.queue[w.pos]];
    html += '<div class="study-area"><div class="flip-card" data-act="wb-flip">' +
      '<div class="flip-inner ' + (w.revealed ? 'flipped' : '') + '">' +
      '<div class="flip-face flip-front"><div class="wb-word">' + esc(entry.word) + '</div>' +
      '<div class="wb-phon">' + esc(entry.phonetic) + '</div>' +
      '<div class="flip-hint">点击 / 空格 看释义</div></div>' +
      '<div class="flip-face flip-back"><div class="wb-mean">' + esc(entry.meaning) + '</div>' +
      '<div class="wb-ex">' + esc(entry.example) + '<br>' + esc(entry.exampleCn) + '</div>' +
      '<div class="flip-hint">空格 = 认识 · 1-3 评分</div></div></div></div></div>';

    if (w.revealed) {
      html += '<div class="wb-actions">' +
        '<button class="btn r1" data-act="wb-rate" data-status="0">不认识</button>' +
        '<button class="btn r2" data-act="wb-rate" data-status="1">模糊</button>' +
        '<button class="btn btn-primary" data-act="wb-rate" data-status="2">认识</button>' +
        '</div>';
    } else {
      html += '<div class="rate-bar"><button class="rate-btn r3" data-act="wb-flip">' +
        '<span class="rate-key">Enter / Space</span>' +
        '<span class="rate-label">显示释义</span>' +
        '<span class="rate-meta">翻面看答案 · 按 Enter 或空格</span></button></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 班级
  // ---------------------------------------------------------------- 班级（真实班级 · 密钥加入）
  function classTag(role) {
    if (role === 'owner') return '<span class="cls-tag owner">创建者</span>';
    if (role === 'admin') return '<span class="cls-tag">管理员</span>';
    return '';
  }

  function classKeyText(k) {
    return FC.Classroom ? FC.Classroom.fmtKey(k) : String(k || '');
  }

  function classLoginCard(text) {
    return '<div class="card wide cls-login">' +
      '<div class="cls-login-ico">' + icon('key', 'i26') + '</div>' +
      '<div class="cls-login-t">' + esc(text) + '</div>' +
      '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="class-login">' +
      icon('lock', 'i16') + '登录后使用班级</button>' +
      '<div class="hint" style="margin-top:10px">班级和密钥存放在云端，换设备也能加入。没有账号的话，用邮箱收验证码即可，几秒钟。</div>' +
      '</div>';
  }

  function classInvalidate(app) {
    app._clsState = null;
    app._clsDetail = null;
  }

  function classEnsureList(app) {
    const st = app._clsState || (app._clsState = { list: null, loading: false, err: null });
    if (st.list !== null || st.loading) return st;
    st.loading = true; st.err = null;
    FC.Classroom.list().then(function (r) {
      st.loading = false;
      if (r && r.ok) { st.list = r.classes || []; }
      else if (r && r.code === 'no_auth') { st.list = null; st.err = 'no_auth'; }
      else { st.err = (r && r.msg) || '班级加载失败'; }
      app.render();
    }).catch(function (e) {
      st.loading = false; st.err = (e && e.message) || '网络错误';
      app.render();
    });
    return st;
  }

  function classroomList(app) {
    const clsReady = !!(FC.Classroom && FC.Classroom.available());
    const clsIn = !!(FC.Classroom && FC.Classroom.hasSession());
    let html = titlebar('班级', '一起攒学习量', {
      actions: clsIn ? '<button class="btn btn-sm btn-primary" data-act="class-new">' + icon('plus', 'i14') + '创建班级</button>' : ''
    }) + '<div class="content">';

    if (!FC.Classroom || !FC.Classroom.available()) {
      html += emptyBox('cloud', '云同步还没配置，班级功能暂时不可用。');
      return html + '</div>' + tabbar(2, app);
    }
    if (!FC.Classroom.hasSession()) {
      html += classLoginCard('班级是真实存在的：建班后给你一个 8 位密钥，同学用这个密钥就能加进来，一起攒学习量。');
      return html + '</div>' + tabbar(2, app);
    }

    const st = classEnsureList(app);

    html += '<button class="btn btn-block cls-join-btn" data-act="class-join">' +
      icon('key', 'i16') + '用密钥加入班级</button>';

    if (st.err === 'no_auth') {
      html += classLoginCard('登录状态过期了，重新登录一次就能继续用班级。');
      return html + '</div>' + tabbar(2, app);
    }
    if (st.err) {
      html += '<div class="card wide" style="text-align:center;padding:26px 20px">' +
        '<div class="cls-login-t">' + esc(st.err) + '</div>' +
        '<button class="btn" style="margin-top:12px" data-act="class-refresh">' + icon('rotate', 'i14') + '重试</button></div>';
      return html + '</div>' + tabbar(2, app);
    }
    if (st.loading && st.list === null) {
      html += '<div class="card wide"><div class="subtle">正在同步班级…</div></div>';
      return html + '</div>' + tabbar(2, app);
    }
    if (!st.list || st.list.length === 0) {
      html += emptyBox('users', '还没有班级。建一个，同学用密钥进来一起攒。', '创建班级', 'class-new');
      return html + '</div>' + tabbar(2, app);
    }

    for (let i = 0; i < st.list.length; i++) {
      const c = st.list[i];
      const key = classKeyText(c.join_key);
      html += '<div class="list-item cls-item" data-act="class-open" data-id="' + esc(c.id) + '">' +
        '<div class="avatar">' + icon('users', 'i20') + '</div>' +
        '<div class="li-main">' +
        '<div class="name">' + esc(c.name) + classTag(c.role) + '</div>' +
        '<div class="meta">' + esc(key) + ' · ' + c.member_count + ' 人 · 今日 ' + (c.today_cards || 0) + '</div>' +
        '</div>' +
        '<div class="cls-mine"><b>' + (c.my_today || 0) + '</b><i>我今天</i></div>' +
        '<span class="chev">' + icon('chevronRight', 'i18') + '</span></div>';
    }
    html += '</div>';
    return html + tabbar(2, app);
  }

  function classEnsureDetail(app, id) {
    const cache = app._clsDetail || (app._clsDetail = {});
    const rec = cache[id];
    if (rec && (rec.loading || rec.data || rec.err)) return rec;
    const slot = cache[id] = { loading: true, data: null, err: null };
    FC.Classroom.detail(id).then(function (r) {
      slot.loading = false;
      if (r && r.ok) { slot.data = r; }
      else { slot.err = (r && r.msg) || '班级加载失败'; if (r && (r.code === 'not_member' || r.code === 'not_found')) slot.gone = true; }
      app.render();
    }).catch(function (e) {
      slot.loading = false; slot.err = (e && e.message) || '网络错误';
      app.render();
    });
    return slot;
  }

  function classroomDetail(app) {
    const id = app.activeClassId;

    if (!FC.Classroom || !FC.Classroom.hasSession()) {
      return titlebar('班级', '', { back: { act: 'class-back' } }) +
        '<div class="content">' + classLoginCard('登录后就能看到这个班级的学习量榜。') + '</div>' + tabbar(2, app);
    }

    const rec = classEnsureDetail(app, id);

    if (!rec || rec.loading) {
      return titlebar('班级', '正在加载…', { back: { act: 'class-back' } }) +
        '<div class="content"><div class="card wide"><div class="subtle">正在同步班级…</div></div></div>' + tabbar(2, app);
    }
    if (rec.gone) {
      return titlebar('班级', '', { back: { act: 'class-back' } }) +
        '<div class="content">' + emptyBox('users', '这个班级不在了，或者你已经不在里面。') + '</div>' + tabbar(2, app);
    }
    if (rec.err) {
      return titlebar('班级', '', { back: { act: 'class-back' } }) +
        '<div class="content"><div class="card wide" style="text-align:center;padding:26px 20px">' +
        '<div class="cls-login-t">' + esc(rec.err) + '</div>' +
        '<button class="btn" style="margin-top:12px" data-act="class-refresh-detail">' + icon('rotate', 'i14') + '重试</button></div></div>' +
        tabbar(2, app);
    }

    const d = rec.data || {};
    const c = d.class || {};
    const members = d.members || [];
    const sum = d.summary || {};
    const totalGoal = Math.max(1, c.total_goal || 1);
    const done = sum.total || 0;
    const pct = Math.min(100, Math.round(done / totalGoal * 100));
    const key = classKeyText(c.join_key);
    const isOwner = c.my_role === 'owner';

    let html = titlebar(c.name || '班级', c.slogan || ('班级 · ' + members.length + ' 人'), {
      back: { act: 'class-back' },
      actions: '<button class="btn btn-sm" data-act="class-copy-key" data-key="' + esc(c.join_key || '') + '">' +
        icon('key', 'i14') + '邀请</button>'
    }) + '<div class="content">';

    // 密钥 + 目标 + 进度
    html += '<div class="card wide cls-hero">' +
      '<div class="cls-hero-row">' +
      '<div class="cls-keyblock"><div class="subtle">班级密钥</div>' +
      '<div class="cls-key">' + esc(key) + '</div></div>' +
      '<div class="cls-hero-acts">' +
      '<button class="btn btn-sm" data-act="class-copy-key" data-key="' + esc(c.join_key || '') + '">' +
      icon('clipboard', 'i14') + '复制</button>' +
      (isOwner ? '<button class="btn btn-sm" data-act="class-new-key" data-id="' + esc(c.id) + '">换一个</button>' : '') +
      '</div></div>' +
      '<div class="cls-goals">' +
      '<span>每日目标 <b>' + (c.daily_goal || 0) + '</b> 张</span>' +
      '<span>总目标 <b>' + (c.total_goal || 0) + '</b> 张</span>' +
      '<span>成员 <b>' + members.length + '/' + (c.max_members || 0) + '</b></span>' +
      (c.ends_on ? '<span>截止 <b>' + esc(c.ends_on) + '</b></span>' : '<span>长期有效</span>') +
      '</div>' +
      '<div class="progress" style="margin-top:14px"><span style="width:' + pct + '%"></span></div>' +
      '<div class="between" style="margin-top:8px">' +
      '<span class="subtle">已攒 ' + done + ' / ' + totalGoal + ' 张</span>' +
      '<span class="subtle">' + (done >= totalGoal ? '已达成' : (pct + '%')) + '</span></div>' +
      '</div>';

    html += '<div class="cls-stats">' +
      '<div class="cls-stat accent"><b>' + (sum.today || 0) + '</b><i>今日 · 全班</i></div>' +
      '<div class="cls-stat"><b>' + (sum.week || 0) + '</b><i>本周 · 全班</i></div>' +
      '<div class="cls-stat"><b>' + done + '</b><i>累计 · 全班</i></div>' +
      '</div>';

    html += '<div class="section-title">学习量榜</div>';
    if (members.length === 0) {
      html += emptyBox('trophy', '还没有成员，把密钥发给同学吧。');
    } else {
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const g = i === 0 ? 'g1' : i === 1 ? 'g2' : i === 2 ? 'g3' : '';
        html += '<div class="list-item cls-row">' +
          '<span class="rank ' + g + '">' + (i + 1) + '</span>' +
          '<div class="avatar cls-ava">' + esc(String(m.nickname || '同').slice(0, 1)) + '</div>' +
          '<div class="li-main">' +
          '<div class="name" style="font-size:14.5px">' + esc(m.nickname || '同学') + classTag(m.role) + '</div>' +
          '<div class="meta">今日 ' + (m.today || 0) + ' 张 · 连续 ' + (m.streak || 0) + ' 天</div>' +
          '</div>' +
          '<div class="cls-total"><b>' + (m.total || 0) + '</b><i>累计</i></div>' +
          '</div>';
      }
    }

    html += '<div class="cls-foot">';
    if (isOwner) {
      html += '<div class="subtle" style="text-align:center">你是这个班级的创建者，密钥可以随时换一个（换完旧密钥立即失效）。</div>';
    } else {
      html += '<button class="btn btn-danger btn-block" data-act="class-leave" data-id="' + esc(c.id) + '">退出这个班级</button>';
    }
    html += '</div>';

    html += '</div>';
    return html + tabbar(2, app);
  }
  function deskmatePage(app) {
    const mates = app.state.deskmates || [];
    const inbox = app.inviteInbox || { items: [], loading: false, error: '' };
    let html = titlebar('同桌', '互相看一眼进度', {
      actions: '<button class="btn btn-sm" data-act="community-open">' + icon('chat', 'i14') + '去社区</button>' +
        (mates.length ? '<button class="btn btn-sm btn-primary" data-act="deskmate-add">' + icon('plus', 'i14') + '添加同桌</button>' : '')
    }) + '<div class="content">';

    // 收到的邀请（来自社区里别人的「加为同桌」）
    if (inbox.items.length) {
      html += '<div class="section-title">' + icon('userPlus', 'i14') + '收到的邀请</div>';
      for (let i = 0; i < inbox.items.length; i++) {
        const inv = inbox.items[i];
        html += '<div class="card wide invite-card">' +
          '<span class="ava ava-c0">' + esc(String(inv.from_name || '学').slice(0, 1)) + '</span>' +
          '<div class="li-main"><div class="name">' + esc(inv.from_name || '学习者') + '</div>' +
          '<div class="meta">' + (inv.message ? esc(inv.message) : '想和你做同桌，一起打卡') + '</div></div>' +
          '<div class="invite-acts">' +
          '<button class="btn btn-sm btn-primary" data-act="invite-accept" data-id="' + esc(inv.id) + '" data-uid="' + esc(inv.from_user || '') + '" data-name="' + esc(inv.from_name || '同桌') + '">接受</button>' +
          '<button class="btn btn-sm" data-act="invite-decline" data-id="' + esc(inv.id) + '">忽略</button>' +
          '</div></div>';
      }
    } else if (inbox.loading) {
      html += '<div class="subtle" style="padding:4px 2px 10px">正在查看有没有人邀请你…</div>';
    } else if (inbox.error) {
      html += '<div class="subtle" style="padding:4px 2px 10px;color:var(--red)">' + esc(inbox.error) + '</div>';
    }

    if (mates.length === 0) {
      // 没有同桌：主路径是去社区找人，手动添加作为兜底
      html += '<div class="card wide empty-mate">' +
        '<div class="empty-ico">' + icon('link', 'i32') + '</div>' +
        '<div class="empty-t">还没有同桌</div>' +
        '<div class="subtle" style="margin-top:8px;max-width:320px">社区里都是正在背单词的人。看到合适的，点一下「加为同桌」，对方同意后就能互相看到每天的进度。</div>' +
        '<div class="row-gap" style="justify-content:center;margin-top:18px">' +
        '<button class="btn btn-primary" data-act="community-open">' + icon('chat', 'i16') + '去社区找人</button>' +
        '<button class="btn" data-act="deskmate-add">' + icon('plus', 'i16') + '手动添加</button>' +
        '</div></div>';
    } else {
      for (let i = 0; i < mates.length; i++) {
        const d = mates[i];
        html += '<div class="list-item">' +
          '<div class="avatar">' + icon('link', 'i18') + '</div>' +
          '<div class="li-main"><div class="name" style="font-size:14.5px">' + esc(d.name) + '</div>' +
          '<div class="meta">' + (d.note ? esc(d.note) + ' · ' : '') + '连续 ' + d.days + ' 天 · ' + d.score + ' 分</div></div>' +
          '<div style="display:flex;gap:6px;flex:none">' +
          '<button class="btn btn-sm" data-act="deskmate-urge" data-id="' + esc(d.id) + '">督促</button>' +
          '<button class="btn btn-sm btn-danger" data-act="deskmate-del" data-id="' + esc(d.id) + '">' +
          icon('trash', 'i14') + '</button>' +
          '</div></div>';
      }
      html += '<button class="btn btn-sm btn-block" style="margin-top:12px" data-act="community-open">' +
        icon('chat', 'i14') + '去社区再加几个同桌</button>';
    }
    html += '</div>';
    return html + tabbar(3, app);
  }

  // ---------------------------------------------------------------- 社区
  // 时间：社区里只写「刚刚 / 12 分钟前 / 3 小时前 / 11-19」，不显示具体秒
  function agoText(iso) {
    const t = Date.parse(iso);
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
    const d = new Date(t);
    return (d.getMonth() + 1) + '-' + d.getDate();
  }
  function sizeText(n) {
    const b = Number(n) || 0;
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function communityLoginCard(app) {
    const l = app.communityLogin || {};
    return '<div class="card wide community-login">' +
      '<div class="empty-ico">' + icon('chat', 'i32') + '</div>' +
      '<div class="empty-t">登录后进社区</div>' +
      '<div class="subtle" style="margin-top:8px;max-width:340px">社区里的帖子、评论和同桌邀请都要有一个身份，用邮箱验证码登录即可，不需要密码。</div>' +
      (l.msg ? '<div class="cs-msg" style="color:' + (l.error ? 'var(--red)' : 'var(--brand)') + '">' + esc(l.msg) + '</div>' : '') +
      '<div class="field" style="margin-top:14px"><label>邮箱</label>' +
      '<input id="ccEmail" type="email" value="' + esc(l.email || '') + '" placeholder="name@example.com" autocomplete="email" /></div>' +
      '<div class="field"><label>验证码</label><div class="otp-row">' +
      '<input id="ccCode" type="text" inputmode="numeric" maxlength="6" value="' + esc(l.code || '') + '" placeholder="收到的验证码" autocomplete="one-time-code" />' +
      '<button class="btn btn-sm" data-act="community-login-send">发验证码</button></div></div>' +
      '<button class="btn btn-primary btn-block" data-act="community-login-submit">登录</button>' +
      '</div>';
  }

  function postCard(app, p) {
    const me = (FC.Community && FC.Community.uid) ? FC.Community.uid() : '';
    const mine = !!me && p.authorId === me;
    const liked = !!(app.communityLiked && app.communityLiked[p.id]);
    const mateUids = app.deskmateUidSet || {};
    const outSet = app.communityOutSet || {};
    let mateBtn = '';
    if (!mine) {
      if (mateUids[p.authorId]) {
        mateBtn = '<button class="btn btn-sm" disabled>已是同桌</button>';
      } else if (outSet[p.authorId]) {
        mateBtn = '<button class="btn btn-sm" disabled>已发邀请</button>';
      } else {
        mateBtn = '<button class="btn btn-sm btn-soft" data-act="post-invite" data-id="' + esc(p.authorId) + '" data-name="' + esc(p.authorName) + '">' +
          icon('userPlus', 'i14') + '加为同桌</button>';
      }
    }
    let blockBtn = '';
    if (!mine && me) {
      const blArr = app.account.blacklist || [];
      let isBl = false;
      for (let bi = 0; bi < blArr.length; bi++) if (blArr[bi].id === p.authorId) { isBl = true; break; }
      blockBtn = '<button class="post-act' + (isBl ? ' on' : '') + '" data-act="post-block" data-id="' + esc(p.authorId) + '" data-name="' + esc(p.authorName || '') + '">' +
        icon('closeCircle', 'i16') + '<span>' + (isBl ? '已拉黑' : '拉黑') + '</span></button>';
    }
    let res = '';
    if (p.kind === 'resource' && p.resourcePath) {
      res = '<div class="post-res">' +
        '<span class="pr-ico">' + icon('package', 'i16') + '</span>' +
        '<div class="pr-main"><b>' + esc(p.deckName || '分享的词库') + '</b>' +
        '<small>' + p.deckWords + ' 张卡 · ' + sizeText(p.resourceSize) + '</small></div>' +
        '<button class="btn btn-sm btn-primary" data-act="post-import" data-id="' + esc(p.id) + '" data-path="' + esc(p.resourcePath) + '" data-name="' + esc(p.deckName || 'shared') + '">导入</button>' +
        '</div>';
    }
    return '<article class="post card wide" data-id="' + esc(p.id) + '">' +
      '<header class="post-head">' +
      '<span class="ava ava-c' + (Number(p.avatarColor) % 6) + '">' + esc(String(p.authorName || '学').slice(0, 1)) + '</span>' +
      '<div class="post-who"><b>' + esc(p.authorName || '学习者') + '</b><small>' + esc(agoText(p.createdAt)) +
      (p.kind === 'resource' ? ' · 分享了词库' : '') + '</small></div>' +
      mateBtn +
      blockBtn +
      '</header>' +
      (p.title ? '<h3 class="post-title">' + esc(p.title) + '</h3>' : '') +
      (p.body ? '<p class="post-body">' + esc(p.body) + '</p>' : '') +
      res +
      '<footer class="post-acts">' +
      '<button class="post-act' + (liked ? ' on' : '') + '" data-act="post-like" data-id="' + esc(p.id) + '">' +
      icon('heart', 'i16') + '<span>' + (p.likeCount || 0) + '</span></button>' +
      '<button class="post-act" data-act="post-open" data-id="' + esc(p.id) + '">' +
      icon('comment', 'i16') + '<span>' + (p.commentCount || 0) + '</span></button>' +
      (mine ? '<button class="post-act del" data-act="post-del" data-id="' + esc(p.id) + '">' + icon('trash', 'i16') + '</button>' : '') +
      '</footer></article>';
  }

  function communityDetail(app) {
    const d = app.communityDetail || { loading: true };
    let html = titlebar('帖子', '评论与回复', {
      back: { act: 'post-back' },
      actions: '<button class="btn btn-sm" data-act="community-open">' + icon('chat', 'i14') + '回社区</button>'
    }) + '<div class="content">';
    if (d.loading) return html + '<div class="subtle" style="padding:16px 2px">正在打开…</div></div>' + tabbar(8, app);
    if (d.error) return html + '<div class="subtle" style="padding:16px 2px;color:var(--red)">' + esc(d.error) + '</div></div>' + tabbar(8, app);
    if (!d.post) return html + emptyBox('comment', '这个帖子已经不在了') + '</div>' + tabbar(8, app);
    html += postCard(app, d.post);
    html += '<div class="section-title">' + icon('comment', 'i14') + '评论 ' + (d.comments || []).length + '</div>';
    if (!(d.comments || []).length) {
      html += '<div class="subtle" style="padding:2px 2px 12px">还没有人说话，你可以先留一句。</div>';
    } else {
      for (let i = 0; i < d.comments.length; i++) {
        const c = d.comments[i];
        html += '<div class="cmt">' +
          '<span class="ava ava-c0 ava-xs">' + esc(String(c.authorName || '学').slice(0, 1)) + '</span>' +
          '<div class="cmt-main"><div class="cmt-who"><b>' + esc(c.authorName || '学习者') + '</b>' +
          '<small>' + esc(agoText(c.createdAt)) + '</small></div>' +
          '<div class="cmt-body">' + esc(c.body) + '</div></div></div>';
      }
    }
    html += '<div class="cmt-form">' +
      '<textarea id="cmtInput" rows="2" maxlength="500" placeholder="说点什么，别只发「111」"></textarea>' +
      '<button class="btn btn-primary btn-sm" data-act="comment-add">发送</button></div>';
    html += '</div>';
    return html + tabbar(8, app);
  }

  function communityPage(app) {
    const logged = !!(FC.Community && FC.Community.session && FC.Community.session());
    if (!logged) {
      return titlebar('社区', '发帖 · 分享词库 · 找同桌') + '<div class="content">' +
        communityLoginCard(app) + '</div>' + tabbar(8, app);
    }
    if (app.communityPostId) return communityDetail(app);

    const c = app.community || { items: [], loading: false, error: '', loaded: false };
    let html = titlebar('社区', '发帖 · 分享词库 · 找同桌', {
      actions: '<button class="btn btn-sm btn-primary" data-act="community-post">' + icon('plus', 'i14') + '发帖</button>'
    }) + '<div class="content">';

    if (c.error) {
      html += '<div class="card wide" style="border-color:var(--red-soft)">' +
        '<div class="post-body" style="color:var(--red)">' + esc(c.error) + '</div>' +
        '<button class="btn btn-sm" style="margin-top:10px" data-act="community-refresh">重试</button></div>';
    }
    if (c.loading && !c.items.length) {
      html += '<div class="subtle" style="padding:16px 2px">正在加载社区…</div>';
    } else if (!c.loading && !c.items.length && !c.error) {
      html += '<div class="card wide empty-mate">' +
        '<div class="empty-ico">' + icon('chat', 'i32') + '</div>' +
        '<div class="empty-t">还没有人发帖</div>' +
        '<div class="subtle" style="margin-top:8px">你可以第一个：说说今天背了多少，或者把整理好的词库分享出来。</div>' +
        '<button class="btn btn-primary" style="margin-top:16px" data-act="community-post">' + icon('plus', 'i16') + '发第一条</button>' +
        '</div>';
    } else {
      for (let i = 0; i < c.items.length; i++) html += postCard(app, c.items[i]);
      if (c.items.length >= 20) {
        html += '<button class="btn btn-sm btn-block" style="margin-top:10px" data-act="community-more">加载更早的帖子</button>';
      }
    }
    html += '</div>';
    return html + tabbar(8, app);
  }

  // ---------------------------------------------------------------- PK
  function battleConfig(app) {
    const books = app.battleBooks ? app.battleBooks() : allBooks(app);
    let html = titlebar('比赛', '同屏轮流，答对得分') + '<div class="content">';
    if (!books.length) {
      html += '<div class="card wide" style="text-align:center;padding:34px 22px">' +
        '<div style="display:flex;justify-content:center;color:var(--brand)">' + icon('zap', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:17px;margin-top:14px">还没有可以比赛的词库</div>' +
        '<div class="subtle" style="margin-top:8px">导入一个词库（.srcd / Anki .apkg）或新建牌组，至少 4 张卡片就能开局。</div>' +
        '<div class="row-gap" style="justify-content:center;margin-top:18px">' +
        '<button class="btn btn-primary" data-act="import-hub">' + icon('download', 'i16') + '导入词库</button>' +
        '<button class="btn" data-act="new-deck">' + icon('plus', 'i16') + '新建牌组</button>' +
        '</div></div>';
      return html + '</div>' + tabbar(4, app);
    }
    html += '<div class="pk-hero wide">' +
      '<div class="pk-side"><span class="pk-ava">我</span><b>你</b><small>先手</small></div>' +
      '<span class="pk-vs">VS</span>' +
      '<div class="pk-side pk-right"><span class="pk-ava pk-ava-alt">?</span><b>对手</b><small>2 – 4 人</small></div>' +
      '</div>';
    html += '<div class="card wide">' +
      '<div class="field"><label>用哪本词书</label><select id="battleBook">' +
      books.map(function (b) {
        return '<option value="' + esc(b.id) + '"' + (b.id === app.battleBookId ? ' selected' : '') + '>' +
          esc(b.name) + '（' + b.words.length + ' 词）</option>';
      }).join('') +
      '</select></div>' +
      '<div class="field"><label>都有谁</label>' +
      '<input id="battlePlayers" value="' + esc(app.battlePlayersText) + '" placeholder="填同学昵称，用逗号分隔" />' +
      '<div class="hint">用逗号隔开，2 到 4 个人。</div></div>' +
      '<div class="field"><label>每人几张牌</label>' +
      '<input id="battleHand" value="' + esc(app.battleHandText) + '" placeholder="10" />' +
      '<div class="hint">从词书里随机发牌，不够就按词数平分。</div></div>' +
      '</div>';
    html += '<button class="btn btn-primary btn-block pk-start" data-act="battle-begin">' +
      icon('zap', 'i18') + '开始比赛</button>';
    html += '<div class="pk-rules">轮到你时，从别人手里抽一张，四选一。答对你 +10 分，答错出牌的人 +5 分。10 回合后分高者赢。</div>';
    html += '</div>';
    return html + tabbar(4, app);
  }

  function battleSession(app) {
    const b = app.battle;
    let html = '<div class="fullscreen">';
    html += '<div class="battle-head"><div class="between"><div>' +
      '<div class="h-title" style="display:flex;align-items:center;gap:6px">' +
      '<span style="color:var(--primary);display:flex">' + icon('zap', 'i18') + '</span>比赛</div>' +
      '<div class="subtle" style="margin-top:3px">' + esc(b.bookName) + ' · 第 ' + b.turn + ' / ' + b.maxTurns + ' 回合</div></div>' +
      '<button class="btn btn-sm btn-ghost" data-act="battle-exit">退出</button></div>' +
      '<div class="players">';
    for (let i = 0; i < b.players.length; i++) {
      html += '<div class="pcard ' + (i === b.current ? 'cur' : '') + '">' +
        '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.players[i]) + '</div>' +
        '<div class="sc">' + b.scores[i] + '</div>' +
        '<div class="rest">剩 ' + (b.hands[i] ? b.hands[i].length : 0) + '</div></div>';
    }
    html += '</div></div>';

    if (b.phase === 1) {
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:var(--primary)">' + icon('rotate', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:14px">轮到 ' + esc(b.players[b.current]) + '</div>' +
        '<div class="subtle" style="margin-top:8px">别偷看别人的牌，准备好了就点开始。</div>' +
        '<button class="btn btn-primary" style="margin-top:20px" data-act="battle-pass">我是 ' +
        esc(b.players[b.current]) + '，开始</button>' +
        '</div></div>';
    } else if (b.phase === 2) {
      const entry = b.words[b.cardIdx];
      html += '<div class="study-area"><div class="battle-card" style="max-width:350px">' +
        '<div class="subtle" style="text-align:center">' + esc(b.players[b.current]) + ' 抽到 ' +
        esc(b.players[b.owner]) + ' 的这张卡</div>' +
        '<div class="wb-word" style="text-align:center;margin-top:8px">' + esc(entry.word) + '</div>' +
        '<div class="wb-phon" style="text-align:center">' + esc(entry.phonetic) + '</div>' +
        '<div style="margin-top:18px">';
      for (let i = 0; i < b.options.length; i++) {
        const cls = b.picked === i ? (i === b.correct ? 'correct' : 'wrong') : '';
        html += '<button class="opt ' + cls + '" data-act="battle-choose" data-i="' + i + '">' +
          '<span class="opt-letter">' + 'ABCD'.charAt(i) + '</span>' +
          '<span>' + esc(b.options[i]) + '</span></button>';
      }
      html += '</div></div></div>';
    } else if (b.phase === 3) {
      const entry = b.words[b.cardIdx];
      const pickedRight = b.picked === b.correct;
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:' + (pickedRight ? 'var(--green)' : 'var(--red)') + '">' +
        icon(pickedRight ? 'checkCircle' : 'closeCircle', 'i44') + '</div>' +
        '<div style="font-weight:700;font-size:18px;margin-top:12px">' + (pickedRight ? '答对了' : '答错了') + '</div>' +
        '<div class="wb-word" style="margin-top:14px">' + esc(entry.word) + '</div>' +
        '<div class="wb-mean">' + esc(entry.meaning) + '</div>' +
        '<div class="subtle" style="margin-top:10px">' + esc(b.lastGain) + '</div>' +
        '<button class="btn btn-primary" style="margin-top:18px" data-act="battle-next">下一回合</button>' +
        '</div></div>';
    } else if (b.phase === 4) {
      const rank = b.scores.map(function (s, i) { return { i: i, s: s }; })
        .sort(function (a, c) { return c.s - a.s; });
      html += '<div class="study-area"><div class="battle-card" style="text-align:center;max-width:350px">' +
        '<div style="display:flex;justify-content:center;color:#C08A18">' + icon('trophy', 'i44') + '</div>' +
        '<div style="font-weight:750;font-size:18px;margin-top:12px">' + esc(b.lastGain) + '</div>' +
        '<div style="margin-top:14px;text-align:left">';
      for (let k = 0; k < rank.length; k++) {
        const g = k === 0 ? 'g1' : k === 1 ? 'g2' : k === 2 ? 'g3' : '';
        html += '<div class="rank-row"><span class="rank ' + g + '">' + (k + 1) + '</span>' +
          '<span style="flex:1">' + esc(b.players[rank[k].i]) + '</span>' +
          '<b style="font-size:14px">' + rank[k].s + ' 分</b></div>';
      }
      html += '</div><button class="btn btn-primary" style="margin-top:18px" data-act="battle-exit">返回</button></div></div>';
    }
    return html + '</div>';
  }

  // ---------------------------------------------------------------- 数据页
  function statsPage(app) {
    const st = app.state;
    const s = new FC.Scheduler(st.settings);
    const now = Date.now();
    let totalCards = 0, totalDue = 0, totalNew = 0;
    for (let i = 0; i < st.decks.length; i++) {
      const c = s.deckCounts(st.decks[i], now);
      totalNew += c[0]; totalDue += c[1]; totalCards += st.decks[i].cards.length;
    }
    const today = FC.dateKey(now);
    let todayReviews = 0;
    for (let i = 0; i < st.stats.length; i++) if (st.stats[i].date === today) todayReviews = st.stats[i].reviews;
    const retention = s.retentionFromLogs(st.decks);

    // 今日平均每题耗时（有复习才显示）
    let timeToday = 0;
    for (let i = 0; i < st.stats.length; i++) if (st.stats[i].date === today) timeToday = st.stats[i].timeMs || 0;
    const avgSec = todayReviews > 0 ? Math.max(1, Math.round(timeToday / todayReviews / 1000)) : 0;

    // 累计复习次数：为 0 时不展示十块全 0 的图表，改成一个明确的空状态
    let totalReviews = 0;
    for (let i = 0; i < st.stats.length; i++) totalReviews += st.stats[i].reviews || 0;

    let html = titlebar('数据', '学习统计') + '<div class="content">';

    // 连续打卡（空状态 / 正常状态都显示，顶部第一块）
    html += streakCardHtml(st, now);

    if (totalReviews === 0) {
      html += '<div class="stat-grid">' +
        statBox(totalCards, '卡片总数', false, 'cards') +
        statBox(todayReviews, '今日复习', true, 'rotate') +
        statBox(totalNew, '待学新卡', false, 'plus') +
        statBox(totalDue, '今日到期', false, 'clock') + '</div>';
      html += '<div class="data-empty">' +
        '<span class="de-ico">' + icon(totalCards > 0 ? 'chart' : 'cards', 'i26') + '</span>' +
        '<b>' + (totalCards > 0 ? '还没有学习记录' : '还没有词库') + '</b>' +
        '<p>' + (totalCards > 0
          ? '学完第一张卡后，这里会显示留存率、间隔分布、学习热力图，以及未来 7 天的到期预测。'
          : '先导入一套词库（.srcd / Anki .apkg / CSV），或新建一个牌组，再回来这里看统计。') + '</p>' +
        '<div class="de-actions">' +
        (totalCards > 0
          ? '<button class="btn btn-primary btn-sm" data-act="study-all">' + icon('play', 'i14') + '开始学习</button>' +
            '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览卡片</button>'
          : '<button class="btn btn-primary btn-sm" data-act="import-hub">' + icon('upload', 'i14') + '导入词库</button>' +
            '<button class="btn btn-sm" data-act="new-deck">' + icon('plus', 'i14') + '新建牌组</button>') +
        '</div></div>';
      return html + '</div>' + tabbar(5, app);
    }

    html += '<div class="stat-grid">' +
      statBox(totalCards, '卡片总数', false, 'cards') +
      statBox(todayReviews, '今日复习', true, 'rotate') +
      statBox(totalNew, '待学新卡', false, 'plus') +
      statBox(totalDue, '今日到期', false, 'clock') +
      statBox((retention * 100).toFixed(0) + '%', '真实留存率', false, 'chart') +
      statBox(avgSec ? avgSec + ' 秒' : '—', '今日每题耗时', false, 'clock') +
      statBox(st.battleRecords.length, 'PK 局数', false, 'trophy') + '</div>';

    // —— 本周概览：复习量环比 + 留存建议 ——
    let weekCur = 0, weekPrev = 0;
    for (let i = 0; i < st.stats.length; i++) {
      const e = st.stats[i];
      const t = Date.parse(e.date + 'T00:00:00');
      if (isNaN(t)) continue;
      const diff = Math.floor((now - t) / FC.DAY_MS);
      if (diff >= 0 && diff < 7) weekCur += e.reviews || 0;
      else if (diff >= 7 && diff < 14) weekPrev += e.reviews || 0;
    }
    const deltaTxt = weekPrev > 0
      ? (weekCur >= weekPrev ? '比上周多 ' + Math.round((weekCur - weekPrev) / weekPrev * 100) + '%'
        : '比上周少 ' + Math.round((weekPrev - weekCur) / weekPrev * 100) + '%')
      : (weekCur > 0 ? '暂无上周数据' : '');
    html += '<div class="insight-bar">' + icon('chart', 'i18') + '<div class="ib-txt">' +
      '<b>' + (weekCur > 0
        ? ('本周已复习 ' + weekCur + ' 次，真实留存 ' + (retention * 100).toFixed(0) + '%')
        : '本周暂无复习记录') + '</b>' +
      '<small>' + (weekCur > 0
        ? (deltaTxt ? deltaTxt + '。' : '') + (retention >= 0.85
          ? '留存率高于目标，可保持当前设置。'
          : (retention >= 0.7
            ? '可将目标留存率调整为 0.9，增加复习频率。'
            : '建议减少每日新卡数量，优先处理到期卡片。'))
        : '在「卡片」页完成一次学习后，这里会显示统计。') + '</small></div></div>';

    if (FCUI.aiDiagnosis) html += FCUI.aiDiagnosis(app);
    if (FCUI.analyticsBlocks) html += FCUI.analyticsBlocks(app);

    // —— 需要重点关注：本机算力按复习优先级综合算出（可提取度 / 逾期 / 遗忘 / 难度）——
    const ra = (FC.AI && FC.AI.REVIEW_ANALYSIS) ? FC.AI.REVIEW_ANALYSIS(app) : null;
    const weak = ra ? ra.items.filter(function (x) { return x.lapses > 0 || x.R < 0.85 || x.leeched; }).slice(0, 6) : [];
    if (weak.length) {
      const maxU = Math.max(1, weak[0].urgency);
      html += '<div class="section-title">需要重点关注 · 本机按复习优先级排序</div><div class="card wide weak-list">';
      html += '<div class="insight-bar" style="margin-bottom:10px">' + icon('target', 'i16') + '<div class="ib-txt">' +
        '<b>到期 ' + ra.dueCnt + ' 张 · 可提取度偏低 ' + ra.lowRCnt + ' 张</b>' +
        '<small>按本机 FSRS 估算，集中复习约 ' + ra.minutes + ' 分钟（每张约 ' + ra.avgSec + ' 秒）可过一遍。</small></div></div>';
      for (let i = 0; i < weak.length; i++) {
        const w = weak[i];
        let txt = String(w.card.front || '').replace(/<[^>]*>/g, ' ')
          .replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
        if (txt.length > 24) txt = txt.slice(0, 24) + '…';
        const why = '可提取度 ' + w.retention + '%' + (w.overdueDays > 0 ? ' · 逾期 ' + w.overdueDays + ' 天' : '') + ' · 忘 ' + w.lapses + ' 次';
        html += '<div class="weak-row">' +
          '<span class="weak-word">' + esc(txt || '(无标题)') +
          (w.leeched ? '<span class="weak-tag">Leech</span>' : '') + '</span>' +
          '<span class="weak-deck">' + esc(why) + '</span>' +
          '<span class="weak-bar"><span style="width:' + Math.round(w.urgency / maxU * 100) + '%"></span></span>' +
          '<b class="weak-n">' + w.retention + '%</b></div>';
      }
      html += '<div class="subtle" style="margin-top:10px">可提取度越低、逾期越久、遗忘越多，越该优先复习。想集中攻克，可用「自定义学习」按 Leeched / 已标记筛出这些卡。</div></div>';
    }

    html += '<div class="section-title">未来 7 天到期分布</div><div class="card wide"><div class="chart">';
    const f = s.forecast(st.decks, now, 7);
    const max = Math.max(1, Math.max.apply(null, f));
    for (let i = 0; i < 7; i++) {
      const d = new Date(now + i * FC.DAY_MS);
      const label = i === 0 ? '今天' : (i === 1 ? '明天' : (d.getMonth() + 1) + '/' + d.getDate());
      const h = Math.max(2, Math.round(f[i] / max * 100));
      html += '<div class="chart-col">' +
        '<span class="bar-v">' + f[i] + '</span>' +
        '<span class="bar-track"><span class="bar' + (f[i] === 0 ? ' zero' : '') +
        '" style="height:' + h + '%"></span></span>' +
        '<span class="bar-l">' + label + '</span></div>';
    }
    html += '</div></div>';

    html += '<div class="section-title">词书进度</div><div class="card">';
    const books = allBooks(app);
    let any = false;
    for (let i = 0; i < books.length; i++) {
      const p = app.wordProgressOf(books[i].id, books[i].words.length);
      if (p[0] > 0 || p[1] > 0) {
        any = true;
        html += '<div style="padding:7px 0">' +
          '<div style="font-size:13.5px">' + esc(books[i].name) + '</div>' +
          '<div class="subtle" style="margin-top:2px">掌握 ' + p[0] + ' · 模糊 ' + p[1] + ' · 未学 ' + p[2] + '</div></div>';
      }
    }
    if (!any) html += '<div class="subtle">还没有词书学习记录，去「词书」页开始吧。</div>';
    html += '</div>';

    html += '<div class="section-title">比赛战绩</div><div class="card">';
    if (st.battleRecords.length === 0) {
      html += '<div class="subtle">还没有战绩，去「比赛」玩一局。</div>';
    } else {
      const start = Math.max(0, st.battleRecords.length - 8);
      for (let i = st.battleRecords.length - 1; i >= start; i--) {
        const r = st.battleRecords[i];
        html += '<div class="between" style="padding:7px 0;font-size:13px;flex-wrap:wrap">' +
          '<span class="subtle">' + esc(r.playedAt.substring(0, 10)) + ' · ' + esc(r.bookName) + '</span>' +
          '<span style="display:flex;align-items:center;gap:4px;color:#B07A12">' +
          icon('trophy', 'i14') + esc(r.winner) + '</span></div>';
      }
    }
    html += '</div></div>';
    return html + tabbar(5, app);
  }

  // —— 连续打卡卡：天数 + 本周打卡 + 最近 7 天复习折线 ——
  function streakCardHtml(st, now) {
    const ck = FC.checkinStreak ? FC.checkinStreak(st, now) : { days: 0, doneToday: false, longest: 0, week: [] };
    const goal = FC.DAY_GOAL || { minutes: 10, words: 100 };
    const map = {};
    const stats = Array.isArray(st.stats) ? st.stats : [];
    for (let i = 0; i < stats.length; i++) if (stats[i] && stats[i].date) map[stats[i].date] = stats[i];
    const todayC = FC.dayCheckin ? FC.dayCheckin(map[FC.dateKey(now)])
      : { ok: false, makeup: false, minutes: 0, words: 0, timePct: 0, wordPct: 0 };

    const week = Array.isArray(ck.week) ? ck.week : [];
    let weekOn = 0;
    let dots = '';
    for (let i = 0; i < week.length; i++) {
      const d = week[i];
      if (d.ok) weekOn++;
      dots += '<span class="sk-dot' + (d.ok ? ' on' : '') + (d.isToday ? ' today' : '') +
        '" title="' + esc(weekBarTitles(d, goal)) + '"><i></i><small>' + WEEK_CN[i] + '</small></span>';
    }

    const meter = function (ico, label, val, need, pct) {
      return '<div class="sk-goal-row">' +
        '<span class="sk-goal-ico">' + icon(ico, 'i14') + '</span>' +
        '<span class="sk-goal-lab">' + esc(label) + '</span>' +
        '<span class="sk-goal-val">' + val + ' / ' + need + '</span>' +
        '<span class="sk-meter"><i style="width:' + Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%"></i></span>' +
        '</div>';
    };

    const owned = Array.isArray(st.badges) ? st.badges : [];
    const list = FC.CHECKIN_BADGES || [];
    let medals = '';
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const on = owned.indexOf('d' + b.days) >= 0;
      medals += '<span class="sk-medal' + (on ? ' on' : '') +
        '" title="连续 ' + b.days + ' 天 · ' + esc(b.name) + '勋章 · 奖励补签卡 ×' + b.cards + '">' +
        '<b>' + b.days + '</b><small>天</small></span>';
    }

    const cards = Math.max(0, Number(st.makeupCards) || 0);
    const makeup = cards > 0
      ? '<span class="sk-makeup"><span>补签卡 ×' + cards + '</span>' +
        '<button class="sk-makeup-btn" data-act="checkin-makeup">补签漏掉的一天</button></span>'
      : '';

    let tip;
    if (todayC.ok) tip = todayC.makeup ? '今天已补签，连击保住了' : '今天已达标，保持住';
    else if (ck.days > 0) {
      const leftMin = Math.max(0, Math.ceil(goal.minutes - todayC.minutes));
      const leftWord = Math.max(0, goal.words - todayC.words);
      tip = '今天还差 ' + leftMin + ' 分钟 / ' + leftWord + ' 词';
    } else tip = '每天满 10 分钟 + 100 词算一次打卡';

    return '<div class="streak-card' + (todayC.ok ? ' done' : '') + '">' +
      '<div class="sk-main">' +
      '<span class="sk-badge">' + icon('flame', 'i22') + '</span>' +
      '<div class="sk-body">' +
      '<div class="sk-num"><b>' + ck.days + '</b><span>天</span></div>' +
      '<div class="sk-txt"><b>' + (ck.days > 0 ? '连续打卡' : '开始打卡') + '</b>' +
      '<small>' + esc(tip) + '</small>' +
      '<small>本周 ' + weekOn + '/7 · 最长 ' + ck.longest + ' 天</small></div>' +
      '</div></div>' +
      '<div class="sk-side">' +
      '<div class="sk-goals">' +
      meter('clock', '今日学习', Math.round(todayC.minutes), goal.minutes + ' 分', todayC.timePct) +
      meter('book', '今日单词', todayC.words, goal.words + ' 词', todayC.wordPct) +
      '</div>' +
      '<div class="sk-dots">' + dots + '</div>' +
      '<div class="sk-foot"><div class="sk-medals">' + medals + '</div>' + makeup + '</div>' +
      '</div></div>';
  }

  function statBox(v, k, accent, ico) {
    return '<div class="stat-box">' +
      (ico ? '<span class="stat-ico ico-' + esc(ico) + '">' + icon(ico, 'i16') + '</span>' : '') +
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v' + (accent ? ' accent' : '') + '">' + esc(v) + '</div></div>';
  }

  // ------------------------------------------------------- 账户公开 ID
  // 规则：注册序号代号 + 注册年份 + 手机尾号 4 位，例如 A20265186
  // 序号 1–999 → A；1 000–9 999 → B；1 万–9.9 万 → C；依次到 1 亿–9.9 亿 → G
  const REG_LETTERS = 'ABCDEFG';
  function regCodeLetter(no) {
    const n = Math.max(1, Math.floor(Number(no) || 1));
    const idx = Math.min(REG_LETTERS.length - 1, Math.max(0, String(n).length - 3));
    return REG_LETTERS.charAt(idx);
  }
  function accountPhoneTail(app) {
    const a = (app && app.account) || {};
    let t = String(a.phoneTail || '').replace(/\D/g, '');
    if (t.length < 4) {
      const raw = String(a.phone || a.cloudPhone || '').replace(/\D/g, '');
      if (raw.length >= 4) t = raw;
    }
    return t.slice(-4);
  }
  // 账户 ID 后缀：__ 后面跟 3 个数字 + 3 个字母，字母大小写随机、6 位顺序随机
  const ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function genIdSuffix() {
    const pool = [];
    for (let i = 0; i < 3; i++) pool.push(ID_LETTERS.charAt(Math.floor(Math.random() * ID_LETTERS.length)));
    for (let i = 0; i < 3; i++) pool.push(String(Math.floor(Math.random() * 10)));
    for (let i = pool.length - 1; i > 0; i--) {   // 打乱位置：数字和字母交错
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.join('');
  }
  function idSuffixValid(v) {
    const str = String(v || '');
    if (!/^[A-Za-z0-9]{6}$/.test(str)) return false;
    let d = 0, l = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (c >= '0' && c <= '9') d++; else l++;
    }
    return d === 3 && l === 3;
  }
  // 后缀一旦生成就固定下来，之后每次渲染都读同一个值
  function ensureIdSuffix(app) {
    const a = (app && app.account) || {};
    const cur = String(a.idSuffix || '').replace(/[^A-Za-z0-9]/g, '');
    if (idSuffixValid(cur)) return cur;
    const suf = genIdSuffix();
    if (app && app.account) {
      app.account.idSuffix = suf;
      try { if (typeof app.saveAccount === 'function') app.saveAccount(); } catch (e) { /* 忽略 */ }
    }
    return suf;
  }
  function accountIdentity(app) {
    const a = (app && app.account) || {};
    const cloudNo = Number(a.regNo) || 0;
    const no = cloudNo || 1; // 本机账户先按第 1 位展示，登录后以云端注册号为准
    const year = String(a.regYear || '').replace(/\D/g, '').slice(0, 4) ||
      String(a.joinedAt || '').slice(0, 4) || String(new Date().getFullYear());
    const tail = accountPhoneTail(app);
    const letter = regCodeLetter(no);
    const base = letter + year + (tail || '');
    const suffix = ensureIdSuffix(app);
    return {
      no: no, letter: letter, year: year, tail: tail,
      base: base, suffix: suffix,
      code: base + '__' + suffix,
      ready: tail.length === 4, cloud: cloudNo > 0
    };
  }

  // 等级：暂按累计学习天数展示，正式规则（学习天数 + 学习数据）后续上线
  function levelInfo(app) {
    const st = (app && app.state) || {};
    const list = Array.isArray(st.stats) ? st.stats : [];
    const seen = {};
    let days = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !e.date) continue;
      if ((Number(e.reviews) || 0) <= 0) continue;
      if (seen[e.date]) continue;
      seen[e.date] = 1;
      days++;
    }
    const PER = 7;
    const cur = days % PER;
    return {
      days: days,
      level: Math.floor(days / PER) + 1,
      per: PER,
      left: PER - cur,
      pct: Math.round(cur / PER * 100)
    };
  }

  // 成就：等级 / 勋章 / 任务 / 积分 / 碎片（全部由本机学习记录派生，不联网）
  function achievementInfo(app, lv, streak) {
    const st = (app && app.state) || {};
    const stats = Array.isArray(st.stats) ? st.stats : [];
    const decks = Array.isArray(st.decks) ? st.decks : [];
    let reviews = 0, days = 0;
    const seen = {};
    for (let i = 0; i < stats.length; i++) {
      const e = stats[i];
      if (!e || !e.date) continue;
      const r = Number(e.reviews) || 0;
      reviews += r;
      if (r > 0 && !seen[e.date]) { seen[e.date] = 1; days++; }
    }
    const d = new Date();
    const keyOf = function (t) {
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    };
    const today = keyOf(d);
    let todayReviews = 0;
    for (let i = 0; i < stats.length; i++) {
      const e = stats[i];
      if (e && e.date === today) todayReviews += Number(e.reviews) || 0;
    }
    const weekKeys = {};
    for (let k = 0; k < 7; k++) { weekKeys[keyOf(new Date(d.getTime() - k * 86400000))] = 1; }
    let weekDays = 0;
    const wk = {};
    for (let i = 0; i < stats.length; i++) {
      const e = stats[i];
      if (e && e.date && weekKeys[e.date] && (Number(e.reviews) || 0) > 0 && !wk[e.date]) { wk[e.date] = 1; weekDays++; }
    }
    const backed = !!(app && app.lastBackupAt && app.lastBackupAt());
    const streakDays = (streak && streak.days) || 0;
    const medals = [
      { ico: 'layers', name: '初次上手', desc: '导入第一个词库', got: decks.length > 0 },
      { ico: 'zap', name: '连学三天', desc: '连续 3 天打卡', got: streakDays >= 3 },
      { ico: 'flame', name: '七日不断', desc: '连续 7 天打卡', got: streakDays >= 7 },
      { ico: 'flame', name: '月满', desc: '连续 30 天打卡', got: streakDays >= 30 },
      { ico: 'rotate', name: '百次复习', desc: '累计复习 100 张', got: reviews >= 100 },
      { ico: 'rotate', name: '千锤百炼', desc: '累计复习 500 张', got: reviews >= 500 },
      { ico: 'calendar', name: '十日在册', desc: '累计学习 10 天', got: days >= 10 },
      { ico: 'calendar', name: '半百', desc: '累计学习 50 天', got: days >= 50 },
      { ico: 'shield', name: '有备无患', desc: '至少备份过一次', got: backed }
    ];
    let gotCount = 0;
    for (let i = 0; i < medals.length; i++) { if (medals[i].got) gotCount++; }
    const points = reviews * 1 + days * 10 + gotCount * 20;
    const shards = Math.min(9, Math.floor(reviews / 120));
    const tasks = [
      { name: '今日复习 20 张', now: Math.min(todayReviews, 20), max: 20, unit: '张' },
      { name: '本周学习 5 天', now: Math.min(weekDays, 5), max: 5, unit: '天' },
      { name: '今天打卡', now: (streak && streak.doneToday) ? 1 : 0, max: 1, unit: '次' }
    ];
    return { reviews: reviews, days: days, gotCount: gotCount, points: points, shards: shards, medals: medals, tasks: tasks };
  }

  function achievementPane(app, lv, streak) {
    const ach = achievementInfo(app, lv, streak);
    let medalHtml = '';
    for (let i = 0; i < ach.medals.length; i++) {
      const m = ach.medals[i];
      medalHtml += '<div class="ach-medal' + (m.got ? ' got' : '') + '">' +
        '<span class="am-ico">' + icon(m.ico, 'i18') + '</span>' +
        '<b>' + esc(m.name) + '</b><small>' + esc(m.desc) + '</small></div>';
    }
    let taskHtml = '';
    for (let i = 0; i < ach.tasks.length; i++) {
      const t = ach.tasks[i];
      const done = t.now >= t.max;
      taskHtml += '<div class="ach-task' + (done ? ' done' : '') + '">' +
        '<span class="at-check">' + (done ? icon('check', 'i12') : '') + '</span>' +
        '<span class="at-main"><b>' + esc(t.name) + '</b></span>' +
        '<span class="at-num">' + t.now + '/' + t.max + ' ' + t.unit + '</span></div>';
    }
    let shardHtml = '';
    for (let i = 0; i < 9; i++) {
      shardHtml += '<span class="ach-shard' + (i < ach.shards ? ' got' : '') + '">' + icon('sparkles', 'i14') + '</span>';
    }
    return '<div class="set-card">' +
      '<div class="set-block"><div class="set-block-h">等级</div>' +
      '<div class="ach-hero">' +
      '<div class="ach-lv"><b>Lv.' + lv.level + '</b><small>' + (lv.days > 0 ? '已学习 ' + lv.days + ' 天' : '还没开始') + '</small></div>' +
      '<div class="ach-hero-main"><div class="ach-hero-bar"><i style="width:' + lv.pct + '%"></i></div>' +
      '<div class="ach-hero-sub">' + (lv.days > 0 ? '再学习 ' + lv.left + ' 天升到 Lv.' + (lv.level + 1) : '完成第一次学习即可开启进度') + '</div></div>' +
      '</div></div>' +
      '<div class="set-block"><div class="set-block-h">勋章 ' + ach.gotCount + ' / ' + ach.medals.length + '</div>' +
      '<div class="ach-medals">' + medalHtml + '</div></div>' +
      '<div class="set-block"><div class="set-block-h">今日任务</div>' + taskHtml + '</div>' +
      '<div class="set-block"><div class="set-block-h">积分</div>' +
      '<div class="ach-points"><b>' + (window.SCShop ? SCShop.balance(app) : ach.points) + '</b><span>复习 1 次 1 分 · 学习 1 天 10 分 · 每枚勋章 20 分</span></div>' +
      '<div class="set-actions"><button class="btn btn-sm btn-accent" data-act="shop-goto" data-tab="store">' + icon('grid', 'i14') + '去商铺花积分</button>' +
      '<button class="btn btn-sm" data-act="shop-goto" data-tab="ledger">积分明细</button></div></div>' +
      '<div class="set-block"><div class="set-block-h">碎片 ' + ach.shards + ' / 9</div>' +
      '<div class="ach-shards">' + shardHtml + '</div>' +
      '<div class="ach-shard-sub">每复习 120 张攒 1 枚碎片，集齐 9 枚点亮一整套。</div></div>' +
      '</div>';
  }

  // ---------------------------------------------------------------- 设置页
    function settingsPage(app) {
      const s = app.state.settings;
      const a = app.account || {};
      const on = !!a.loggedIn;
      const name = app.accountDisplayName ? app.accountDisplayName() : (a.nickname || '匿名用户');
      const idt = accountIdentity(app);
      const pane = (app.settingsPane && app.settingsPane !== 'root') ? app.settingsPane : 'account';
  
      // 行 / 组 / 块 三个基础构件：一行 = 彩色圆角图标 + 标题 + 右侧控件
      const row = function (ico, tone, label, right, sub) {
        return '<div class="set-row">' +
          '<span class="set-ico t-' + tone + '">' + icon(ico, 'i16') + '</span>' +
          '<span class="set-label">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
          '<span class="set-ctl">' + right + '</span></div>';
      };
      const num = function (id, val, ph, w) {
        return '<input class="set-num" id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph) +
          '" inputmode="decimal"' + (w ? ' style="width:' + w + 'px"' : '') + ' />';
      };
      const sel = function (id, opts) {
        let o = '';
        for (let i = 0; i < opts.length; i++) {
          o += '<option value="' + esc(opts[i].v) + '"' + (opts[i].on ? ' selected' : '') + '>' + esc(opts[i].label) + '</option>';
        }
        return '<select class="set-select" id="' + id + '">' + o + '</select>';
      };
      const grp = function (title, inner) {
        return '<div class="set-grp-title">' + esc(title) + '</div><div class="set-card">' + inner + '</div>';
      };
      const block = function (title, inner, sub) {
        return '<div class="set-block"><div class="set-block-h">' + esc(title) + '</div>' + inner +
          (sub ? '<div class="set-block-sub">' + sub + '</div>' : '') + '</div>';
      };
      const acts = function (inner) { return '<div class="set-actions">' + inner + '</div>'; };
      const saveBar = '<div class="set-save"><span class="set-save-hint">改完点保存，全部立即生效</span>' +
        '<button class="btn btn-primary" data-act="save-settings">' + icon('check', 'i16') + '保存设置</button></div>';
      // 二级页容器：所有页都渲染进 DOM，只显示当前这一页（保证保存时能读到全部输入框）
      const paneBox = function (key, inner) {
        return '<div class="set-pane' + (pane === key ? ' on' : '') + '" data-pane="' + key + '">' + inner + '</div>';
      };
  
      // 一级目录：每个分类点进去才是具体参数
      const themeName = '深色玻璃';
      const presetNow = (function () {
        for (let i = 0; i < THEME_PRESETS.length; i++) { if (THEME_PRESETS[i].id === s.preset) return THEME_PRESETS[i].name; }
        return '自定义';
      })();
      const lvNow = levelInfo(app);
      const CATS = [
        { k: 'account', t: '账户与身份', d: '登录、注册与登录状态', ico: 'user', tone: 'blue', g: '账户', val: (on ? name : '未登录') },
        { k: 'profile', t: '个人信息', d: '头像、昵称、简介、经历与学校', ico: 'image', tone: 'blue', g: '账户', val: (a.nickname ? '已完善' : '未完善') },
        { k: 'binding', t: '账户绑定', d: '邮箱、手机号与验证码登录', ico: 'link', tone: 'cyan', g: '账户', val: (on ? (a.provider === 'phone' ? '手机号' : '邮箱') : '未绑定') },
        { k: 'privacyAcc', t: '隐私设置', d: '黑名单与社区隐私', ico: 'eye', tone: 'indigo', g: '账户', val: ((a.blacklist && a.blacklist.length) ? a.blacklist.length + ' 人' : '') },
        { k: 'security', t: '账户安全', d: '账户 ID、云端备份与登录管理', ico: 'lock', tone: 'amber', g: '账户', val: (on ? '已保护' : '') },
        { k: 'level', t: '我的成就', d: '勋章、等级、任务、积分与碎片', ico: 'trophy', tone: 'amber', g: '账户', val: 'Lv.' + lvNow.level },
        { k: 'plan', t: '学习计划', d: '每日新卡与复习上限', ico: 'target', tone: 'blue', g: '学习', val: s.newCardsPerDay + ' / ' + s.reviewCardsPerDay },
        { k: 'fsrs', t: '记忆算法', d: 'FSRS-5 留存率与间隔', ico: 'zap', tone: 'purple', g: '学习', val: '' },
        { k: 'study', t: '学习行为', d: '顺序、Leech、提示音与字号', ico: 'bell', tone: 'orange', g: '学习', val: '' },
        { k: 'appearance', t: '外观与个性化', d: '动效与字号', ico: 'palette', tone: 'pink', g: '个性化', val: '深色玻璃 · ' + (s.motion === 'off' ? '动效关' : (s.motion === 'full' ? '动效全开' : '动效轻')) },
        { k: 'data', t: '数据与备份', d: '备份提醒与本机数据', ico: 'cloud', tone: 'cyan', g: '系统', val: '' },
        { k: 'privacy', t: '隐私与安全', d: '数据存在哪、怎么清除', ico: 'shield', tone: 'indigo', g: '系统', val: '' },
        { k: 'keys', t: '快捷键', d: '键盘操作一览', ico: 'keyboard', tone: 'slate', g: '系统', val: '' },
        { k: 'about', t: '关于', d: '版本与开发团队', ico: 'info', tone: 'gray', g: '系统', val: '' }
      ];
      let curCat = null;
      for (let ci = 0; ci < CATS.length; ci++) { if (CATS[ci].k === pane) curCat = CATS[ci]; }
  
      // —— 标题栏：单层「设置」，分类切换在左栏完成 ——
      let html = titlebar('设置', '');
      html += '<div class="content set-content"><div class="set-layout">';

      // ================= 左栏：分类导航 =================
      html += '<aside class="set-side">';
      html += '<div class="ss-search">' + icon('search', 'i15') +
        '<input id="setSearch" type="text" placeholder="搜索设置项" autocomplete="off"' +
        ' value="' + esc(app.settingsQuery || '') + '" oninput="window.scFilterSettings && window.scFilterSettings(this.value)" /></div>';
      html += '<div class="ss-acct"><span class="ss-ava">' + avatarFace(a, 'ava-sm') + '</span>' +
        '<div class="ss-main"><b>' + esc(on ? name : '匿名用户') + '</b>' +
        '<small>' + esc(idt.ready ? idt.code : (on ? '' : '点击登录')) + '</small></div></div>';
      const navGroups = ['账户', '学习', '个性化', '系统'];
      for (let gi = 0; gi < navGroups.length; gi++) {
        html += '<div class="ss-group">' + esc(navGroups[gi]) + '</div>';
        for (let ci = 0; ci < CATS.length; ci++) {
          const c = CATS[ci];
          if (c.g !== navGroups[gi]) continue;
          html += '<button class="ss-item' + (pane === c.k ? ' on' : '') + '" data-act="set-pane" data-pane="' + c.k + '" data-kw="' + esc(c.t + ' ' + (c.d || '')) + '">' +
            '<span class="ss-ico">' + icon(c.ico, 'i18') + '</span>' +
            '<span class="ss-label">' + esc(c.t) + '</span>' +
            '</button>';
        }
      }
      html += '<div class="ss-empty" id="ssEmpty" style="display:none">没有匹配的设置项</div>';
      html += '<div class="set-ver">闪星卡 1.6.0 · 数据在本机</div>';
      html += '</aside>';

      // ================= 右栏：当前分类的参数 =================
      html += '<div class="set-main">';
      if (curCat) {
        html += '<div class="set-main-head"><h2>' + esc(curCat.t) + '</h2>' +
          (curCat.d ? '<p>' + esc(curCat.d) + '</p>' : '') + '</div>';
      }
  
      // ================= 二级：各类参数 =================
  
      // 账户与身份（原「个人中心」整页已并入这里）
      const p = a.privacy || { rememberLogin: true, showNickname: true, privacyBlur: false };
      const loginLabel = a.provider === 'huawei' ? '华为账号'
        : a.provider === 'phone' ? '手机号验证码'
          : a.provider === 'email' ? '邮箱验证码' : '本机账户';
      const loginMini = (function () {
        if (on) return '';
        const mode = app.loginMode === 'phone' ? 'phone' : 'email';
        const isPhone = mode === 'phone';
        // 草稿优先取内存；页面刷新 / 重载后从 sessionStorage 兜底，表单内容不会被冲掉
        let draft = app._loginDraft;
        if (!draft || !Object.keys(draft).length) {
          try { draft = JSON.parse(sessionStorage.getItem('sc_login_draft') || 'null'); } catch (e) { draft = null; }
          if (draft) app._loginDraft = draft;
        }
        draft = draft || {};
        const dv = function (k, fb) { return draft[k] !== undefined ? draft[k] : (fb || ''); };
        const msg = app._loginMsg || {};
        const cnt = app._otpCountdown || 0;
        const busy = !!app._otpBusy;
        const canSend = !busy && cnt <= 0;
        return '<div class="set-card set-login"><div class="set-block">' +
          '<div class="lg-top">' +
          '<div class="set-block-h">登录 / 注册</div>' +
          '<div class="login-tabs">' +
          '<button class="login-tab' + (isPhone ? '' : ' on') + '" data-act="login-tab" data-mode="email">' + icon('mail', 'i15') + '邮箱</button>' +
          '<button class="login-tab' + (isPhone ? ' on' : '') + '" data-act="login-tab" data-mode="phone">' + icon('phone', 'i15') + '手机号</button>' +
          '</div>' +
          '</div>' +
          '<div class="set-block-sub">用邮箱或手机收验证码。昵称、头像、牌组与学习记录都只留本机。</div>' +
          '<div class="login-form">' +
          (isPhone
            ? '<div class="field"><label>手机号</label><input id="loginPhone" type="tel" inputmode="numeric" maxlength="11" value="' + esc(dv('phone', a.phone)) + '" placeholder="11 位手机号" autocomplete="tel" /></div>'
            : '<div class="field"><label>邮箱</label><input id="loginEmail" type="email" value="' + esc(dv('email', a.email)) + '" placeholder="name@example.com" autocomplete="email" /></div>') +
          '<div class="field"><label>验证码</label><div class="otp-row">' +
          '<input id="loginCode" type="text" inputmode="numeric" maxlength="6" value="' + esc(dv('code')) + '" placeholder="收到的验证码" autocomplete="one-time-code" />' +
          '<button type="button" class="btn btn-sm" id="btnSendCode" data-act="login-send"' + (canSend ? '' : ' disabled') + '>' +
          (busy ? '发送中…' : (cnt > 0 ? cnt + ' 秒后重发' : '获取验证码')) + '</button></div></div>' +
          (!isPhone && app._otpChallenge && !app._otpChallenge.isExistingUser
            ? '<div class="field"><label>设置密码（新用户）</label><input id="loginPassword" type="password" value="' + esc(dv('password')) + '" placeholder="至少 6 位" autocomplete="new-password" /></div>'
            : '') +
          '<div class="login-msg' + (msg.text ? ' login-msg-' + (msg.kind || 'err') : '') + '" id="loginMsg">' + esc(msg.text || '') + '</div>' +
          '<div class="lg-actbar">' +
          '<label class="agree"><input type="checkbox" id="loginAgree"' + (draft.agree ? ' checked' : '') + ' />' +
          '<span>我已阅读并同意 <button class="link-btn" data-act="privacy-info">隐私说明</button></span></label>' +
          '<button class="btn btn-primary btn-block" data-act="login-submit">' + icon('lock', 'i16') + '登录 / 注册</button>' +
          '</div>' +
          '</div></div></div>';
      })();

      html += paneBox('account',
        loginMini +
        '<div class="set-card">' +
        row('shield', 'blue', '登录状态',
          '<span class="set-val' + (on ? ' ok' : '') + '">' + esc(on ? loginLabel : '未登录') + '</span>',
          on ? ((a.provider === 'phone' ? a.phone : a.email) || (a.joinedAt ? '加入于 ' + a.joinedAt.substring(0, 10) : '')) : '登录后账户 ID 可在多台设备间对应') +
        '</div>' +
        '<div class="set-tip">头像昵称在「<button class="link-btn" data-act="set-pane" data-pane="profile">个人信息</button>」，邮箱手机在「<button class="link-btn" data-act="set-pane" data-pane="binding">账户绑定</button>」，黑名单在「<button class="link-btn" data-act="set-pane" data-pane="privacyAcc">隐私设置</button>」，账户 ID 与云端备份在「<button class="link-btn" data-act="set-pane" data-pane="security">账户安全</button>」。</div>' +
        saveBar
      );
  
      // —— 个人信息 ——
      const pf = a.profile || { bio: '', exp: '', school: '' };
      html += paneBox('profile',
        '<div class="set-card">' +
        row('image', 'blue', '头像',
          '<button class="set-link" data-act="avatar-open">' + (a.avatarData ? '已设置' : '未设置') + icon('chevronRight', 'i12') + '</button>',
          '换一张图片或选个颜色') +
        row('user', 'blue', '昵称',
          '<button class="set-link" data-act="profile-open">' + esc(a.nickname || (on ? name : '未设置')) + icon('chevronRight', 'i12') + '</button>',
          '点击修改') +
        '</div>' +
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">简介</div>' +
        '<textarea class="set-area" id="setBio" maxlength="200" placeholder="一句话介绍自己，会展示在社区（比如：高二 · 背单词狂魔）">' + esc(pf.bio) + '</textarea>' +
        '<div class="set-block-h" style="margin-top:14px">经历</div>' +
        '<textarea class="set-area" id="setExp" maxlength="500" placeholder="学习经历、目标、正在用的教材……（选填）">' + esc(pf.exp) + '</textarea>' +
        '<div class="set-block-h" style="margin-top:14px">学校绑定</div>' +
        '<div class="field"><input id="setSchool" type="text" value="' + esc(pf.school) + '" placeholder="学校名称（选填）" maxlength="60" autocomplete="off" /></div>' +
        '<div class="set-block-sub">学校信息只用于班级 / 同桌匹配展示，不会公开给陌生人。</div>' +
        '<div class="set-actions"><button class="btn btn-primary btn-sm" data-act="profile-save">' + icon('check', 'i14') + '保存资料</button></div>' +
        '</div></div>'
      );

      // —— 账户绑定 ——
      html += paneBox('binding',
        '<div class="set-card">' +
        row('mail', 'cyan', '邮箱',
          '<span class="set-val' + (on && a.provider === 'email' ? ' ok' : '') + '">' + esc(on && a.provider === 'email' ? (a.cloudEmail || a.email || '已绑定') : '未绑定') + '</span>',
          '邮箱验证码登录即视为绑定') +
        row('phone', 'cyan', '手机号',
          '<span class="set-val' + (on && a.provider === 'phone' ? ' ok' : '') + '">' + esc(on && a.provider === 'phone' ? (a.cloudPhone || a.phone || '已绑定') : '未绑定') + '</span>',
          '手机验证码登录即视为绑定') +
        row('user', 'cyan', '手机尾号',
          '<input class="set-num" id="setPhoneTail" value="' + esc(on ? accountPhoneTail(app) : '') + '" placeholder="登录后自动带入" maxlength="4" inputmode="numeric" />',
          '账户 ID 的后四位') +
        '</div>' +
        '<div class="set-tip">换绑 = 用新的邮箱 / 手机号重新走一次验证码登录。<button class="link-btn" data-act="set-pane" data-pane="account">去登录 / 换绑</button></div>'
      );

      // —— 隐私设置（黑名单 + 社区隐私）——
      const bl = a.blacklist || [];
      html += paneBox('privacyAcc',
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">社区隐私</div>' +
        privacyRow('allowInvites', p.allowInvites !== false, '接受同桌邀请', '关闭后，别人在社区里不能邀请你做同桌') +
        privacyRow('showInCommunity', p.showInCommunity !== false, '在社区展示我的昵称与头像', '关闭后发帖对他人显示为「同学」+ 默认头像') +
        privacyRow('allowBuyMyCards', p.allowBuyMyCards !== false, '允许他人换取我分享的卡组', '关闭后你的作品不会被别人用积分换走') +
        '</div></div>' +
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">黑名单' + (bl.length ? '（' + bl.length + ' 人）' : '') + '</div>' +
        (bl.length
          ? bl.map(function (b) {
              return '<div class="bl-row">' +
                '<span class="ava ava-c0">' + esc(String(b.name || '?').slice(0, 1)) + '</span>' +
                '<span class="bl-main"><b>' + esc(b.name || '同学') + '</b><small>' + esc(b.id) + '</small></span>' +
                '<button class="btn btn-sm" data-act="blacklist-remove" data-id="' + esc(b.id) + '">移出</button></div>';
            }).join('')
          : '<div class="set-block-sub">还没有拉黑任何人。社区帖子旁的「拉黑」按钮可以把人加进来：被拉黑的人不能邀请你做同桌、不能换取你分享的卡组，你看社区时也会隐藏他 / 她的帖子。</div>') +
        '</div></div>' +
        '<div class="set-actions"><button class="btn btn-sm" data-act="privacy-info">' + icon('info', 'i14') + '隐私说明</button></div>'
      );

      // —— 账户安全 ——
      html += paneBox('security',
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">账户 ID</div>' +
        '<div class="set-idbox"><input class="set-id-input" id="setIdCode" value="' + esc(idt.code) + '" placeholder="A20265186__9aK2z3" spellcheck="false" autocapitalize="off" autocomplete="off" /></div>' +
        '<div class="set-block-sub">后半段可以自己改，但必须是 <b>3 个数字 + 3 个字母</b>（大小写随意、顺序随意），且不能和别人重复。</div>' +
        '<div class="set-actions"><button class="btn btn-sm" data-act="id-regen">' + icon('sparkles', 'i14') + '随机换一个</button></div>' +
        '</div></div>' +
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">云端备份</div>' +
        '<div class="set-block-sub">' + (on ? '已登录（' + esc(loginLabel) + '）。学习记录与账户资料会随登录同步到云端，换设备不丢。' : '登录后可把学习记录与账户资料备份到云端，换设备不丢。') + '</div>' +
        '<div class="set-actions"><button class="btn btn-sm" data-act="set-pane" data-pane="data">' + icon('cloud', 'i14') + '前往数据与备份</button></div>' +
        '</div></div>' +
        '<div class="set-card"><div class="set-block">' +
        '<div class="set-block-h">登录管理</div>' +
        '<div class="set-actions">' +
        (on ? '<button class="btn btn-sm" data-act="account-logout">' + icon('logout', 'i14') + '退出登录</button>' : '') +
        '<button class="btn btn-sm" data-act="account-clear">' + icon('trash', 'i14') + '清除本机账户数据</button>' +
        '</div></div></div>' +
        saveBar
      );

      // 等级
      const lv = lvNow;
      html += paneBox('level', achievementPane(app, lvNow, streakStat(app)));

      // 学习计划
      html += paneBox('plan',
        '<div class="set-card">' +
        row('target', 'blue', '每日新卡上限', num('setNew', String(s.newCardsPerDay), '20', 78)) +
        row('rotate', 'blue', '每日复习上限', num('setReview', String(s.reviewCardsPerDay), '200', 78)) +
        '<div class="set-tip">所有牌组统一按这里执行。想让一套牌组一次全部出现（例如 50 张牌组学 50 张），把新卡上限设为 <b>999</b> 再保存。</div>' +
        acts('<button class="btn btn-sm btn-accent" data-act="set-unlimited">' + icon('layers', 'i14') + '取消上限（999）</button>' +
          '<button class="btn btn-sm" data-act="set-standard">恢复推荐（20）</button>') +
        '</div>' + saveBar
      );
  
      // 记忆算法
      html += paneBox('fsrs',
        '<div class="set-card">' +
        row('zap', 'purple', '目标留存率', num('setRetention', String(s.requestRetention), '0.9', 78), '0.7 – 0.99') +
        row('clock', 'purple', '最大间隔', num('setMaxInterval', String(s.maximumInterval), '36500', 92), '天') +
        row('layers', 'purple', '学习步骤', num('setLearn', s.learningSteps.join(','), '1,10', 120), '分钟') +
        row('rotate', 'purple', '重学步骤', num('setRelearn', s.relearningSteps.join(','), '10', 120), '分钟') +
        row('trophy', 'purple', '毕业间隔', num('setGrad', String(s.graduatingInterval), '1', 78), '天') +
        row('zap', 'purple', '简单间隔', num('setEasy', String(s.easyInterval), '4', 78), '天') +
        '</div>' + saveBar
      );
  
      // 学习行为
      html += paneBox('study',
        '<div class="set-card">' +
        row('bell', 'orange', 'Leech 阈值', num('setLeech', String(s.leechThreshold), '8', 78), '遗忘次数') +
        row('shield', 'orange', 'Leech 动作', sel('setLeechAction', [
          { v: 'tag', label: '标记并打标签', on: s.leechAction !== 'suspend' },
          { v: 'suspend', label: '自动暂停卡片', on: s.leechAction === 'suspend' }
        ])) +
        row('layers', 'orange', '相关卡片搁置', sel('setBury', [
          { v: '1', label: '开启', on: s.buryRelated !== false },
          { v: '0', label: '关闭', on: s.buryRelated === false }
        ]), '正反向当天只出一张') +
        row('cards', 'orange', '新卡顺序', sel('setNewOrder', [
          { v: 'mix', label: '交错', on: s.newOrder === 'mix' },
          { v: 'order', label: '按创建顺序', on: s.newOrder === 'order' },
          { v: 'random', label: '随机', on: s.newOrder === 'random' }
        ])) +
        row('rotate', 'orange', '复习顺序', sel('setReviewOrder', [
          { v: 'due', label: '按到期时间', on: s.reviewOrder !== 'random' },
          { v: 'random', label: '随机', on: s.reviewOrder === 'random' }
        ])) +
        row('clock', 'orange', '答题计时', sel('setTimer', [
          { v: '1', label: '显示', on: s.showTimer !== false },
          { v: '0', label: '隐藏', on: s.showTimer === false }
        ])) +
        row('speaker', 'orange', '翻面提示音', sel('setSound', [
          { v: '1', label: '开启', on: s.sound !== false },
          { v: '0', label: '关闭', on: s.sound === false }
        ])) +
        row('eye', 'orange', '自动翻面', sel('setAutoReveal', [
          { v: '0', label: '关闭 · 手动', on: !s.autoRevealSeconds },
          { v: '3', label: '3 秒', on: s.autoRevealSeconds === 3 },
          { v: '5', label: '5 秒', on: s.autoRevealSeconds === 5 },
          { v: '10', label: '10 秒', on: s.autoRevealSeconds === 10 }
        ])) +
        '</div>' + saveBar
      );
  
      // 外观与个性化：v2 深色玻璃是全站固定外观，只保留真正生效的选项
      html += paneBox('appearance',
        '<div class="set-card">' +
        '<div class="set-block"><div class="set-block-h">界面外观</div>' +
        '<div class="set-tip">当前为 v2 深色玻璃主题（华为质感），全站统一，不随明暗模式切换。</div>' +
        block('界面动效', fxBtns(s.motion), '轻 = 只保留必要过渡；关闭 = 全部静止，老设备更省电。') +
        block('学习卡字号', '<select class="set-select" id="setFont">' +
          '<option value="s"' + (s.studyFont === 's' ? ' selected' : '') + '>小</option>' +
          '<option value="m"' + (s.studyFont !== 's' && s.studyFont !== 'l' ? ' selected' : '') + '>标准</option>' +
          '<option value="l"' + (s.studyFont === 'l' ? ' selected' : '') + '>大</option>' +
          '</select>', '复习时正面单词与背面释义的字号。') +
        '</div>'
      );
  
      // 数据与备份
      html += paneBox('data',
        '<div class="set-card">' +
        row('bell', 'cyan', '备份提醒', sel('setBackupRemind', (function () {
          const remind = s.backupRemindDays === undefined ? 14 : s.backupRemindDays;
          return [
            { v: '0', label: '关闭', on: remind === 0 },
            { v: '7', label: '每 7 天', on: remind === 7 },
            { v: '14', label: '每 14 天', on: remind === 14 },
            { v: '30', label: '每 30 天', on: remind === 30 }
          ];
        })())) +
        (function () {
          const last = app.lastBackupAt ? app.lastBackupAt() : 0;
          const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
          const txt = last ? (days <= 0 ? '今天刚备份过' : '上次备份在 ' + days + ' 天前') : '还没有备份过';
          const remind = s.backupRemindDays === undefined ? 14 : s.backupRemindDays;
          const warn = remind > 0 && (!last || days >= remind);
          return '<div class="set-tip' + (warn ? ' warn' : '') + '">' + esc(txt) +
            '。本地数据只存在这台设备，建议定期导出 .srcd 存到别处，换设备或清缓存都不会丢。</div>';
        })() +
        acts('<button class="btn btn-sm btn-danger" data-act="reset-confirm">' + icon('trash', 'i14') + '清空数据</button>') +
        '</div>' + saveBar
      );
  
      // 隐私与安全
      html += paneBox('privacy',
        '<div class="set-card">' +
        row('shield', 'indigo', '学习数据存储', '<span class="set-val">本机浏览器</span>') +
        row('cloud', 'indigo', '云端用途', '<span class="set-val">验证码登录 · 在线 AI</span>') +
        row('download', 'indigo', '导出 .srcd', '<span class="set-val">不含账户资料</span>') +
        '<div class="set-tip">账户、头像和隐私偏好只在这台设备上。清除后找不回来，但不会动你的牌组和学习记录。</div>' +
        acts('<button class="btn btn-sm" data-act="account-clear">' + icon('trash', 'i14') + '清除账户数据</button>') +
        '</div>'
      );
  
      // 快捷键
      html += paneBox('keys',
        '<div class="set-card">' +
        row('key', 'slate', 'Ctrl + K', '<span class="set-val">命令面板</span>') +
        row('key', 'slate', '空格', '<span class="set-val">翻面 / 良好</span>') +
        row('key', 'slate', '1 / 2 / 3 / 4', '<span class="set-val">重来 / 困难 / 良好 / 简单</span>') +
        row('key', 'slate', 'E / S / F / I / R', '<span class="set-val">编辑 / 暂停 / 标记 / 信息 / 重置</span>') +
        row('key', 'slate', 'Ctrl + Z / B / Esc', '<span class="set-val">撤销 / 浏览器 / 退出</span>') +
        acts('<button class="btn btn-sm" data-act="shortcuts-help">' + icon('keyboard', 'i14') + '查看完整快捷键</button>') +
        '</div>'
      );
  
      // 关于
      html += paneBox('about',
        '<div class="set-card"><div class="set-block set-about">' +
        '<div class="set-about-t">闪星卡 · StarCard</div>' +
        '<div class="set-about-s">网页版 1.6.0 · 开发人 小李同学 · 小李工作室</div>' +
        '<div class="set-about-d">一款比 Anki 更全面、更智能的间隔重复卡片学习软件。基于 FSRS-5 科学记忆算法，数据与 .srcd 都在本机处理。</div>' +
        '</div></div>'
      );
  
      html += '</div></div></div>';
      return html + tabbar(6, app);
    }

  function settingInput(label, id, value, ph) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<input id="' + id + '" value="' + esc(value) + '" placeholder="' + esc(ph) + '" /></div>';
  }

  // 主题预设：一套「配色 + 背景」的组合，一键应用；明暗模式（跟随系统/浅色/深色）独立切换，应用到所有主题
  const THEME_PRESETS = [
    { id: 'default', name: '素白', desc: '黑白 · 无装饰', accent: 'brand', bg: 'default' },
    { id: 'paper', name: '暖纸', desc: '纸感 · 琥珀', accent: 'amber', bg: 'paper' },
    { id: 'forest', name: '林间', desc: '柔雾 · 青绿', accent: 'green', bg: 'mist' },
    { id: 'ocean', name: '海雾', desc: '点阵 · 湖蓝', accent: 'teal', bg: 'dots' },
    { id: 'rose', name: '暮粉', desc: '晕染 · 玫瑰', accent: 'rose', bg: 'aurora' },
    { id: 'night', name: '夜航', desc: '网格 · 星蓝', accent: 'brand', bg: 'grid' }
  ];

  function presetGrid(current) {
    let out = '<div class="preset-grid">';
    for (let i = 0; i < THEME_PRESETS.length; i++) {
      const p = THEME_PRESETS[i];
      const on = p.id === current;
      out += '<button class="preset-card pc-' + esc(p.id) + (on ? ' on' : '') + '" data-act="theme-preset" data-id="' + esc(p.id) + '">' +
        '<span class="pc-prev"><i class="pc-surface"></i><i class="pc-accent"></i></span>' +
        '<span class="pc-name">' + esc(p.name) + '</span>' +
        '<span class="pc-desc">' + esc(p.desc) + '</span>' +
        '</button>';
    }
    let custom = true;
    for (let i = 0; i < THEME_PRESETS.length; i++) if (THEME_PRESETS[i].id === current) custom = false;
    return out + '</div>' + (custom ? '<div class="preset-note">当前是自定义配色：调过强调色，可点上面任意一套恢复</div>' : '');
  }

  // 个性化选项：单选色块 / 背景样片。name 用于分组，checked 表示当前选中。
  function swatch(value, label, current, group) {
    const on = String(current) === String(value);
    return '<label class="swatch sw-' + esc(value) + (on ? ' on' : '') + '" title="' + esc(label) + '">' +
      '<input type="radio" name="' + esc(group) + 'R" value="' + esc(value) + '"' + (on ? ' checked' : '') + ' />' +
      '<span class="sw-dot"></span><span class="sw-name">' + esc(label) + '</span></label>';
  }

  // 动效档位三选一：轻（默认）/ 完整 / 关闭
  function fxBtns(current) {
    const modes = [
      { v: 'calm', label: '轻', ico: 'sliders' },
      { v: 'full', label: '完整', ico: 'sparkles' },
      { v: 'off', label: '关闭', ico: 'moon' }
    ];
    let out = '<div class="theme-mode fx-mode">';
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      const on = String(current || 'calm') === m.v;
      out += '<button class="mode-btn' + (on ? ' on' : '') + '" data-act="set-fx" data-fx="' + m.v + '">' +
        icon(m.ico, 'i16') + '<span>' + m.label + '</span></button>';
    }
    return out + '</div>';
  }

  // 外观模式三选一：跟随系统 / 浅色 / 深色（即时生效，独立于主题预设，应用到所有主题）
  function themeModeBtns(current) {
    const modes = [
      { v: 'auto', label: '跟随系统', ico: 'monitor' },
      { v: 'light', label: '浅色', ico: 'sun' },
      { v: 'dark', label: '深色', ico: 'moon' }
    ];
    let out = '<div class="theme-mode">';
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      const on = String(current) === m.v;
      out += '<button class="mode-btn' + (on ? ' on' : '') + '" data-act="theme-mode" data-mode="' + m.v + '">' +
        icon(m.ico, 'i16') + '<span>' + m.label + '</span></button>';
    }
    return out + '</div>';
  }

  // ---------------------------------------------------------------- 个人中心
  // ---------------------------------------------------------------- 通知页（完整页面，非弹窗）
  function noticePage(app) {
    const items = noticeItems(app);
    let html = titlebar('通知', '学习提醒 · 备份提示', { back: { act: 'notice-back' } }) + '<div class="content">';
    if (!items.length) {
      html += '<div class="card wide"><div class="notice-empty">' + icon('bell', 'i26') +
        '<div>暂时没有要提醒的事。</div><div class="subtle">今天没有待学卡片，也备份过了。</div></div></div>';
    } else {
      html += '<div class="card wide"><div class="notice-list">';
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        html += '<div class="notice-item tone-' + esc(it.tone) + '">' +
          '<span class="notice-ico">' + icon(it.icon, 'i18') + '</span>' +
          '<div class="notice-txt"><b>' + esc(it.title) + '</b><small>' + esc(it.desc) + '</small></div>' +
          (it.cta ? '<button class="btn btn-sm' + (i === 0 ? ' btn-primary' : '') + '" data-act="notice-go"' +
            (it.page ? ' data-page="' + it.page + '"' : ' data-tab="' + (it.tab || 1) + '"') + '>' + esc(it.cta) + '</button>' : '') +
          '</div>';
      }
      html += '</div></div>';
    }
    html += '<div class="card wide">' +
      '<div class="row-gap">' +
      '<button class="btn" data-act="notice-read">' + icon('checkCircle', 'i16') + '全部标为已读</button>' +
      '<button class="btn" data-act="backup-open">' + icon('shield', 'i16') + '备份中心</button>' +
      '</div>' +
      '<div class="subtle" style="margin-top:12px">通知每天汇总一次：今日待学、连续打卡、备份提醒。全部在本机生成，不上传任何服务器。</div>' +
      '</div></div>';
    return html + tabbar(app.tab, app);
  }

  // ---------------------------------------------------------------- 备份中心页（完整页面，非弹窗）
  function backupPage(app) {
    const st = app.state;
    const last = app.lastBackupAt ? app.lastBackupAt() : 0;
    const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
    const remind = st.settings.backupRemindDays === undefined ? 14 : st.settings.backupRemindDays;
    const deckCount = st.decks.length;
    let cardCount = 0;
    for (let i = 0; i < st.decks.length; i++) cardCount += st.decks[i].cards.length;
    let html = titlebar('备份中心', '导出 · 导入 · 提醒', { back: { act: 'backup-back' } }) + '<div class="content">';

    // 数据概览
    html += '<div class="stat-grid">' +
      statBox(deckCount, '牌组数', false, 'folder') +
      statBox(cardCount, '卡片数', false, 'cards') +
      statBox(!last ? '未备份' : (days === 0 ? '今天' : days + ' 天前'), '上次备份', !last, 'shield') +
      '</div>';

    // 导出
    html += '<div class="section-title">导出备份</div>' +
      '<div class="card wide">' +
      '<div class="kv"><span class="kv-k">导出内容</span><span class="kv-v">全部牌组 · 学习进度 · 复习统计</span></div>' +
      '<div class="kv"><span class="kv-k">文件格式</span><span class="kv-v">.srcd（单文件，跨设备可导入）</span></div>' +
      '<div class="kv"><span class="kv-k">不包含</span><span class="kv-v">昵称头像 · 隐私偏好 · 班级/比赛数据</span></div>' +
      '<button class="btn btn-primary btn-block" style="margin-top:14px" data-act="backup-export">' +
      icon('shield', 'i16') + '导出 .srcd 备份</button>' +
      '<div class="subtle" style="margin-top:10px">导出后把文件存到网盘 / U 盘 / 另一台设备。建议每 14 天备份一次。</div></div>';

    // 导入恢复
    html += '<div class="section-title">导入恢复</div>' +
      '<div class="card wide">' +
      '<div class="row-gap">' +
      '<button class="btn btn-primary" data-act="import-hub">' + icon('download', 'i16') + '导入</button>' +
      '<button class="btn btn-sm" data-act="import-formats" title="查看支持的格式">' + icon('info', 'i14') + '支持格式</button>' +
      '</div>' +
      '<div class="subtle" style="margin-top:10px">支持 .srcd / .apkg / CSV。同名牌组就地更新，学习进度按卡片正面自动迁移，不会重复堆叠。</div></div>';

    // 提醒频率
    html += '<div class="section-title">备份提醒</div>' +
      '<div class="card wide">' +
      '<div class="field"><label>提醒频率</label><select id="setBackupRemind">' +
      '<option value="0"' + (remind === 0 ? ' selected' : '') + '>关闭提醒</option>' +
      '<option value="7"' + (remind === 7 ? ' selected' : '') + '>每 7 天</option>' +
      '<option value="14"' + (remind === 14 ? ' selected' : '') + '>每 14 天</option>' +
      '<option value="30"' + (remind === 30 ? ' selected' : '') + '>每 30 天</option>' +
      '</select></div>' +
      '<button class="btn btn-sm" data-act="save-settings">保存频率</button>' +
      '<div class="subtle" style="margin-top:10px">到点后通知页会出现备份提醒。与「设置」页的备份提醒共用同一个设置。</div></div>';

    return html + '</div>' + tabbar(app.tab, app);
  }

  function accountPage(app) {
    const a = app.account || {};
    const on = !!a.loggedIn;
    const name = app.accountDisplayName ? app.accountDisplayName() : (a.nickname || '匿名用户');
    const idt = accountIdentity(app);
    const p = a.privacy || { rememberLogin: true, showNickname: true, privacyBlur: false };
    const draft = app._loginDraft || {};
    let html = titlebar('个人中心', '资料 · 登录 · 隐私', { back: { act: 'account-back' } }) + '<div class="content">';

    // 头像 + 身份概览
    html += '<div class="card wide acct-hero">' +
      '<button class="acct-ava-btn" data-act="avatar-open" title="更换头像">' + avatarFace(a, 'ava-xl') + '</button>';
    if (on) {
      const cloudId = a.provider === 'phone' ? (a.cloudPhone || a.phone) : (a.cloudEmail || a.email);
      html += '<div class="acct-name">' + esc(name) + '</div>' +
        '<div class="acct-idline">' + esc(idt.code || '待填手机尾号') + '</div>' +
        '<div class="acct-sub">' + (cloudId ? esc(cloudId) + ' · ' : '') +
        (a.joinedAt ? '加入于 ' + esc(a.joinedAt.substring(0, 10)) : '') + '</div>' +
        '<div class="acct-badge">' + icon('checkCircle', 'i14') +
        (a.provider ? (a.provider === 'huawei' ? '华为账号' : a.provider === 'phone' ? '手机号验证码登录' : '邮箱验证码登录') : '本机账户已登录') + '</div>' +
        '<div class="acct-actions">' +
        '<button class="btn btn-sm btn-primary" data-act="profile-open">' + icon('pencil', 'i14') + '编辑资料</button>' +
        '<button class="btn btn-sm" data-act="avatar-open">' + icon('camera', 'i14') + '更换头像</button>' +
        '<button class="btn btn-sm" data-act="account-logout">' + icon('logout', 'i14') + '退出登录</button>' +
        '</div>';
    } else {
      html += '<div class="acct-name">还没登录</div>' +
        '<div class="acct-idline is-empty">' + esc(idt.code || '待填手机尾号') + '</div>' +
        '<div class="acct-sub">用邮箱或手机号收验证码登录。头像现在就能换，学习数据只留本机。</div>';
    }
    html += '</div>';

    // 未登录：邮箱 / 手机号验证码登录
    if (!on) {
      const mode = app.loginMode === 'phone' ? 'phone' : 'email';
      const isPhone = mode === 'phone';
      const online = (window.FC && FC.cloudAvailable) ? FC.cloudAvailable() : false;
      const dv = function (k, fb) { return draft[k] !== undefined ? draft[k] : (fb || ''); };
      const msg = app._loginMsg || {};
      const cnt = app._otpCountdown || 0;
      const busy = !!app._otpBusy;
      const canSend = !busy && cnt <= 0;
      html += '<div class="card wide login-card">' +
        '<div class="login-head">' + logo() +
        '<div><div class="login-title">登录 / 注册闪星卡</div>' +
        '<div class="login-sub">用邮箱 / 手机验证码登录，学习数据只留本机。</div></div></div>' +

        '<div class="login-tabs">' +
        '<button class="login-tab' + (isPhone ? '' : ' on') + '" data-act="login-tab" data-mode="email">' + icon('mail', 'i15') + '邮箱登录</button>' +
        '<button class="login-tab' + (isPhone ? ' on' : '') + '" data-act="login-tab" data-mode="phone">' + icon('phone', 'i15') + '手机号登录</button>' +
        '</div>' +

        '<div class="login-form">' +
        (isPhone
          ? '<div class="field"><label>手机号</label><input id="loginPhone" type="tel" inputmode="numeric" maxlength="11" value="' + esc(dv('phone', a.phone)) + '" placeholder="11 位手机号" autocomplete="tel" /></div>'
          : '<div class="field"><label>邮箱</label><input id="loginEmail" type="email" value="' + esc(dv('email', a.email)) + '" placeholder="name@example.com" autocomplete="email" /></div>'
        ) +
        '<div class="field"><label>验证码</label>' +
        '<div class="otp-row"><input id="loginCode" type="text" inputmode="numeric" maxlength="6" value="' + esc(dv('code')) + '" placeholder="收到的验证码" autocomplete="one-time-code" />' +
        '<button type="button" class="btn btn-sm" id="btnSendCode" data-act="login-send"' + (canSend ? '' : ' disabled') + '>' +
        (busy ? '发送中…' : (cnt > 0 ? cnt + ' 秒后重发' : '获取验证码')) + '</button></div></div>' +
        (!isPhone && app._otpChallenge && !app._otpChallenge.isExistingUser
          ? '<div class="field"><label>设置密码（新用户）</label><input id="loginPassword" type="password" value="' + esc(dv('password')) + '" placeholder="至少 6 位，用于今后登录" autocomplete="new-password" /></div>'
          : '') +
        '<div class="login-msg' + (msg.text ? ' login-msg-' + (msg.kind || 'err') : '') + '" id="loginMsg">' + esc(msg.text || '') + '</div>' +
        '<label class="agree"><input type="checkbox" id="loginAgree"' + (draft.agree ? ' checked' : '') + ' />' +
        '<span>我已阅读并同意 <button class="link-btn" data-act="privacy-info">隐私说明</button></span></label>' +
        '<button class="btn btn-primary btn-block" data-act="login-submit">' + icon('lock', 'i16') + '登录 / 注册</button>' +
        '</div>' +
        (online
          ? '<div class="login-foot">' + icon('shield', 'i15') + '验证码由云端发送；昵称、头像、牌组与学习记录都只保留在本机，不写入 .srcd。</div>'
          : '<div class="login-foot">' + icon('info', 'i15') + '当前是本地离线打开，验证码登录需联网并通过在线网址使用；离线仍可正常复习本机牌组。</div>') +
        '</div>';
    }

    // 个人信息
    html += '<div class="card"><div class="card-head">' + icon('user', 'i18') + '<span>个人信息</span></div>' +
      '<div class="kv"><span class="kv-k">昵称</span><span class="kv-v">' + esc(on ? name : '未设置') + '</span></div>' +
      '<div class="kv"><span class="kv-k">邮箱</span><span class="kv-v">' + esc(a.email || '未填写') + '</span></div>' +
      (a.phone ? '<div class="kv"><span class="kv-k">手机号</span><span class="kv-v">' + esc(a.phone) + '</span></div>' : '') +
      '<div class="kv"><span class="kv-k">登录方式</span><span class="kv-v">' +
        (a.provider === 'huawei' ? '华为账号' : a.provider === 'phone' ? '手机号验证码' : a.provider === 'email' ? '邮箱验证码' : '本机昵称') + '</span></div>' +
      '<div class="kv"><span class="kv-k">用户 ID</span><span class="kv-v mono">' + esc(a.uid || '—') + '</span></div>' +
      '<div class="kv"><span class="kv-k">加入时间</span><span class="kv-v">' + esc(a.joinedAt ? a.joinedAt.substring(0, 10) : '—') + '</span></div>' +
      '<div class="kv"><span class="kv-k">登录状态</span><span class="kv-v ' + (on ? 'ok' : '') + '">' + (on ? '已登录' : '未登录') + '</span></div>' +
      (on ? '<button class="btn btn-sm btn-block" style="margin-top:12px" data-act="profile-open">' + icon('pencil', 'i14') + '编辑个人资料</button>' : '') +
      '</div>';

    // 隐私设置
    html += '<div class="card"><div class="card-head">' + icon('shield', 'i18') + '<span>隐私设置</span></div>' +
      privacyRow('rememberLogin', p.rememberLogin !== false, '记住登录状态', '关闭后每次打开都需要重新登录') +
      privacyRow('showNickname', p.showNickname !== false, '显示我的昵称', '关闭后界面中统一显示为「学习者」') +
      privacyRow('privacyBlur', p.privacyBlur === true, '离开窗口时隐藏内容', '切到其他窗口时自动遮盖学习界面') +
      '<button class="btn btn-sm btn-block" style="margin-top:12px" data-act="privacy-info">' + icon('info', 'i14') + '查看隐私说明</button>' +
      '<div class="subtle" style="margin-top:10px">隐私偏好保存在本机，不会随 .srcd 导出。</div>' +
      '</div>';

    // 云同步卡片插槽：由 cloudsync.js 填充（未配置/未启用时为空，不影响外观）
    html += '<div id="cs-slot"></div>';

    html += '</div>';
    return html + tabbar(-1, app);
  }

  // ---------------------------------------------------------------- 模态
  function modal(app) {
    const m = app.modal;
    if (!m) return '';
    let inner = '';
    if (m.type === 'deck') {
      inner = '<h3>' + (m.id ? '编辑牌组' : '新建牌组') + '</h3>' +
        '<div class="field"><label>名称</label><input id="mName" value="' + esc(m.name || '') + '" placeholder="如：英语高频词" /></div>' +
        '<div class="field"><label>描述（可选）</label><input id="mDesc" value="' + esc(m.desc || '') + '" placeholder="一句话说明" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'card') {
      inner = '<h3>' + (m.id ? '编辑卡片' : '添加卡片') + '</h3>' +
        '<div class="field"><label>正面（问题）</label><input id="mFront" value="' + esc(m.front || '') + '" placeholder="如：ubiquitous" /></div>' +
        '<div class="field"><label>背面（答案）</label><input id="mBack" value="' + esc(m.back || '') + '" placeholder="如：无处不在的" /></div>' +
        '<div class="field"><label>提示 / 笔记（可选）</label><input id="mExtra" value="' + esc(m.extra || '') + '" placeholder="可选" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'batch') {
      inner = '<h3>批量粘贴卡片</h3><div class="subtle" style="margin-bottom:8px">每行一张，Tab 或「::」或「|」分隔正反面；# 开头为注释。</div>' +
        '<div class="field"><textarea id="mBatch" rows="8" placeholder="front1\tback1\nfront2::back2"></textarea></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">导入</button></div>';
    } else if (m.type === 'class') {
      inner = '<h3>创建班级</h3>' +
        '<div class="subtle" style="margin-bottom:10px">建好的同时会生成一个 8 位密钥，同学输入它就能进来。</div>' +
        '<div class="field"><label>班级名称</label>' +
        '<input id="mCName" value="' + esc(m.name || '') + '" maxlength="24" placeholder="如：雅思 30 天冲刺班" /></div>' +
        '<div class="field"><label>一句话说明（可选）</label>' +
        '<input id="mCDesc" value="' + esc(m.desc || '') + '" maxlength="60" placeholder="每天 30 张，掉队的请奶茶" /></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div class="field"><label>每日目标（张）</label>' +
        '<input id="mCDaily" type="number" inputmode="numeric" min="1" max="9999" value="30" /></div>' +
        '<div class="field"><label>总目标（张）</label>' +
        '<input id="mCTotal" type="number" inputmode="numeric" min="10" max="9999999" value="1000" /></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div class="field"><label>人数上限</label>' +
        '<input id="mCMax" type="number" inputmode="numeric" min="2" max="500" value="50" /></div>' +
        '<div class="field"><label>截止日期（可选）</label>' +
        '<input id="mCEnds" type="date" /></div>' +
        '</div>' +
        '<div class="hint" style="margin-top:14px">密钥只给班级成员，随时可以在班级里换新的；换完旧密钥立即失效。</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">创建并生成密钥</button></div>';
    } else if (m.type === 'join') {
      inner = '<h3>用密钥加入班级</h3>' +
        '<div class="subtle" style="margin-bottom:10px">输入班级创建者给你的密钥，连字符打不打都行。</div>' +
        '<div class="field"><input id="mCode" value="' + esc(m.code || '') + '" maxlength="12" ' +
        'inputmode="latin" autocomplete="off" autocapitalize="characters" placeholder="如 UZ33-9Y7X" ' +
        'style="letter-spacing:2px;text-transform:uppercase;font-weight:600" /></div>' +
        '<div class="hint">加入后，你和同学的今日、累计学习量会自动汇总到这个班级。</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">加入</button></div>';
    } else if (m.type === 'member') {
      inner = '<h3>添加成员</h3><div class="field"><input id="mMember" value="' + esc(m.name || '') + '" placeholder="小明" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'deskmate') {
      inner = '<h3>添加同桌</h3>' +
        '<div class="field"><label>名字</label><input id="mDName" value="' + esc(m.name || '') + '" placeholder="阿月" /></div>' +
        '<div class="field"><label>备注（可选）</label><input id="mDNote" value="' + esc(m.note || '') + '" placeholder="每天一起背 20 词" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'community-post') {
      const decks = (app.state.decks || []).filter(function (d) { return (d.cards || []).length > 0; });
      let opts = '<option value="">不附带词库</option>';
      for (let i = 0; i < decks.length; i++) {
        opts += '<option value="' + esc(decks[i].id) + '">' + esc(decks[i].name) +
          '（' + (decks[i].cards || []).length + ' 张）</option>';
      }
      inner = '<h3>发到社区</h3>' +
        '<div class="field"><label>标题（可选）</label><input id="cpTitle" maxlength="60" placeholder="如：SAT800 第 3 遍，整理了一份易混词" /></div>' +
        '<div class="field"><label>说点什么</label><textarea id="cpBody" rows="5" maxlength="2000" placeholder="今天背了多少、卡在哪里、想找什么样的同桌。"></textarea></div>' +
        '<div class="field"><label>附上词库（可选，别人可以一键导入）</label><select id="cpDeck">' + opts + '</select>' +
        (decks.length ? '<div class="hint">会打包成 .srcd 上传，单次上限 5MB。</div>' : '<div class="hint">还没有可分享的牌组。</div>') +
        '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">发布</button></div>';
    } else if (m.type === 'account') {
      inner = '<h3>登录 / 创建账户</h3>' +
        '<div class="subtle" style="margin-bottom:4px">当前为本地账户，信息只保存在本机浏览器。</div>' +
        '<div class="field"><label>昵称</label><input id="mNick" value="' + esc(m.nickname || '') + '" placeholder="如：阿月" /></div>' +
        '<div class="field"><label>邮箱（可选）</label><input id="mEmail" value="' + esc(m.email || '') + '" placeholder="（可选）" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">登录</button></div>';
    } else if (m.type === 'profile') {
      inner = '<h3>编辑个人资料</h3>' +
        '<div class="subtle" style="margin-bottom:8px">资料只保存在本机浏览器，用于标识你的学习身份。</div>' +
        '<div class="field"><label>昵称</label><input id="mNick" value="' + esc(m.nickname || '') + '" placeholder="如：阿月" /></div>' +
        '<div class="field"><label>邮箱（可选）</label><input id="mEmail" value="' + esc(m.email || '') + '" placeholder="（可选）" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">保存</button></div>';
    } else if (m.type === 'avatar') {
      const acc = app.account || {};
      let colors = '';
      for (let i = 0; i < 6; i++) {
        colors += '<button class="ava-pick ava-c' + i +
          (Number(m.color) === i && !m.data ? ' on' : '') +
          '" data-act="avatar-color" data-color="' + i + '" aria-label="头像配色 ' + (i + 1) + '"></button>';
      }
      inner = '<h3>更换头像</h3>' +
        '<div class="ava-editor">' +
        '<div class="ava-editor-preview">' + avatarFace(acc, 'ava-lg') + '</div>' +
        '<div class="ava-editor-side">' +
        '<div class="field-label">选择配色</div><div class="ava-colors">' + colors + '</div>' +
        '<div class="field-label" style="margin-top:14px">或上传图片</div>' +
        '<label class="btn btn-sm btn-block ava-upload" for="avatarFile">' + icon('camera', 'i14') + '选择本地图片</label>' +
        '<input type="file" id="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />' +
        (m.data ? '<button class="btn btn-sm btn-block" style="margin-top:8px" data-act="avatar-clear">' + icon('rotate', 'i14') + '移除图片</button>' : '') +
        '</div></div>' +
        '<div class="subtle" style="margin-top:10px">上传后可拖动、缩放，选好圆形区域再保存；图片只保存在本机。</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
    } else if (m.type === 'avatar-crop') {
      const c = app._crop || {};
      inner = '<h3>调整头像</h3>' +
        '<div class="crop-wrap">' +
        '<div class="crop-stage" id="avaCropStage">' +
        '<img class="crop-img" id="avaCropImg" src="' + esc(c.src || '') + '" alt="" draggable="false" />' +
        '<span class="crop-ring"></span>' +
        '</div>' +
        '<div class="crop-zoom">' +
        '<button class="crop-btn" data-act="crop-zoom" data-dir="-1" aria-label="缩小">−</button>' +
        '<input type="range" id="avaCropZoom" min="100" max="320" step="1" value="100" aria-label="缩放" />' +
        '<button class="crop-btn" data-act="crop-zoom" data-dir="1" aria-label="放大">+</button>' +
        '</div>' +
        '<div class="crop-tip">拖动图片调整位置 · 滑杆或滚轮缩放 · <b id="avaCropPct">100%</b></div>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="crop-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="crop-apply">' + icon('check', 'i15') + '使用这张</button></div>';
    } else if (m.type === 'privacy') {
      inner = '<h3>隐私说明</h3>' +
        '<div class="privacy-doc">' +
        '<p><strong>1. 学习数据都在这台设备上</strong><br/>牌组、卡片、复习记录、词书进度、班级、同桌、比赛战绩，以及昵称、头像和隐私偏好，全部保存在本浏览器的 localStorage 中，不会上传到任何服务器。</p>' +
        '<p><strong>2. 登录只用于身份校验</strong><br/>邮箱 / 手机号通过云端验证码登录，验证码由云服务发送，仅用于确认身份。云端不保存你的牌组与学习记录；退出登录可随时清除本机登录状态。</p>' +
        '<p><strong>3. 所有内容都在本机处理</strong><br/>牌组解析、复习调度、智能诊断均由本机脚本完成，不会把词库、卡片原文或个人身份信息传给第三方。</p>' +
        '<p><strong>4. 导出文件不含个人资料</strong><br/>导出的 .SRCD 只包含牌组、卡片与 FSRS 参数；昵称、邮箱、头像与隐私偏好都不会写入文件，可以放心分享。</p>' +
        '<p><strong>5. 你随时可以删除</strong><br/>「清除账户数据」会删除账户资料、头像与隐私偏好；「设置 → 清空数据」会删除全部牌组与学习记录。两者都不可恢复，建议先导出 .srcd 备份。</p>' +
        '<p><strong>5. 隐私开关</strong><br/>「记住登录状态」控制刷新后是否自动登录；「显示我的昵称」控制界面是否展示昵称；「离开窗口时隐藏内容」在切到其他窗口时遮盖页面。所有开关只影响本机显示。</p>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn btn-primary" data-act="modal-cancel">我知道了</button></div>';
    } else if (m.type === 'apkg-preview') {
      const r = app.apkgImport;
      if (!r) {
        inner = '<h3>解析失败</h3><div class="subtle">没有可预览的内容。</div>' +
          '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      } else {
        const s = r.stats;
        let dl = '';
        for (let i = 0; i < r.decks.length; i++) {
          dl += '<div class="apkg-deck"><span>' + esc(r.decks[i].name) + '</span><b>' + r.decks[i].cards.length + ' 张</b></div>';
        }
        inner = '<h3>从 Anki 导入</h3>' +
          '<div class="apkg-summary">' +
          '<div class="apkg-stat"><b>' + s.cards + '</b><span>张卡片</span></div>' +
          '<div class="apkg-stat"><b>' + s.decks + '</b><span>个牌组</span></div>' +
          '<div class="apkg-stat"><b>' + s.media + '</b><span>个媒体</span></div>' +
          '</div>' +
          '<div class="subtle" style="margin:10px 0">来源：' + esc(r.collection) + ' · ' + esc(r.file) +
          (s.skipped ? ' · 跳过 ' + s.skipped + ' 张异常卡' : '') + '</div>' +
          '<div class="apkg-decks">' + dl + '</div>' +
          '<div class="subtle" style="margin-top:10px">笔记模型：' + esc((s.models || []).join('、')) + '</div>' +
          '<div class="subtle" style="margin-top:8px">会保留标签、标记、暂停状态与到期时间；图片 / 音频以内嵌媒体形式导入。不会覆盖现有牌组。</div>' +
          '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
          '<button class="btn btn-primary" data-act="apkg-confirm">确认导入</button></div>';
      }
    } else if (m.type === 'builtin-offer') {
      const dn = esc(m.deckName || '同名新版词库');
      inner = '<h3>需要换个方式导入</h3>' +
        '<div class="zstd-note">' +
        '<p>你选的是 <b>Anki 新版（zstd 压缩）</b>词库，浏览器没法直接解析这种格式。</p>' +
        '<p>不过这份词库我们已经准备好了 <b>' + dn + '</b> 版本，含完整释义与发音，点一下就能导入，不用你再找文件。</p>' +
        '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="builtin-load" data-file="' + esc(m.deckFile || 'SAT800美音.srcd') + '" data-name="' + dn + '">' +
        icon('download', 'i16') + '立即载入「' + dn + '」</button></div>' +
        '<div class="subtle" style="margin-top:10px">若这份词库不是 SAT800 美音，请用「导入」手动选择对应的 .srcd 文件。</div>';
    } else if (m.type === 'import-hub') {
      inner = '<h3>导入词库</h3>' +
        '<div class="subtle" style="margin-bottom:10px">选择一种格式导入，卡片与学习进度会合并到本机。</div>' +
        '<div class="menu-list">' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="srcd">' + icon('download', 'i20') +
        '<span><b>闪星 .srcd</b><small>单文件牌组，含复习进度 · 兼容旧 .fscd</small></span></button>' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="apkg">' + icon('layers', 'i20') +
        '<span><b>Anki .apkg / .colpkg</b><small>保留模板 · 标签 · 复习进度 · 图片音频</small></span></button>' +
        '<button class="menu-item menu-rich" data-act="import-pick" data-kind="csv">' + icon('table', 'i20') +
        '<span><b>CSV 表格</b><small>从 Excel / Anki 批量生成，粘贴文本导入</small></span></button>' +
        '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-sm" data-act="import-formats">' + icon('info', 'i14') + '支持的格式</button></div>';
    } else if (m.type === 'import-formats') {
      inner = '<h3>支持的导入格式</h3>' +
        '<div class="privacy-doc">' +
        '<p><strong>.srcd（StarCard 牌组）</strong><br/>本应用开放的单文件牌组格式，含牌组、卡片、FSRS 复习进度与媒体，兼容旧版 .fscd。可从本机文件选择导入，同名牌组就地更新、进度按卡片正面自动迁移。</p>' +
        '<p><strong>.apkg / .colpkg（Anki 原生包）</strong><br/>纯前端解析 ZIP + SQLite，自动映射基础 / 反向 / 填空模板、标签、标记、暂停与到期时间，并保留内嵌图片音频。Anki 2.1.60+ 的 zstd 压缩包浏览器无法直接解析，会弹窗提示一键载入随包提供的对应词库。</p>' +
        '<p><strong>CSV 表格</strong><br/>适用于 Excel / Anki 批量生成，正反面以逗号或 Tab 分隔，支持引号转义与自动字段映射，导入前可预览。</p>' +
        '<p><strong>批量粘贴</strong><br/>在卡片编辑里按行粘贴，Tab / :: / | 分隔正反面，# 开头为注释。</p>' +
        '</div><div class="dialog-actions"><button class="btn btn-primary" data-act="import-back">' + icon('chevronLeft', 'i14') + '返回导入</button>' +
        '<button class="btn" data-act="modal-cancel">关闭</button></div>';
    } else if (m.type === 'confirm') {
      inner = '<h3>' + esc(m.title || '确认') + '</h3><div class="subtle" style="margin-bottom:8px">' +
        esc(m.message || '') + '</div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-danger" data-act="modal-ok">确定</button></div>';
    } else if (m.type === 'card-v2' && FCUI.cardEditor) {
      inner = FCUI.cardEditor(m);
    } else if (m.type === 'deck-options' && FCUI.deckOptions) {
      inner = FCUI.deckOptions(m);
    } else if (m.type === 'card-info' && FCUI.cardInfo) {
      inner = FCUI.cardInfo(m);
    } else if (m.type === 'custom-study' && FCUI.customStudy) {
      inner = FCUI.customStudy(app);
    } else if (m.type === 'csv-import' && FCUI.csvImport) {
      inner = FCUI.csvImport(app);
    } else if (m.type === 'deck-menu') {
      const deck = app.state.decks.find(function (x) { return x.id === m.deckId; });
      if (deck) {
        // 该牌组若属于某已注册系列，提供「删除整个词库」入口（一次删掉同系列全部分册）
        let deckSeries = null;
        const _series = FC.visibleSeries ? FC.visibleSeries(app.state) : [];
        for (let i = 0; i < _series.length; i++) {
          if ((deck.tags || []).indexOf(_series[i].tagKey) >= 0) { deckSeries = _series[i]; break; }
        }
        inner = '<h3>' + esc(deck.name) + '</h3>' +
          '<div class="menu-list">' +
          '<button class="menu-item" data-act="browser-deck" data-id="' + esc(deck.id) + '">' + icon('table', 'i16') + '浏览卡片</button>' +
          '<button class="menu-item" data-act="deck-options" data-id="' + esc(deck.id) + '">' + icon('settings', 'i16') + '牌组选项</button>' +
          '<button class="menu-item" data-act="deck-reset" data-id="' + esc(deck.id) + '">' + icon('rotate', 'i16') + '重置此牌组进度</button>' +
          '<button class="menu-item" data-act="deck-rename" data-id="' + esc(deck.id) + '">' + icon('pencil', 'i16') + '重命名</button>' +
          '<button class="menu-item" data-act="deck-export" data-id="' + esc(deck.id) + '">' + icon('upload', 'i16') + '导出此牌组</button>' +
          '<button class="menu-item" data-act="deck-move-menu" data-id="' + esc(deck.id) + '">' + icon('folder', 'i16') + '移动到文件夹</button>' +
          '<button class="menu-item" data-act="deck-subdeck" data-id="' + esc(deck.id) + '">' + icon('plus', 'i16') + '新建子牌组</button>' +
          (deckSeries ? '<button class="menu-item danger" data-act="series-delete-by-deck" data-id="' + esc(deck.id) + '">' + icon('trash', 'i16') + '删除整个词库（' + esc(deckSeries.name) + '）</button>' : '') +
          '<button class="menu-item danger" data-act="deck-delete" data-id="' + esc(deck.id) + '">' + icon('trash', 'i16') + '删除牌组</button>' +
          '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      } else {
        inner = '<h3>牌组不存在</h3><div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      }
    } else if (m.type === 'folder-move') {
      const deck = app.state.decks.find(function (x) { return x.id === m.deckId; });
      if (deck) {
        const folders = app.state.folders || [];
        const cur = deck.folderId || '';
        let opts = '<button class="menu-item' + (!cur ? ' active' : '') + '" data-act="deck-move" data-folder="" data-id="' + esc(deck.id) + '">' + icon('folder', 'i16') + '不归属任何文件夹</button>';
        for (let i = 0; i < folders.length; i++) {
          opts += '<button class="menu-item' + (cur === folders[i].id ? ' active' : '') + '" data-act="deck-move" data-folder="' + esc(folders[i].id) + '" data-id="' + esc(deck.id) + '">' + icon('folder', 'i16') + esc(folders[i].name) + '</button>';
        }
        inner = '<h3>移动到文件夹 · ' + esc(deck.name) + '</h3>' +
          '<div class="subtle" style="margin-bottom:10px">选择目标文件夹，或新建一个。</div>' +
          '<div class="menu-list">' + opts + '</div>' +
          '<div class="dialog-actions"><button class="btn" data-act="folder-new-then-move" data-id="' + esc(deck.id) + '">' + icon('plus', 'i14') + '新建文件夹</button>' +
          '<button class="btn" data-act="modal-cancel">关闭</button></div>';
      } else {
        inner = '<h3>牌组不存在</h3><div class="dialog-actions"><button class="btn" data-act="modal-cancel">关闭</button></div>';
      }
    } else if (m.type === 'flag') {
      inner = '<h3>设置标记</h3><div class="subtle" style="margin-bottom:10px">标记可用于筛选和浏览器搜索（flag:1 … flag:7）。</div>' +
        '<div class="flag-row">';
      for (let i = 0; i <= 7; i++) {
        if (i === 0) {
          inner += '<button class="flag-pick" data-act="flag-set" data-flag="0" title="无标记"><span class="flag-none">无</span></button>';
        } else {
          inner += '<button class="flag-pick" data-act="flag-set" data-flag="' + i + '">' +
            '<span class="flag-dot big" style="background:' + FC.FLAG_COLORS[i] + '"></span></button>';
        }
      }
      inner += '</div><div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button></div>';
    } else if (m.type === 'tag') {
      inner = '<h3>添加标签</h3><div class="field"><label>标签（空格分隔）</label>' +
        '<input id="mTags" value="' + esc(m.tags || '') + '" placeholder="动词 高频" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">添加</button></div>';
    } else if (m.type === 'move') {
      let opts = '';
      for (let i = 0; i < app.state.decks.length; i++) {
        opts += '<option value="' + esc(app.state.decks[i].id) + '">' + esc(app.state.decks[i].name) + '</option>';
      }
      inner = '<h3>移动到牌组</h3><div class="field"><label>目标牌组</label><select id="mMoveDeck">' +
        opts + '</select></div><div class="dialog-actions">' +
        '<button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">移动</button></div>';
    } else if (m.type === 'reschedule') {
      inner = '<h3>重新调度</h3><div class="subtle" style="margin-bottom:8px">把卡片的下次到期时间设为 N 天后，不会清除复习历史。</div>' +
        '<div class="field"><label>天数</label><input id="mDays" value="1" inputmode="numeric" /></div>' +
        '<div class="dialog-actions"><button class="btn" data-act="modal-cancel">取消</button>' +
        '<button class="btn btn-primary" data-act="modal-ok">确定</button></div>';
    } else if (m.type === 'shortcuts') {
      const k = function (t) { return '<kbd>' + t + '</kbd>'; };
      const kr = function (keys, label) {
        return '<div class="shortcut-row"><span class="shortcut-keys">' + keys +
          '</span><span class="shortcut-label">' + label + '</span></div>';
      };
      inner = '<h3>键盘快捷键</h3>' +
        '<div class="subtle" style="margin-bottom:14px">双手不离键盘刷完一组卡。任何页面按 ' + k('?') + ' 都能唤出本面板。</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">卡片学习</div>' +
          kr(k('空格') + ' / ' + k('Enter'), '翻面，看背面') +
          kr(k('空格') + ' / ' + k('Enter') + ' ' + k('3'), '良好（已翻面时快速通过）') +
          kr(k('1'), '重来 · 几分钟后再次出现') +
          kr(k('2'), '困难') +
          kr(k('4'), '简单') +
          kr(k('E') + ' ' + k('S') + ' ' + k('F') + ' ' + k('I') + ' ' + k('R'), '编辑 / 暂停 / 标记 / 信息 / 重置') +
        '</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">词书速记</div>' +
          kr(k('空格') + ' / ' + k('Enter'), '翻面 / 再按一次 = 认识') +
          kr(k('1') + ' ' + k('2') + ' ' + k('3'), '不认识 / 模糊 / 认识') +
        '</div>' +
        '<div class="shortcut-group"><div class="shortcut-gt">全局</div>' +
          kr(k('?'), '打开本快捷键面板') +
          kr(k('B'), '打开卡片浏览器') +
          kr(k('Shift') + ' + ' + k('1') + '~' + k('7'), '工坊：给选中卡片打旗标（7 色）') +
          kr(k('Shift') + ' + ' + k('0'), '工坊：清除选中卡片的旗标') +
kr(k('Ctrl') + ' + ' + k('Z'), '撤销上一步') +
          kr(k('Esc'), '退出学习 / 关闭弹窗') +
        '</div>' +
        '<div class="dialog-actions"><button class="btn btn-primary" data-act="modal-ok">知道了</button></div>';
    }

    return '<div class="mask" data-act="mask-click"><div class="dialog' + (m.wide ? ' dialog-wide' : '') + '">' + inner + '</div></div>';
  }

  // ---------------------------------------------------------------- 智能助手 · 小星
  // 悬浮入口按钮：学习会话中隐藏，避免挡住评分条；打开后进入完整页面 AiPage
  function aiLayer(app) { return ''; }  // AI 助手已移除

  // 账户菜单定位：贴着左下角头像块的「上方」弹出（不再固定在侧栏中段）
  function acctMenuPlacement() {
    try {
      if (typeof document === 'undefined' || !document.querySelector) return '';
      const el = document.querySelector('.side-account');
      if (!el) return '';
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!vw || !vh || vw <= 600) return '';
      const width = Math.min(288, vw - 24);
      const left = Math.max(10, Math.min(Math.round(r.left), vw - width - 10));
      const bottom = Math.max(10, Math.round(vh - r.top + 8));
      const maxH = Math.max(240, Math.round(r.top - 24));
      return ' style="left:' + left + 'px;bottom:' + bottom + 'px;top:auto;right:auto;max-height:' + maxH + 'px"';
    } catch (e) { return ''; }
  }

  // 账户菜单：点头像弹出，参照 WorkBuddy 的账户面板（高面板 + 账户卡 + 功能入口）
  function accountMenuLayer(app) {
    if (!app.accountMenuOpen) return '';
    const acc = app.account || {};
    const on = !!acc.loggedIn;
    const name = app.accountDisplayName ? app.accountDisplayName() : (acc.nickname || '学习者');
    const idt = accountIdentity(app);
    const unread = noticeUnread(app);
    // 豆包风菜单行：线性图标 + 文字 + 右侧数值/箭头
    const item = function (ico, act, label, val, cls) {
      return '<button class="am-item' + (cls ? ' ' + cls : '') + '" data-act="' + act + '">' +
        '<span class="am-ico">' + icon(ico, 'i20') + '</span>' +
        '<span class="am-txt"><b>' + label + '</b></span>' +
        (val ? '<span class="am-val">' + val + '</span>' : '') +
        icon('chevronRight', 'i14') + '</button>';
    };
    const cloudCfg = (window.FC && FC.CLOUD_SYNC_CONFIG && FC.CLOUD_SYNC_CONFIG.anonKey);
    return '<div class="acct-menu-mask" data-act="account-menu-close"></div>' +
      '<div class="acct-menu" role="dialog" aria-label="账户菜单"' + acctMenuPlacement() + '>' +
      '<div class="am-head">' +
      '<button class="am-head-acct" data-act="account-open">' + avatarFace(acc, 'ava-lg') +
      '<span class="am-head-txt"><b>' + esc(on ? name : '匿名用户') + '</b>' +
      '<small class="am-head-id">' + esc(on ? (idt.ready ? idt.code : 'ID 待填手机尾号') : '登录后生成账户 ID') + '</small></span>' +
      icon('chevronRight', 'i14') + '</button>' +
      '</div>' +
      '<div class="am-list">' +
      '<div class="am-group">' +
      item('settings', 'goto-settings', '设置') +
      '<button class="am-item" data-act="notice-open">' +
      '<span class="am-ico">' + icon('bell', 'i20') + '</span>' +
      '<span class="am-txt"><b>通知</b></span>' +
      (unread > 0 ? '<span class="am-val am-badge-num">' + unread + '</span>' : '') +
      icon('chevronRight', 'i14') + '</button>' +
      '</div>' +
      '<div class="am-group">' +
      item('shield', 'privacy-info', '隐私说明') +
      (cloudCfg ? item('cloud', 'account-open', '云同步', '已开启') : '') +
      '</div>' +
      '</div>' +
      '<div class="am-foot">' +
      (on
        ? item('logout', 'account-logout', '退出登录', '', 'am-item-danger')
        : '<button class="am-item am-item-primary" data-act="account-open">' +
          '<span class="am-ico">' + icon('lock', 'i20') + '</span>' +
          '<span class="am-txt"><b>登录 / 注册</b></span></button>') +
      '</div></div>';
  }

  // 命令面板结果行（供完整页面 CmdPage 初始渲染与实时过滤复用）
  function cmdRowsHtml(app) {
    if (!FC.AI) return '';
    const list = FC.AI.FILTER(app, app.cmdQuery || '', 8);
    let rows = '';
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      rows += '<button class="cmd-row' + (i === app.cmdIndex ? ' on' : '') + '" data-act="cmd-pick" data-i="' + i + '">' +
        '<span class="cmd-ico">' + icon(c.icon, 'i18') + '</span>' +
        '<span class="cmd-txt"><b>' + esc(c.label) + '</b><small>' + esc(c.sub) + '</small></span>' +
        (i === app.cmdIndex ? '<span class="cmd-enter">' + icon('chevronRight', 'i14') + '</span>' : '') +
        '</button>';
    }
    if (!rows) rows = '<div class="cmd-empty">没有匹配项，换个关键词试试</div>';
    return rows;
  }

  function aiBriefing(app) {
    if (!FC.AI || !FC.AI.BRIEFING) return '';
    const txt = FC.AI.BRIEFING(app);
    return '<div class="ai-brief">' +
      '<span class="ai-brief-ico">' + icon('sparkles', 'i18') + '</span>' +
      '<div class="ai-brief-txt"><b>今日简报</b><span>' + esc(txt) + '</span></div>' +
      '</div>';
  }

  function aiDiagnosis(app) {
    if (!FC.AI || !FC.AI.DIAGNOSIS) return '';
    const items = FC.AI.DIAGNOSIS(app);
    let rows = '';
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      rows += '<div class="ai-diag-row tone-' + esc(it.tone) + '">' +
        '<span class="ai-diag-ico">' + icon(it.icon, 'i18') + '</span>' +
        '<div><b>' + esc(it.title) + '</b><span>' + esc(it.desc) + '</span></div></div>';
    }
    return '<div class="section-title">智能诊断</div><div class="card wide ai-diag">' + rows + '</div>';
  }

  // 覆盖层：悬浮入口（小星按钮等），附加到所有页面根节点之后
  function overlays(app) {
    return aiLayer(app) + accountMenuLayer(app);
  }

  // ============================================================
  // ArkUI 声明式页面组件（鸿蒙 ArkTS 风格：class extends Component）
  // ============================================================

  // 牌组学习项（声明式）
  function deckStudyItemEl(d, s, now, st) {
    const c = s.deckCounts(d, now);
    const total = d.cards.length;
    const isSat = (d.tags || []).indexOf('sat800') >= 0;
    const cap = (typeof FC.settingsFor === 'function' ? FC.settingsFor(d, st.settings) : st.settings).newCardsPerDay;
    const left = Math.max(0, cap - st.newToday);
    const capped = c[0] > left;
    let inProgress = 0;
    for (let k = 0; k < d.cards.length; k++) {
      const cc = d.cards[k];
      if (cc.state === FC.STATE_LEARNING || cc.state === FC.STATE_RELEARNING) inProgress += 1;
    }
    const masteredCount = Math.max(0, total - c[0] - inProgress);
    const masterPct = total === 0 ? 0 : Math.round(masteredCount / total * 100);
    const key = String((d && d.id) || (d && d.name) || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const tone = 'av-tone-' + (h % 8);

    const chips = [];
    if (c[0]) chips.push(new A.El('span', '新 ' + c[0]).cls('dchip dc-new'));
    if (c[1]) chips.push(new A.El('span', '到期 ' + c[1]).cls('dchip dc-due'));
    if (!c[0] && !c[1] && total > 0) chips.push(new A.El('span', '今日已完成').cls('dchip dc-done'));

    const nameEl = new A.El('div').cls('name').child(new A.El('span', d.name));
    if (chips.length) nameEl.child(new A.El('span').cls('deck-chips').children(chips));

    const main = new A.El('div').cls('li-main').children([
      nameEl,
      new A.El('div').cls('meta').html((d.description ? esc(d.description) + ' · ' : '') + '已掌握 ' + masteredCount + ' / ' + total + ' 张')
    ]);
    if (capped) {
      main.child(new A.El('div').cls('cap-warn').attr('act', 'settings-open').title('点击前往统一设置').children([
        iconEl('info', 'i13'),
        new A.El('span', '新卡限 ' + left + ' 张 · 调大上限')
      ]));
    }
    main.child(new A.El('div').cls('progress deck-prog').child(new A.El('span').style('width', masterPct + '%')));

    return new A.El('div').cls('list-item deck-item').attr('act', 'study-deck').attr('id', d.id).children([
      new A.El('div').cls('avatar deck-av ' + tone).child(iconEl(isSat ? 'book' : 'layers', 'i20')),
      main,
      new A.El('div').cls('li-actions').children([
        btnEl({ label: '学习', type: 'primary', size: 'sm', act: 'study-deck', id: d.id }),
        btnEl({ type: 'more', size: 'sm', act: 'deck-menu', id: d.id, title: '更多操作', ico: 'more', icoSize: 'i16' })
      ])
    ]);
  }

  // 首页（卡片页）
  class DeckPage extends A.Component {
    build() {
      const app = this.props.app;
      const st = app.state;
      const s = new FC.Scheduler(st.settings);
      const now = Date.now();
      const ov = FC.smartOverview ? FC.smartOverview(st) : null;

      const content = new A.El('div').cls('content home-page');
      // 用区块容器承接 HTML：A.Html 会生成 <span>，作为 grid 子项只有一列宽，
      // 会把紫色概览压成窄条。hp-block 统一通栏。
      const HP = function (html) { return new A.El('div').cls('hp-block').html(html); };
      if (ov) content.child(HP(overviewHero(ov, app)));
      const rsb = resumeStudyBanner(app);
      if (rsb) content.child(HP(rsb));
      if (FCUI.aiBriefing) { const ab = FCUI.aiBriefing(app); if (ab) content.child(HP(ab)); }
      const he = homeExtras(app, ov);
      if (he) content.child(HP(he));
      if (st.decks.length === 0) {
        const onboard = new A.El('div').cls('onboard').children([
          new A.El('div').cls('ob-head').children([
            new A.El('span').cls('ob-ico').child(iconEl('cards', 'i20')),
            new A.El('div').children([
              new A.El('b', '快速开始'),
              new A.El('small', '所有数据保存在本设备，可离线使用。')
            ])
          ]),
          new A.El('div').cls('ob-steps').children([
            new A.El('div').cls('ob-step').children([
              new A.El('span', '1').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '导入词库'),
                new A.El('small', '支持 .srcd / Anki .apkg / CSV；每个词库会自动成为一个系列')
              ]),
              btnEl({ label: '去导入', type: 'primary', size: 'sm', act: 'import-hub' })
            ]),
            new A.El('div').cls('ob-step').children([
              new A.El('span', '2').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '导入自己的内容'),
                new A.El('small', '支持 Anki .apkg / .colpkg、.srcd 与 CSV，或新建牌组')
              ]),
              btnEl({ label: '前往词书', size: 'sm', act: 'tab', tab: 1 })
            ]),
            new A.El('div').cls('ob-step').children([
              new A.El('span', '3').cls('ob-n'),
              new A.El('div').cls('ob-txt').children([
                new A.El('b', '键盘操作'),
                new A.El('small', '空格 / 回车翻面 · 1-4 评分')
              ]),
              btnEl({ label: '查看快捷键', size: 'sm', act: 'shortcuts-help' })
            ])
          ])
        ]);
        content.child(onboard);
      } else {
        content.child(sectionTitleEl('牌组 · 点击开始学习'));
        const seriesList = typeof FC.visibleSeries === 'function' ? FC.visibleSeries(st) : ((FC.SERIES && FC.SERIES.length) ? FC.SERIES : []);
        const split = splitDecksBySeries(st, seriesList);
        for (let si = 0; si < seriesList.length; si++) {
          const se = seriesList[si];
          const ds = split.bySeries[se.id];
          if (!ds || !ds.length) continue;
          const collapsed = (st.collapsedSeries || []).indexOf(se.id) >= 0;
          const group = new A.El('div').cls('series-group' + (collapsed ? ' collapsed' : '')).children([
            new A.El('div').cls('sg-head').children([
              A.Html('<button class="sg-toggle" data-act="series-toggle" data-id="' + esc(se.id) + '" title="折叠/展开">' + icon(collapsed ? 'chevronRight' : 'chevronDown', 'i14') + '</button>'),
              new A.El('span', se.name).cls('sg-name'),
              new A.El('span', ds.length + ' 个分册').cls('sg-meta'),
              btnEl({ label: '查看系列', size: 'sm', cls: 'sg-go', act: 'series-open', id: se.id })
            ])
          ]);
          for (let i = 0; i < ds.length; i++) group.child(deckStudyItemEl(ds[i], s, now, st));
          content.child(group);
        }
        if (split.userDecks.length) {
          content.child(sectionTitleEl('牌组 · 自建'));
          for (let i = 0; i < split.userDecks.length; i++) content.child(deckStudyItemEl(split.userDecks[i], s, now, st));
        }
      }

      return new A.El('div').id('root').children([
        titlebarEl('卡片', 'FSRS-5 间隔重复', {
          actions: '<button class="btn btn-sm" data-act="browser-open">' + icon('table', 'i14') + '浏览</button>' +
            '<button class="btn btn-sm" data-act="custom-study">' + icon('layers', 'i14') + '自定义学习</button>'
        }),
        content,
        tabbarEl(0, app)
      ]);
    }
  }

  // 通知页（声明式）
  class NoticePage extends A.Component {
    build() {
      const app = this.props.app;
      const items = noticeItems(app);
      const unread = noticeUnread(app) > 0;
      const content = new A.El('div').cls('content');
      if (!items.length) {
        content.child(new A.El('div').cls('card wide').child(new A.El('div').cls('notice-empty').children([
          iconEl('bell', 'i26'),
          new A.El('div', '暂时没有要提醒的事。'),
          new A.El('div', '今天没有待学卡片，也备份过了。').cls('subtle')
        ])));
      } else {
        const list = new A.El('div').cls('notice-list');
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const row = new A.El('div').cls('notice-item tone-' + it.tone + (unread ? ' unread' : ''));
          const ico = new A.El('span').cls('notice-ico').child(iconEl(it.icon, 'i20'));
          if (unread) ico.child(new A.El('i').cls('notice-dot'));
          const txt = new A.El('div').cls('notice-txt').children([
            new A.El('b', it.title),
            new A.El('small', it.desc)
          ]);
          row.children([ico, txt]);
          if (it.cta) {
            const b = btnEl({ label: it.cta, size: 'sm', act: 'notice-go' });
            if (i === 0) b.cls('btn btn-sm btn-primary');
            if (it.page) b.attr('page', it.page); else b.attr('tab', it.tab || 1);
            row.child(b);
          }
          list.child(row);
        }
        content.child(list);
      }
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('row-gap').children([
          btnEl({ label: '全部标为已读', act: 'notice-read', ico: 'checkCircle', icoSize: 'i16' }),
          btnEl({ label: '备份中心', act: 'backup-open', ico: 'shield', icoSize: 'i16' })
        ]),
        new A.El('div', '通知每天汇总一次：今日待学、连续打卡、备份提醒。全部在本机生成，不上传任何服务器。').cls('subtle').style('margin-top', '12px')
      ]));
      return new A.El('div').id('root').children([
        titlebarEl('通知', '学习提醒 · 备份提示', { back: { act: 'notice-back' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 备份中心页（声明式）
  class BackupPage extends A.Component {
    build() {
      const app = this.props.app;
      const st = app.state;
      const last = app.lastBackupAt ? app.lastBackupAt() : 0;
      const days = last ? Math.floor((Date.now() - last) / FC.DAY_MS) : -1;
      const remind = st.settings.backupRemindDays === undefined ? 14 : st.settings.backupRemindDays;
      const deckCount = st.decks.length;
      let cardCount = 0;
      for (let i = 0; i < st.decks.length; i++) cardCount += st.decks[i].cards.length;

      const content = new A.El('div').cls('content');
      content.child(new A.El('div').cls('stat-grid').children([
        statBoxEl(deckCount, '牌组数', false, 'folder'),
        statBoxEl(cardCount, '卡片数', false, 'cards'),
        statBoxEl(!last ? '未备份' : (days === 0 ? '今天' : days + ' 天前'), '上次备份', !last, 'shield')
      ]));

      content.child(sectionTitleEl('导出备份'));
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('kv').children([new A.El('span', '导出内容').cls('kv-k'), new A.El('span', '全部牌组 · 学习进度 · 复习统计').cls('kv-v')]),
        new A.El('div').cls('kv').children([new A.El('span', '文件格式').cls('kv-k'), new A.El('span', '.srcd（单文件，跨设备可导入）').cls('kv-v')]),
        new A.El('div').cls('kv').children([new A.El('span', '不包含').cls('kv-k'), new A.El('span', '昵称头像 · 隐私偏好 · 班级/比赛数据').cls('kv-v')]),
        btnEl({ label: '导出 .srcd 备份', type: 'primary', cls: 'btn-block', act: 'backup-export', ico: 'shield', icoSize: 'i16' }).style('margin-top', '14px'),
        new A.El('div', '导出后把文件存到网盘 / U 盘 / 另一台设备。建议每 14 天备份一次。').cls('subtle').style('margin-top', '10px')
      ]));

      content.child(sectionTitleEl('导入恢复'));
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('row-gap').children([
          btnEl({ label: '导入 .srcd', act: 'import', ico: 'merge', icoSize: 'i16' }),
          btnEl({ label: '导入 Anki .apkg', act: 'apkg-open', ico: 'layers', icoSize: 'i16' })
        ]),
        new A.El('div', '同名牌组就地更新，学习进度按卡片正面自动迁移，不会重复堆叠。').cls('subtle').style('margin-top', '10px')
      ]));

      content.child(sectionTitleEl('备份提醒'));
      const remindSelect = new A.El('select').id('setBackupRemind').children([
        new A.El('option', '关闭提醒').value('0'),
        new A.El('option', '每 7 天').value('7'),
        new A.El('option', '每 14 天').value('14'),
        new A.El('option', '每 30 天').value('30')
      ]);
      content.child(new A.El('div').cls('card wide').children([
        new A.El('div').cls('field').children([
          new A.El('label', '提醒频率'),
          remindSelect
        ]),
        btnEl({ label: '保存频率', size: 'sm', act: 'save-settings' }),
        new A.El('div', '到点后通知页会出现备份提醒。与「设置」页的备份提醒共用同一个设置。').cls('subtle').style('margin-top', '10px')
      ]));

      return new A.El('div').id('root').children([
        titlebarEl('备份中心', '导出 · 导入 · 提醒', { back: { act: 'backup-back' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 小星助手页（声明式 · 完整页面）
  class AiPage extends A.Component {
    build() {
      const app = this.props.app;
      const list = app.aiMessages || [];

      const msgs = new A.El('div').cls('ai-msgs').id('aiMsgs');
      if (!list.length && !app.aiBusy) {
        msgs.html(FC.AI && FC.AI.GREET ? FC.AI.GREET() : '');
      } else {
        for (let i = 0; i < list.length; i++) {
          const m = list[i];
          if (m.role === 'user') {
            msgs.child(new A.El('div').cls('ai-msg ai-msg-me').child(
              new A.El('div').cls('ai-bubble').child(new A.El('div', m.text))
            ));
          } else {
            msgs.child(new A.El('div').cls('ai-msg ai-msg-ai').children([
              new A.El('span').cls('ai-mini-ava').child(iconEl('sparkles', 'i14')),
              new A.El('div').cls('ai-bubble ai-bubble-ai').html(m.html || '')
            ]));
          }
        }
      }
      if (app.aiBusy) {
        msgs.child(new A.El('div').cls('ai-msg ai-msg-ai').children([
          new A.El('span').cls('ai-mini-ava').child(iconEl('sparkles', 'i14')),
          new A.El('div').cls('ai-bubble ai-bubble-ai').html('<div class="ai-typing"><i></i><i></i><i></i></div>')
        ]));
      }

      const input = new A.El('input').id('aiInput').type('text')
        .placeholder('问我任何学习问题…').value(app.aiDraft || '');
      input._attrs.autocomplete = 'off';
      const sendBtn = new A.El('button').cls('ai-send').attr('act', 'ai-send').child(iconEl('send', 'i18'));
      sendBtn._attrs['aria-label'] = '发送';

      const content = new A.El('div').cls('content ai-page').children([
        msgs,
        new A.El('div').cls('ai-input-row').children([input, sendBtn]),
        new A.El('div').cls('ai-foot').child(new A.El('div', '小星完全离线运行，你的数据不会离开这台设备'))
      ]);

      return new A.El('div').id('root').children([
        titlebarEl('小星', '离线智能助手 · 只懂你的数据', { back: { act: 'ai-close' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 命令面板页（声明式 · 完整页面）
  class CmdPage extends A.Component {
    build() {
      const app = this.props.app;
      const input = new A.El('input').id('cmdInput').type('text')
        .placeholder('搜索界面、功能、单词、卡片…').value(app.cmdQuery || '');
      input._attrs.autocomplete = 'off';

      const content = new A.El('div').cls('content cmd-page').child(
        new A.El('div').cls('cmd-shell').children([
          new A.El('div').cls('cmd-search').children([
            iconEl('search', 'i18'),
            input,
            new A.El('kbd', 'ESC')
          ]),
          new A.El('div').cls('cmd-list').id('cmdList').html(cmdRowsHtml(app)),
          new A.El('div').cls('cmd-foot').html(
            '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 执行</span>' +
            '<span class="cmd-foot-brand">' + icon('sparkles', 'i13') + ' 小星命令面板</span>'
          )
        ])
      );

      return new A.El('div').id('root').children([
        titlebarEl('命令', '搜索界面 · 功能 · 单词 · 卡片', { back: { act: 'cmd-close' } }),
        content,
        tabbarEl(app.tab, app)
      ]);
    }
  }

  // 字符串 HTML → 完整 DOM fragment（保留所有顶层节点，避免 overlays / modal 被丢弃）
  function htmlToNode(htmlStr) {
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlStr;
    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    return frag;
  }

  // 声明式页面 + 覆盖层 → DOM fragment
  function renderDeclarative(ComponentCls, app) {
    const rootNode = A.toNode(new ComponentCls({ app: app }).render());
    // 弹窗与覆盖层必须一起挂载：声明式页面（首页 / 小星 / 命令面板 / 通知 / 备份）以前漏了 modal，
    // 导致「牌组 ⋯ 菜单」「自定义学习」等点击后状态变了却毫无界面反应。
    const extra = modal(app) + overlays(app);
    if (!extra) return rootNode;
    const tmp = document.createElement('div');
    tmp.innerHTML = extra;
    const frag = document.createDocumentFragment();
    frag.appendChild(rootNode);
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    return frag;
  }

  // 渲染分派：声明式页面优先，其余页面回退到字符串渲染
  function renderArk(app) {
    if (app.noticePageOpen) return renderDeclarative(NoticePage, app);
    if (app.backupPageOpen) return renderDeclarative(BackupPage, app);
    if (app.study && app.studyActive !== false) { let h = '<div id="root">' + studySession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.wb) { let h = '<div id="root">' + wordBookSession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.battle) { let h = '<div id="root">' + battleSession(app) + '</div>'; const m = modal(app); if (m) h += m; return htmlToNode(h + overlays(app)); }
    if (app.browser && FCUI.browserPage) {
      let bh = '<div id="root">' + FCUI.browserPage(app) + '</div>';
      const bm = modal(app);
      if (bm) bh += bm;
      return htmlToNode(bh + overlays(app));
    }
    // 文件夹详情 / 卡片管理 / 系列详情：走字符串渲染
    if (app.folderId || app.cardManageDeckId || app.seriesId) {
      return htmlToNode(FCUI.renderLegacy(app));
    }
    // 首页用声明式渲染
    if (app.tab === 0 && !app.accountOpen) {
      return renderDeclarative(DeckPage, app);
    }
    // 其余页面沿用字符串渲染（后续逐页迁移）
    return htmlToNode(FCUI.renderLegacy(app));
  }

  const FCUI = {
    esc: esc,
    icon: icon,
    tabbarHtml: tabbar,
    achievementInfo: achievementInfo,
    levelInfo: levelInfo,
    streakStat: streakStat,
    aiLayer: aiLayer,
    cmdRowsHtml: cmdRowsHtml,
    aiBriefing: aiBriefing,
    aiDiagnosis: aiDiagnosis,
    renderLegacy: function (app) {
      if (app.study && app.studyActive !== false) {
        let sh = '<div id="root">' + studySession(app) + '</div>';
        const sm = modal(app);
        if (sm) sh += sm;
        return sh + overlays(app);
      }
      if (app.wb) return '<div id="root">' + wordBookSession(app) + '</div>' + overlays(app);
      if (app.battle) return '<div id="root">' + battleSession(app) + '</div>' + overlays(app);
      if (app.browser && FCUI.browserPage) {
        let bh = '<div id="root">' + FCUI.browserPage(app) + '</div>';
        const bm = modal(app);
        if (bm) bh += bm;
        return bh + overlays(app);
      }

      let body = '';
      // 卡片管理页优先于页签渲染：从「词书」页进入制作 / 编辑时，底部高亮仍留在来源页签
      // 系列详情页同样优先于页签：它是从「词书」进入的文件夹式内容视图
      if (app.folderId) body = folderPage(app);
      else if (app.cardManageDeckId) body = cardManagePage(app);
      else if (app.seriesId) body = seriesPage(app);
      else if (app.tab === 0) body = deckPage(app);
      else if (app.tab === 1) body = wordBookPage(app);
      else if (app.tab === 2) body = app.activeClassId ? classroomDetail(app) : classroomList(app);
      else if (app.tab === 3) body = deskmatePage(app);
      else if (app.tab === 4) body = battleConfig(app);
      else if (app.tab === 5) body = statsPage(app);
      else if (app.tab === 7 && window.SCShopUI) body = window.SCShopUI.render(app);
      else if (app.tab === 8) body = communityPage(app);
      else body = settingsPage(app);

      let html = '<div id="root">' + body + '</div>';
      const m = modal(app);
      if (m) html += m;
      return html + overlays(app);
    },
    render: renderArk
  };

  FCUI.THEME_PRESETS = THEME_PRESETS;
  global.FCUI = FCUI;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

