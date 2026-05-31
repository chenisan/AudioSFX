import { Section, Row, Unit, Mono, NumInput, KeyframeEditor } from './_widgets'

/**
 * Properties UI for an audio segment.
 *
 * Currently supports: source readout, volume slider, volumeKF (animated volume).
 * To add audio-specific keyframes (pan, pitch, …):
 *   1. extend AudioSegment in server/core/types.ts
 *   2. add a Section + KeyframeEditor here
 *   3. wire ffmpeg expression in renderer (audioEngine for preview parity)
 */
export default function AudioClipProperties({ clip, playheadTime, helpers }) {
  const { update } = helpers

  return (
    <>
      <Section title="來源">
        <Row label="檔案"><Mono>{clip.source}</Mono></Row>
      </Section>
      <Section title="音量">
        <Row label="音量">
          <NumInput value={clip.volume ?? 1} step={0.05} min={0} max={2} onChange={v => update({ volume: +v })} />
          <Unit>×</Unit>
        </Row>
      </Section>
      <Section title="音量關鍵幀">
        <KeyframeEditor
          keyframes={clip.volumeKF ?? []}
          clipStart={clip.start}
          clipEnd={clip.end}
          playheadTime={playheadTime}
          valueMin={0} valueMax={2} valueStep={0.05} valueLabel="音量"
          defaultValue={clip.volume ?? 1}
          onChange={kfs => update({ volumeKF: kfs })}
        />
      </Section>
    </>
  )
}
