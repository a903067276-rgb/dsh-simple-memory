/**
 * 宿主身份校验（2026-11-19）。
 * 目标：接口只服务「本机 / 局域网宿主 UI」，挡住域名形式的 Host（DNS rebinding）
 * 与跨源读写；同时不误伤局域网/手机访问。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardHost, isLocalHostHeader } from '../lib/host-guard.js'

const req = (headers, method = 'GET') => ({ method, headers })

test('Host 判定：回环与内网字面 IP 通过，域名一律拒绝', () => {
  for (const h of ['127.0.0.1:3080', 'localhost:3080', '[::1]:3080', '192.168.1.5:3080', '10.0.0.7:3080', '172.20.3.4:3080']) {
    assert.equal(isLocalHostHeader(h), true, h)
  }
  for (const h of ['evil.com', 'evil.com:80', '192.168.1.5.evil.com:80', 'a.example', '', '8.8.8.8:80', '172.32.0.1:80']) {
    assert.equal(isLocalHostHeader(h), false, h)
  }
})

test('GET：本机同源 / 局域网访问通过', () => {
  assert.equal(guardHost(req({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), null)
  assert.equal(guardHost(req({ host: '192.168.1.5:3080' })), null)
})

test('GET：域名 Host（DNS rebinding）被拒', () => {
  assert.match(guardHost(req({ host: 'evil.com' })), /局域网|本机/)
})

test('GET：跨源 Origin / Referer 被拒', () => {
  assert.match(guardHost(req({ host: '127.0.0.1:3080', origin: 'https://evil.com' })), /跨源/)
  assert.match(guardHost(req({ host: '127.0.0.1:3080', referer: 'https://evil.com/x' })), /跨源/)
})

test('POST/PUT：缺 Origin 一律拒绝，同源带 Origin 通过', () => {
  for (const m of ['POST', 'PUT', 'DELETE']) {
    assert.match(guardHost(req({ host: '127.0.0.1:3080' }, m)), /Origin/, m)
  }
  assert.equal(guardHost(req({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, 'POST')), null)
})
