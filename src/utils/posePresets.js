// Mirrored from server/ai/presets.ts — keep in sync if presets change.
// Joint coords normalized 0-1 within figure box.

const PRESETS = {
  standing: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.36, 0.36], rightElbow: [0.64, 0.36],
      leftHand: [0.34, 0.52], rightHand: [0.66, 0.52],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  walking: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.32, 0.34], rightElbow: [0.68, 0.36],
      leftHand: [0.30, 0.50], rightHand: [0.74, 0.48],
      pelvis: [0.50, 0.55],
      leftKnee: [0.40, 0.72], rightKnee: [0.60, 0.74],
      leftFoot: [0.36, 0.96], rightFoot: [0.64, 0.92],
    },
    gaze: 'forward',
  },
  running: {
    joints: {
      head: [0.52, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.21], rightShoulder: [0.60, 0.21],
      leftElbow: [0.28, 0.30], rightElbow: [0.72, 0.30],
      leftHand: [0.24, 0.42], rightHand: [0.78, 0.42],
      pelvis: [0.50, 0.55],
      leftKnee: [0.34, 0.68], rightKnee: [0.66, 0.78],
      leftFoot: [0.28, 0.90], rightFoot: [0.74, 0.96],
    },
    gaze: 'forward',
  },
  sitting: {
    joints: {
      head: [0.50, 0.20], neck: [0.50, 0.30],
      leftShoulder: [0.40, 0.32], rightShoulder: [0.60, 0.32],
      leftElbow: [0.36, 0.46], rightElbow: [0.64, 0.46],
      leftHand: [0.36, 0.60], rightHand: [0.64, 0.60],
      pelvis: [0.50, 0.62],
      leftKnee: [0.36, 0.72], rightKnee: [0.64, 0.72],
      leftFoot: [0.30, 0.92], rightFoot: [0.70, 0.92],
    },
    gaze: 'forward',
  },
  lying: {
    joints: {
      head: [0.10, 0.60], neck: [0.20, 0.60],
      leftShoulder: [0.22, 0.55], rightShoulder: [0.22, 0.65],
      leftElbow: [0.34, 0.50], rightElbow: [0.34, 0.70],
      leftHand: [0.46, 0.48], rightHand: [0.46, 0.72],
      pelvis: [0.55, 0.60],
      leftKnee: [0.72, 0.55], rightKnee: [0.72, 0.65],
      leftFoot: [0.92, 0.55], rightFoot: [0.92, 0.65],
    },
    gaze: 'up',
  },
  kneeling: {
    joints: {
      head: [0.50, 0.18], neck: [0.50, 0.28],
      leftShoulder: [0.40, 0.30], rightShoulder: [0.60, 0.30],
      leftElbow: [0.36, 0.46], rightElbow: [0.64, 0.46],
      leftHand: [0.34, 0.62], rightHand: [0.66, 0.62],
      pelvis: [0.50, 0.65],
      leftKnee: [0.40, 0.84], rightKnee: [0.60, 0.84],
      leftFoot: [0.34, 0.96], rightFoot: [0.66, 0.96],
    },
    gaze: 'down',
  },
  leaning: {
    joints: {
      head: [0.42, 0.10], neck: [0.45, 0.20],
      leftShoulder: [0.36, 0.22], rightShoulder: [0.55, 0.20],
      leftElbow: [0.32, 0.38], rightElbow: [0.62, 0.34],
      leftHand: [0.30, 0.54], rightHand: [0.66, 0.50],
      pelvis: [0.50, 0.58],
      leftKnee: [0.46, 0.76], rightKnee: [0.56, 0.76],
      leftFoot: [0.44, 0.96], rightFoot: [0.58, 0.96],
    },
    gaze: 'left',
  },
  jumping: {
    joints: {
      head: [0.50, 0.06], neck: [0.50, 0.16],
      leftShoulder: [0.40, 0.18], rightShoulder: [0.60, 0.18],
      leftElbow: [0.30, 0.16], rightElbow: [0.70, 0.16],
      leftHand: [0.22, 0.06], rightHand: [0.78, 0.06],
      pelvis: [0.50, 0.50],
      leftKnee: [0.42, 0.62], rightKnee: [0.58, 0.62],
      leftFoot: [0.40, 0.78], rightFoot: [0.60, 0.78],
    },
    gaze: 'up',
  },
  falling: {
    joints: {
      head: [0.32, 0.20], neck: [0.40, 0.28],
      leftShoulder: [0.32, 0.34], rightShoulder: [0.50, 0.28],
      leftElbow: [0.18, 0.40], rightElbow: [0.66, 0.30],
      leftHand: [0.10, 0.52], rightHand: [0.80, 0.30],
      pelvis: [0.52, 0.55],
      leftKnee: [0.46, 0.70], rightKnee: [0.64, 0.74],
      leftFoot: [0.38, 0.88], rightFoot: [0.74, 0.94],
    },
    gaze: 'forward',
  },
  waving: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.36, 0.36], rightElbow: [0.74, 0.10],
      leftHand: [0.34, 0.52], rightHand: [0.86, 0.00],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  pointing: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.36, 0.36], rightElbow: [0.78, 0.28],
      leftHand: [0.34, 0.52], rightHand: [0.96, 0.32],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  'hands-up': {
    joints: {
      head: [0.50, 0.10], neck: [0.50, 0.20],
      leftShoulder: [0.40, 0.22], rightShoulder: [0.60, 0.22],
      leftElbow: [0.32, 0.10], rightElbow: [0.68, 0.10],
      leftHand: [0.28, 0.00], rightHand: [0.72, 0.00],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'up',
  },
  'arms-crossed': {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.34, 0.36], rightElbow: [0.66, 0.36],
      leftHand: [0.62, 0.32], rightHand: [0.38, 0.32],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  'holding-mic': {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.36, 0.36], rightElbow: [0.62, 0.30],
      leftHand: [0.34, 0.52], rightHand: [0.54, 0.16],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  hugging: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.34, 0.34], rightElbow: [0.66, 0.34],
      leftHand: [0.62, 0.40], rightHand: [0.38, 0.40],
      pelvis: [0.50, 0.55],
      leftKnee: [0.45, 0.74], rightKnee: [0.55, 0.74],
      leftFoot: [0.43, 0.96], rightFoot: [0.57, 0.96],
    },
    gaze: 'forward',
  },
  dancing: {
    joints: {
      head: [0.50, 0.08], neck: [0.50, 0.18],
      leftShoulder: [0.40, 0.20], rightShoulder: [0.60, 0.20],
      leftElbow: [0.24, 0.28], rightElbow: [0.76, 0.40],
      leftHand: [0.16, 0.18], rightHand: [0.84, 0.56],
      pelvis: [0.50, 0.56],
      leftKnee: [0.40, 0.74], rightKnee: [0.60, 0.74],
      leftFoot: [0.36, 0.96], rightFoot: [0.64, 0.96],
    },
    gaze: 'forward',
  },
  'fighting-stance': {
    joints: {
      head: [0.45, 0.10], neck: [0.45, 0.20],
      leftShoulder: [0.36, 0.22], rightShoulder: [0.55, 0.22],
      leftElbow: [0.32, 0.36], rightElbow: [0.62, 0.36],
      leftHand: [0.36, 0.50], rightHand: [0.58, 0.48],
      pelvis: [0.48, 0.58],
      leftKnee: [0.40, 0.74], rightKnee: [0.62, 0.74],
      leftFoot: [0.32, 0.96], rightFoot: [0.68, 0.96],
    },
    gaze: 'forward',
  },
}

export function buildDefaultPose(preset) {
  const found = PRESETS[preset] ?? PRESETS.standing
  const joints = {}
  for (const k of Object.keys(found.joints)) {
    joints[k] = [...found.joints[k]]
  }
  return {
    preset,
    position: [0.5, 0.5],
    scale: 1,
    rotation: 0,
    facing: 'front',
    mirrored: false,
    joints,
    gaze: found.gaze ?? 'forward',
  }
}

export const POSE_PRESETS = Object.keys(PRESETS)
