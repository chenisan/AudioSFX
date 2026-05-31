// @ts-check
/**
 * Motion-prompt presets for WorkflowEditor → TextNode (nodeRole === 'motion').
 *
 * Mirror of imagePromptPresets.js but for the video / motion side: each preset
 * bundles a long-form motion template with named {{placeholders}} so the user
 * picks an action style and only tweaks the project-specific knobs (character,
 * mood, camera, art style). Pure client-side substitution — no API call.
 *
 * The workflow template「日漫動態」(workflowTemplates.js) pre-fills its text
 * node from the same preset so there is a single source of truth: editing the
 * template here updates both the dropdown and the prebuilt範本.
 *
 * Adding a preset = push into MOTION_PROMPT_PRESETS, no UI change required.
 *
 * @typedef {{ key: string, label: string, default: string }} MotionPlaceholder
 * @typedef {{
 *   id: string,
 *   label: string,
 *   description: string,
 *   placeholders: MotionPlaceholder[],
 *   template: string,
 * }} MotionPromptPreset
 */

/** @type {MotionPromptPreset[]} */
export const MOTION_PROMPT_PRESETS = [
  {
    id: 'anime-action',
    label: '日漫動態（武打 / 熱血爆裂）',
    description: '日漫 pose-to-pose 動作節奏＋強分鏡＋手繪式速度處理，反 generic AI smooth。15 秒一鏡到底，建議搭 Seedance。可調角色 / 熱血度 / 運鏡 / 畫風。',
    placeholders: [
      { key: 'character', label: '角色',   default: 'Wuhen Fist Wanderer, an East Asian male martial artist with a stylized 5.5-head anime proportion, compact low center of gravity, agile body, messy tied black hair, sharp eyes, dark indigo short robe, white inner shirt, loose martial pants, cloth waist tie, cloth shoes, and bare hands only, no gloves' },
      { key: 'mood',      label: '熱血度', default: 'extremely fast, powerful, fierce, explosive and hot-blooded, with no dead time and no hesitation' },
      { key: 'camera',    label: '運鏡',   default: 'continuous moving camera, aggressive one-take cinematography, rapid push-in, side tracking, whip-like orbit movement, low-angle follow, rising follow, downward dive, dynamic pull-back, always attached to the action' },
      { key: 'style',     label: '畫風',   default: 'Japanese anime action fused with expressive Chinese ink wash painting, bold brushstroke motion, heavy ink splashes, dry-brush textures, calligraphic speed arcs' },
    ],
    template:
      'Create a 15-second martial arts animation in a single continuous shot, one-take, unbroken camera movement, no cuts.\n\n' +
      'Main character: {{character}}.\n\n' +
      'Visual style: {{style}}, poetic but violent martial arts energy.\n\n' +
      'ANIME ACTION TIMING (most important): Use Japanese anime-style pose-to-pose action timing. Do not animate with overly smooth interpolation. Emphasize sharp readable key poses, sudden acceleration bursts, strong impact holds, dynamic silhouette clarity, smear-frame motion distortion, speed-line energy, and hand-drawn explosive action rhythm. The camera may move continuously, but the character motion must retain anime-style rhythmic impact rather than generic AI video smoothness.\n\n' +
      'Action choreography in one uninterrupted explosive flow:\n' +
      'The fighter launches directly into action almost immediately. After a split-second low stance setup, he bursts forward with violent acceleration using a low gliding martial step, while the camera pushes in and tracks with him. He drives a brutal forward palm strike toward camera, then whips his whole body into a fast horizontal sweeping strike with a huge circular ink arc. Without pause, he drops low into a heavy sweeping leg attack close to the ground, then instantly rebounds upward into a fierce rising knee strike. Continuing the same momentum, he twists in midair and crashes downward with a crushing palm strike, sending out a burst of ink and dust. He then surges into one last overwhelming finishing technique, a powerful final strike delivered with maximum body torque and impact, before locking into a sharp finishing stance as the camera pulls slightly back and the ink trails, robe, ribbons, and hair continue to snap through the air.\n\n' +
      'Camera style: {{camera}}. The camera must feel attached to the action and remain in motion for the entire shot.\n\n' +
      'Emphasize explosive body torque, violent acceleration, strong impact beats, sharp changes of direction, aggressive momentum, powerful martial footwork, dynamic cloth whipping motion, hair motion, and bold ink-brush speed trails. Prioritize big readable poses and full-body action clarity.\n\n' +
      'The motion must feel {{mood}}.\n\n' +
      'Maintain the same character identity throughout the whole clip.\n' +
      'Prioritize strong silhouette readability, clear action posing, exaggerated force, speed, and impact, with smooth uninterrupted choreography.\n\n' +
      'Negative: no cuts, no gloves, no weapons, no armor, no stiff motion, no weak motion, no slow passive posing, no floating body mechanics, no generic AI video smoothness, no overly smooth interpolation, no photorealistic live-action style, no Hong Kong comic style, no chibi feeling.',
  },
]

/**
 * Substitute {{key}} in the preset template with values; missing keys fall
 * back to the placeholder default. Unknown markers are left untouched so
 * authoring mistakes are visible. Identical contract to imagePromptPresets'
 * applyPreset — kept local so the motion module stays self-contained.
 *
 * @param {MotionPromptPreset} preset
 * @param {Record<string, string>} [values]
 * @returns {string}
 */
export function applyMotionPreset(preset, values) {
  if (!preset?.template) return ''
  let out = preset.template
  for (const ph of preset.placeholders ?? []) {
    const v = values?.[ph.key] ?? ph.default ?? ''
    out = out.split(`{{${ph.key}}}`).join(v)
  }
  return out
}

/** @param {string} id @returns {MotionPromptPreset|null} */
export function getMotionPreset(id) {
  return MOTION_PROMPT_PRESETS.find(p => p.id === id) ?? null
}
