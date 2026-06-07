import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { buildFfmpegPlan } from '../server/core/ffmpegBuilder'

describe('buildFfmpegPlan audio graph', () => {
  it('keeps trimmed audio clips in video exports and limits the final mix', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'audiosfx-test-'))
    try {
      const project: any = {
        id: 'test-project',
        duration: 4,
        aspectRatio: '9:16',
        timeline: {
          tracks: [
            {
              id: 'v1',
              type: 'video',
              name: 'Video',
              order: 0,
              muted: true,
              clips: [
                {
                  kind: 'video',
                  source: 'video.mp4',
                  start: 0,
                  end: 4,
                  sourceDuration: 4,
                },
              ],
            },
            {
              id: 'a1',
              type: 'audio',
              name: 'SFX',
              order: -1,
              volume: 2,
              clips: [
                {
                  kind: 'audio',
                  source: 'hit.wav',
                  start: 1.25,
                  end: 2.75,
                  trimStart: 0.4,
                  trimEnd: 1.9,
                  sourceDuration: 5,
                },
              ],
            },
          ],
        },
      }

      const plan = await buildFfmpegPlan(
        project,
        resolve('data/projects/test-project/assets'),
        '',
        '720p',
        tmpDir,
        false,
        30,
        false,
      )

      expect(plan.hasAudio).toBe(true)
      expect(plan.audioOutputLabel).toBe('amaster')
      expect(plan.filterComplex).toContain(
        '[1:a]atrim=start=0.4:end=1.9,asetpts=PTS-STARTPTS,volume=2,adelay=1250:all=1[aclip0]',
      )
      expect(plan.filterComplex).toContain(
        '[aclip0]alimiter=limit=0.89125:attack=5:release=100:level=disabled[amaster]',
      )
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
