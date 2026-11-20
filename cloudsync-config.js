/* ============================================================
 * 闪星卡 · 云同步配置（唯一需要改的文件）
 * ------------------------------------------------------------
 * 拿到 supabase 的 anon public key 后，把下面 anonKey 的空字符串
 * 填进去即可激活云同步，其它文件都不用动。
 *
 * anon key 在哪拿：
 *   supabase 项目后台 → 左侧 Settings（齿轮）→ API
 *   → Project API keys → anon / public 那一串（不是 service_role！）
 *
 * 没填之前（anonKey 为空）：云同步整体休眠，网页一切照旧。
 * ============================================================ */
window.FC = window.FC || {};
window.FC.CLOUD_SYNC_CONFIG = {
  url: 'https://aqsbrjiiudrqhqazvipj.supabase.co',
  anonKey: 'sb_publishable_JwmC49Kdg_6lNKiWQnCgzA_BYjmLw-k',      // ← 已由 AI 自动填入（publishable key）
  autoPush: true,     // 学习进度变化后自动上传
  pushDelay: 2000,    // 防抖：停止操作 2 秒后才上传，避免频繁写
  otpType: 'email',   // 邮箱验证码类型；若登录报 type 错，改成 'magiclink'
  ui: true            // 左下角显示云同步小面板（登录/上传/下载/退出）
};
