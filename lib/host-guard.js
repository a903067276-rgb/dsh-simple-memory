/**
 * 宿主身份校验（2026-11-19）
 *
 * 背景：DSH 宿主的鉴权**不覆盖插件自注册的路由** —— 实测对插件路由不带 token 请求
 * 仍返回 200。所以任何会读写私人数据的插件路由都必须自己证明「请求来自本机或本局域网
 * 的宿主 UI」。本模块给这类插件共用，规则只有三条：
 *
 *   1) Host 必须是回环或 RFC1918 字面 IP（域名形式一律拒绝）→ 挡住 DNS rebinding，
 *      同时不误伤通过局域网 IP / 手机访问的宿主页面；
 *   2) 带 Origin / Referer 时，其 host 必须与 Host 一致（同源）；
 *   3) POST/PUT/PATCH/DELETE 必须带 Origin（浏览器同源写一定带；缺失多为脚本直连），
 *      且 Sec-Fetch-Site 为 cross-site 时拒绝。
 *
 * 用法：在 handler 开头调用 guardHost(req)，返回 null = 放行，字符串 = 拒绝原因（回 403）。
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Host 头是否为回环或内网字面 IP（拒绝域名，防 DNS rebinding）。 */
export function isLocalHostHeader(hostHeader) {
  const raw = String(hostHeader || '').toLowerCase().trim()
  if (raw === '') return false
  // 去掉端口；IPv6 形如 [::1]:3080
  const hostOnly = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
  if (hostOnly === 'localhost' || hostOnly === '[::1]') return true
  const v4 = /^\d{1,3}(\.\d{1,3}){3}$/
  if (!v4.test(hostOnly)) return false
  const [a, b] = hostOnly.split('.').map(Number)
  if (a === 127) return true // 127.0.0.0/8 回环
  if (a === 10) return true // 10.0.0.0/8
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  return false
}

/** 返回 null = 通过；返回字符串 = 拒绝原因。 */
export function guardHost(req) {
  const host = String((req && req.headers && req.headers.host) || '')
  if (!isLocalHostHeader(host)) return '拒绝访问：只允许本机或局域网宿主访问'
  const hostFromUrl = (u) => {
    try { return new URL(String(u)).host } catch { return '' }
  }
  const origin = String((req.headers && req.headers.origin) || '')
  const referer = String((req.headers && (req.headers.referer || req.headers.referrer)) || '')
  const claimed = origin !== '' ? hostFromUrl(origin) : referer !== '' ? hostFromUrl(referer) : ''
  if (claimed !== '' && claimed !== host) return '跨源请求被拒绝'
  if (WRITE_METHODS.has(String(req.method || 'GET').toUpperCase()) && origin === '') {
    return '缺少 Origin：拒绝非浏览器写入'
  }
  const site = String((req.headers && req.headers['sec-fetch-site']) || '')
  if (site !== '' && site !== 'same-origin' && site !== 'none') return '跨站请求被拒绝'
  return null
}

/** 拒绝时写 403（各插件的 writeJson 签名不一，这里只依赖原生 res）。 */
export function denyJson(res, reason) {
  const body = JSON.stringify({ ok: false, error: reason })
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
