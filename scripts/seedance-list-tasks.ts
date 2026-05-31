/**
 * Lists recent Seedance tasks on BytePlus to diagnose stuck/slow jobs.
 *   npx tsx scripts/seedance-list-tasks.ts
 */
import * as https from 'https'
import { getSecret } from '../server/utils/secretStore'

const SEEDANCE_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3'

function get(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers, timeout: 30_000,
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

async function main() {
  const apiKey = getSecret('seedance')
  if (!apiKey) { console.error('no seedance key'); process.exit(1) }

  // Try common list-tasks paths
  const urls = [
    `${SEEDANCE_BASE}/contents/generations/tasks?page_size=20`,
    `${SEEDANCE_BASE}/contents/generations/tasks`,
  ]
  for (const url of urls) {
    console.log('GET', url)
    try {
      const raw = await get(url, { Authorization: `Bearer ${apiKey}` })
      const parsed = JSON.parse(raw)
      if (parsed.error) {
        console.log('  error:', parsed.error.message ?? parsed.error)
        continue
      }
      const tasks = parsed.data ?? parsed.tasks ?? parsed.items ?? []
      console.log(`  count: ${tasks.length}`)
      for (const t of tasks.slice(0, 10)) {
        const created = t.created_at ?? t.createdAt ?? t.created
        const ageSec = created ? Math.floor((Date.now() - new Date(created).getTime()) / 1000) : '?'
        console.log(`  ${t.id}  status=${t.status}  age=${ageSec}s  model=${t.model ?? '?'}`)
      }
      return
    } catch (e: any) {
      console.log('  failed:', e.message)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
