// 零成本 Kling model_name 探針：送候選 model + 空 image，靠 error message
// 區分「model 不存在」vs「model 存在但 image 無效」。不會真生成、不扣 units。
// 跑法：npx tsx scripts/probe-kling.mts
import * as crypto from 'crypto'
import * as https from 'https'
import { getSecret } from '../server/utils/secretStore'

const ak = getSecret('kling_ak')
const sk = getSecret('kling_sk')
console.log('kling_ak present:', !!ak, '| kling_sk present:', !!sk)
if (!ak || !sk) {
  console.error('缺 Kling key（Settings → AI 服務 設定後再跑）')
  process.exit(1)
}

function makeJwt(ak: string, sk: string): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now     = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString('base64url')
  const data    = `${header}.${payload}`
  const sig     = crypto.createHmac('sha256', sk).update(data).digest('base64url')
  return `${data}.${sig}`
}

function post(path: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.klingai.com', path, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30_000,
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(d))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.write(body); req.end()
  })
}

const CANDIDATES = [
  // 對照組：故意亂打，預期 "model_name ... is invalid"（驗證校驗順序假設）
  'garbage-xyz', 'kling-v99', 'kling-v2-9',
  // 真實候選
  'kling-v2-5-turbo', 'kling-v2-6', 'kling-v2-6-master',
  'kling-v3', 'kling-v3-master', 'kling-v3-turbo',
]

async function main() {
  const token = makeJwt(ak!, sk!)
  console.log('\n=== image2video model_name 探針（空 image，零成本）===')
  for (const model of CANDIDATES) {
    const body = JSON.stringify({ model_name: model, image: '', prompt: 'test', duration: '5', mode: 'std' })
    try {
      const raw = await post('/v1/videos/image2video', body, token)
      let parsed: any
      try { parsed = JSON.parse(raw) } catch { parsed = { raw } }
      console.log(`\n[${model}] code=${parsed.code ?? '?'} message="${parsed.message ?? parsed.raw ?? ''}"`)
    } catch (e: any) {
      console.log(`\n[${model}] ERROR: ${e.message}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
