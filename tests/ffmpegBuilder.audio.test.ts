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

  it('maps every SFX plugin type to its ffmpeg filter with default params', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'audiosfx-test-'))
    try {
      const project: any = {
        id: 'test-project',
        duration: 4,
        aspectRatio: '9:16',
        timeline: {
          tracks: [
            {
              id: 'a1',
              type: 'audio',
              name: 'SFX',
              order: 0,
              plugins: [
                { id: 'p1', type: 'delay', enabled: true, params: { time: 350, feedback: 35, mix: 30 } },
                { id: 'p2', type: 'distortion', enabled: true, params: { drive: 40, tone: 60, output: 0 } },
                { id: 'p3', type: 'filter', enabled: true, params: { mode: 'lowpass', freq: 1000, q: 0.7 } },
                { id: 'p4', type: 'tremolo', enabled: true, params: { rate: 5, depth: 50 } },
                { id: 'p5', type: 'chorus', enabled: true, params: { rate: 0.8, depth: 3, mix: 40 } },
                { id: 'p6', type: 'flanger', enabled: true, params: { rate: 0.5, depth: 2, feedback: 50, mix: 60 } },
                { id: 'p7', type: 'gate', enabled: true, params: { threshold: -40, ratio: 4, attack: 5, release: 100 } },
                { id: 'p8', type: 'pitch', enabled: true, params: { semitones: 12 } },
                { id: 'p9', type: 'pitch', enabled: true, params: { semitones: 0 } },  // no-op → no filter
              ],
              clips: [
                { kind: 'audio', source: 'hit.wav', start: 0, end: 4, sourceDuration: 4 },
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
        true,   // audioOnly — this project has no video track
        30,
        false,
      )

      const fc = plan.filterComplex
      // delay: feedback simulated as decaying aecho taps (0.3, 0.3·0.35, …)
      expect(fc).toContain('aecho=1:1:350|700|1050:0.300|0.105|0.037')
      // distortion: pre-gain 1+0.4·15 → clip → tone lowpass 800+0.6·15000 → out dB
      expect(fc).toContain('volume=7.000,asoftclip=type=atan,lowpass=f=9800,volume=0.0dB')
      expect(fc).toContain('lowpass=f=1000:width_type=q:w=0.70')
      expect(fc).toContain('tremolo=f=5.00:d=0.50')
      expect(fc).toContain('chorus=0.5:1:40:0.280:0.80:3.0')
      expect(fc).toContain('flanger=delay=1:depth=2.0:regen=50:width=60:speed=0.50')
      // gate: -40 dB → linear 0.01
      expect(fc).toContain('agate=threshold=0.01000:ratio=4.0:attack=5.0:release=100')
      // pitch +12 st: rate ×2 then atempo ×0.5 restores duration
      expect(fc).toContain('aresample=48000,asetrate=96000,aresample=48000,atempo=0.5000')
      // pitch 0 st emits nothing (only the one asetrate from p8)
      expect(fc.match(/asetrate/g)?.length).toBe(1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
