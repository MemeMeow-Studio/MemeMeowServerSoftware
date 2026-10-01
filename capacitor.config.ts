// 安卓客户端加载网站，并只为当前网站提供 Capacitor 接口。
import type { CapacitorConfig } from '@capacitor/cli'
const { getProfile } = require('./src/profile.cjs')
const profile = getProfile(process.env.MEMEMEOW_CHANNEL ?? 'prod')

const serverUrl = process.env.MEMEMEOW_ANDROID_URL ?? profile.serverUrl
const parsedUrl = new URL(serverUrl)
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && isLocal)) {
  throw new Error('MEMEMEOW_ANDROID_URL 必须使用 HTTPS，本机回环地址允许 HTTP')
}
if (parsedUrl.username || parsedUrl.password) throw new Error('网站地址不能包含登录凭据')

const config: CapacitorConfig = {
  appId: profile.androidAppId,
  appName: profile.productName,
  webDir: 'mobile/www',
  server: {
    url: parsedUrl.origin,
    cleartext: parsedUrl.protocol === 'http:',
  },
  android: {
    path: process.env.MEMEMEOW_ANDROID_PATH ?? 'android',
    backgroundColor: '#ffffff',
    loggingBehavior: 'none',
  },
}

export default config
