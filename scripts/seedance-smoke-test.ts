/**
 * Seedance integration smoke test — submits a real job to BytePlus, polls until
 * complete, downloads the resulting video. Exits with the actual error message
 * if anything blows up so we know whether base64 / model ID / auth are OK.
 *
 * Usage:  npx tsx scripts/seedance-smoke-test.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { getSecret } from '../server/utils/secretStore'
import { submitSeedanceJob, pollSeedanceJob, downloadVideo } from '../server/ai/videoGen'

async function main() {
  const apiKey = getSecret('seedance')
  if (!apiKey) {
    console.error('[FAIL] no seedance key in secretStore')
    process.exit(1)
  }
  console.log('[ok] api key loaded, len=', apiKey.length)

  const imagePath = path.resolve(
    'data/projects/f8c5a4cb-a2a9-4452-956c-6cdab4dd247b/assets/38-kitchen-orders-tablet.png'
  )
  const imageStats = fs.statSync(imagePath)
  console.log('[ok] image:', imagePath)
  console.log('     size:', (imageStats.size / 1024).toFixed(1), 'KB')

  const prompt = 'gentle camera push-in, subtle motion, cinematic'
  console.log('[..] submit (variant=fast, 720p, 9:16, 5s)…')

  let taskId: string
  try {
    taskId = await submitSeedanceJob(imagePath, prompt, apiKey, {
      variant:     'fast',     // cheaper for the test
      resolution:  '720p',
      ratio:       '9:16',
      duration:    5,
      seed:        42,         // Stage A: verify seed accepted
      cameraFixed: true,       // Stage A: verify camerafixed accepted
    })
  } catch (e: any) {
    console.error('[FAIL] submit:', e.message)
    process.exit(2)
  }
  console.log('[ok] submitted, taskId =', taskId)

  // Poll every 5s, max 5 minutes.
  const deadline = Date.now() + 5 * 60_000
  let lastStatus = ''
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000))
    let s
    try {
      s = await pollSeedanceJob(taskId, apiKey)
    } catch (e: any) {
      console.error('[FAIL] poll:', e.message)
      process.exit(3)
    }
    if (s.status !== lastStatus) {
      console.log(`[..] status: ${s.status}`)
      lastStatus = s.status
    }
    if (s.status === 'succeed') {
      console.log('[ok] complete')
      console.log('     video_url:', s.videoUrl)
      console.log('     completion_tokens:', s.completionTokens)
      if (!s.videoUrl) { console.error('[FAIL] no video_url'); process.exit(4) }
      const out = path.resolve(`data/_smoke-test/seedance_${taskId.slice(-10)}.mp4`)
      try {
        await downloadVideo(s.videoUrl, out)
      } catch (e: any) {
        console.error('[FAIL] download:', e.message)
        process.exit(5)
      }
      const stats = fs.statSync(out)
      console.log('[ok] saved to:', out)
      console.log('     size:', (stats.size / 1024 / 1024).toFixed(2), 'MB')
      console.log('[DONE] all good')
      return
    }
    if (s.status === 'failed') {
      console.error('[FAIL] job failed:', s.errorMessage)
      process.exit(6)
    }
  }
  console.error('[FAIL] timeout (5 min) without terminal status')
  process.exit(7)
}

main().catch(e => {
  console.error('[FAIL] unexpected:', e)
  process.exit(99)
})
