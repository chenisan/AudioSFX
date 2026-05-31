// Converts stick-figure pose data (UV joint coords) into a semantic English description
// suitable for inclusion in an image-generation prompt.

function armDesc(shoulder, elbow, hand, side) {
  if (!shoulder || !hand) return null

  // Hand above shoulder → raised
  if (hand[1] < shoulder[1] - 0.06) {
    return hand[1] < 0.08
      ? `${side} arm fully raised overhead`
      : `${side} arm raised up`
  }

  // Hand crossed to opposite side (check before extended — crossing is more specific)
  const crossed =
    side === 'right'
      ? hand[0] < shoulder[0] - 0.08
      : hand[0] > shoulder[0] + 0.08
  if (crossed) return `${side} arm crossed over body`

  // Horizontal extension
  if (Math.abs(hand[0] - shoulder[0]) > 0.22) {
    return `${side} arm extended outward`
  }

  return null
}

const PRESET_DESC = {
  standing:         'standing upright',
  walking:          'walking, mid-stride',
  running:          'running at full speed',
  sitting:          'seated position',
  lying:            'lying horizontally',
  kneeling:         'kneeling on one knee',
  leaning:          'leaning to the side',
  jumping:          'jumping upward',
  falling:          'off-balance, falling',
  waving:           'waving one hand',
  pointing:         'pointing forward',
  'hands-up':       'both hands raised overhead',
  'arms-crossed':   'arms folded across chest',
  'holding-mic':    'holding a microphone',
  hugging:          'arms extended in embrace',
  dancing:          'dynamic dance pose',
  'fighting-stance':'combat stance, weight forward',
}

export function poseToText(pose) {
  if (!pose?.joints) return ''
  const j = pose.joints
  const parts = []

  parts.push(PRESET_DESC[pose.preset] ?? 'neutral pose')

  const rArm = armDesc(j.rightShoulder, j.rightElbow, j.rightHand, 'right')
  const lArm = armDesc(j.leftShoulder,  j.leftElbow,  j.leftHand,  'left')
  if (rArm) parts.push(rArm)
  if (lArm) parts.push(lArm)

  // Leg stride
  if (j.leftFoot && j.rightFoot) {
    const stride = Math.abs(j.leftFoot[0] - j.rightFoot[0])
    if (stride > 0.22)      parts.push('legs spread wide apart')
    else if (stride > 0.12) parts.push('legs in stride')
  }

  // Torso lean (neck vs pelvis horizontal offset)
  if (j.neck && j.pelvis) {
    const lean = j.neck[0] - j.pelvis[0]
    if (lean >  0.08) parts.push('torso leaning right')
    else if (lean < -0.08) parts.push('torso leaning left')
  }

  // Shoulder spread → camera facing
  if (j.leftShoulder && j.rightShoulder) {
    const spread = j.rightShoulder[0] - j.leftShoulder[0]
    if (spread < 0.06)      parts.push('body in profile (side view)')
    else if (spread > 0.22) parts.push('body facing camera directly')
    // roughly 3/4 view → omit
  }

  if (pose.mirrored) parts.push('horizontally mirrored')

  return parts.join(', ')
}
