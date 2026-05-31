// Mirrored from server/ai/cameraPresets.ts — keep in sync if presets change.
// Vite import-from-server path was avoided to keep frontend TypeScript-free.

export const DOP_DIMENSIONS = [
  { id: 'lens',         nameZh: '鏡頭運動', nameEn: 'Lens',           selection: 'single' },
  { id: 'shot_type',    nameZh: '構圖',     nameEn: 'Shot Type',      selection: 'single' },
  { id: 'light_shadow', nameZh: '光影',     nameEn: 'Light & Shadow', selection: 'multi'  },
]

export const DOP_CATEGORIES = {
  lens: [
    { id: 'push-pull', nameZh: '推拉' },
    { id: 'rotation',  nameZh: '旋轉' },
    { id: 'vertical',  nameZh: '高低' },
    { id: 'special',   nameZh: '特殊' },
    { id: 'action',    nameZh: '動作' },
    { id: 'pan-track', nameZh: '平移軌跡' },
    { id: 'static',    nameZh: '靜態' },
  ],
  shot_type: [
    { id: 'distance', nameZh: '距離' },
    { id: 'angle',    nameZh: '角度' },
    { id: 'depth',    nameZh: '景深' },
    { id: 'vantage',  nameZh: '視點' },
  ],
  light_shadow: [
    { id: 'natural',     nameZh: '自然光' },
    { id: 'quality',     nameZh: '光質' },
    { id: 'direction',   nameZh: '方向' },
    { id: 'temperature', nameZh: '色溫' },
    { id: 'artificial',  nameZh: '人造光' },
  ],
}

const LENS = [
  { id: 'dolly_in',    cat: 'push-pull', zh: '推進',         en: 'Dolly In',                desc: '攝影機沿軌道往被攝體推進，拉近距離與情感連結' },
  { id: 'dolly_out',   cat: 'push-pull', zh: '拉遠',         en: 'Dolly Out',               desc: '攝影機後退，揭示更廣場景' },
  { id: 'push_fast',   cat: 'push-pull', zh: '快速推進',     en: 'Whip Push',               desc: '快速猛推，戲劇性強調' },
  { id: 'pull_reveal', cat: 'push-pull', zh: '拉遠揭示',     en: 'Pull Reveal',             desc: '緩慢拉遠，逐漸揭示新內容' },
  { id: 'zoom_in',     cat: 'push-pull', zh: '變焦推',       en: 'Zoom In',                 desc: '不移動相機，鏡頭焦距拉近（壓縮空間感）' },
  { id: 'zoom_out',    cat: 'push-pull', zh: '變焦拉',       en: 'Zoom Out',                desc: '焦距拉遠，視野變寬' },

  { id: 'orbit_cw',    cat: 'rotation',  zh: '順時針環繞',   en: 'Orbit Clockwise',         desc: '攝影機圍繞被攝體順時針 360°' },
  { id: 'orbit_ccw',   cat: 'rotation',  zh: '逆時針環繞',   en: 'Orbit Counter-clockwise', desc: '反方向環繞' },
  { id: 'half_orbit',  cat: 'rotation',  zh: '半圓環繞',     en: 'Half Orbit',              desc: '180° 繞過，從正面到背面' },
  { id: 'bullet_time', cat: 'rotation',  zh: '子彈時間',     en: 'Bullet Time',             desc: '主體凍結，攝影機高速繞行' },
  { id: 'dutch_tilt',  cat: 'rotation',  zh: '傾斜構圖',     en: 'Dutch Tilt',              desc: '攝影機沿光軸傾斜，營造不安' },
  { id: 'spiral_in',   cat: 'rotation',  zh: '螺旋推',       en: 'Spiral In',               desc: '邊環繞邊推進' },
  { id: 'vortex',      cat: 'rotation',  zh: '渦旋',         en: 'Vortex',                  desc: '混亂旋轉、迷幻效果' },
  { id: 'roll',        cat: 'rotation',  zh: '翻轉',         en: 'Camera Roll',             desc: '沿光軸翻滾 360°' },

  { id: 'crane_up',    cat: 'vertical',  zh: '升降推進',     en: 'Crane Up',                desc: '攝影機從低處升到高處' },
  { id: 'crane_down',  cat: 'vertical',  zh: '升降下降',     en: 'Crane Down',              desc: '從高到低' },
  { id: 'birds_eye',   cat: 'vertical',  zh: '鳥瞰',         en: "Bird's Eye View",         desc: '完全垂直俯視' },
  { id: 'worms_eye',   cat: 'vertical',  zh: '蟲視',         en: "Worm's Eye View",         desc: '從地面仰望' },
  { id: 'boom_drop',   cat: 'vertical',  zh: '墜落',         en: 'Boom Drop',               desc: '從高速降下' },

  { id: 'pov',          cat: 'special',  zh: '第一人稱',     en: 'POV',                     desc: '主體視角' },
  { id: 'follow_third', cat: 'special',  zh: '第三人稱跟拍', en: 'Third Person Follow',     desc: '跟在主體後方' },
  { id: 'handheld',     cat: 'special',  zh: '手持',         en: 'Handheld',                desc: '自然搖晃' },
  { id: 'floating',     cat: 'special',  zh: '漂浮',         en: 'Floating',                desc: '緩慢無重力感' },
  { id: 'aerial_drone', cat: 'special',  zh: '空拍',         en: 'Aerial Drone',            desc: '高空無人機視角' },

  { id: 'sprint_chase', cat: 'action',   zh: '衝刺追逐',     en: 'Sprint Chase',            desc: '快速跟拍奔跑' },
  { id: 'whip_pan',     cat: 'action',   zh: '急甩鏡',       en: 'Whip Pan',                desc: '快速搖鏡到底，常用於轉場' },
  { id: 'impact_hit',   cat: 'action',   zh: '衝擊定格',     en: 'Impact Hit',              desc: '猛力定格' },

  { id: 'pan_left',     cat: 'pan-track',zh: '左搖鏡',       en: 'Pan Left',                desc: '攝影機原地往左轉' },
  { id: 'pan_right',    cat: 'pan-track',zh: '右搖鏡',       en: 'Pan Right',               desc: '原地往右轉' },
  { id: 'tilt_up',      cat: 'pan-track',zh: '仰拍',         en: 'Tilt Up',                 desc: '攝影機原地往上抬' },
  { id: 'tilt_down',    cat: 'pan-track',zh: '俯拍',         en: 'Tilt Down',               desc: '原地往下' },
  { id: 'truck_left',   cat: 'pan-track',zh: '左側移',       en: 'Truck Left',              desc: '側方平移跟隨' },
  { id: 'truck_right',  cat: 'pan-track',zh: '右側移',       en: 'Truck Right',             desc: '同上反向' },

  { id: 'locked_off',       cat: 'static', zh: '固定鏡頭', en: 'Locked Off',         desc: '完全靜止' },
  { id: 'subtle_breathing', cat: 'static', zh: '微呼吸',   en: 'Subtle Breathing',   desc: '極輕微搖晃模擬呼吸感' },
  { id: 'micro_shake',      cat: 'static', zh: '微抖動',   en: 'Micro Shake',        desc: '極小抖動，紀實感' },
]

const SHOT_TYPE = [
  { id: 'extreme_close_up',  cat: 'distance', zh: '大特寫',   en: 'Extreme Close-up',         desc: '比特寫更近（眼睛、嘴）' },
  { id: 'close_up',          cat: 'distance', zh: '特寫',     en: 'Close-up',                 desc: '主體填滿畫面（臉、物件）' },
  { id: 'medium_close_up',   cat: 'distance', zh: '中近景',   en: 'Medium Close-up',          desc: '胸部以上' },
  { id: 'medium_shot',       cat: 'distance', zh: '中景',     en: 'Medium Shot',              desc: '半身（腰部以上）' },
  { id: 'long_shot',         cat: 'distance', zh: '遠景',     en: 'Long Shot',                desc: '全身完整入鏡' },
  { id: 'extreme_long_shot', cat: 'distance', zh: '大遠景',   en: 'Extreme Long Shot',        desc: '主體渺小，環境為主' },

  { id: 'low_angle',         cat: 'angle',    zh: '仰角',     en: 'Low Angle',                desc: '從下往上拍，主體顯得高大' },
  { id: 'high_angle',        cat: 'angle',    zh: '俯角',     en: 'High Angle',               desc: '從上往下拍，主體渺小' },
  { id: 'eye_level',         cat: 'angle',    zh: '平視',     en: 'Eye Level',                desc: '平視角，中性' },
  { id: 'over_shoulder',     cat: 'angle',    zh: '過肩',     en: 'Over the Shoulder',        desc: '從一個角色肩後拍對方' },
  { id: 'profile',           cat: 'angle',    zh: '側面',     en: 'Profile Shot',             desc: '完全側面' },
  { id: 'front_view',        cat: 'angle',    zh: '正面',     en: 'Front View',               desc: '正面對鏡' },

  { id: 'shallow_dof',       cat: 'depth',    zh: '淺景深',   en: 'Shallow Depth of Field',   desc: '主體清楚、背景模糊' },
  { id: 'deep_focus',        cat: 'depth',    zh: '深景深',   en: 'Deep Focus',               desc: '全景皆清楚' },

  { id: 'drone_view',        cat: 'vantage',  zh: '空拍視角', en: 'Drone Perspective',        desc: '高空無人機視角' },
]

const LIGHT_SHADOW = [
  { id: 'sunlight',     cat: 'natural',     zh: '陽光',       en: 'Sunlight',           desc: '晴天直射' },
  { id: 'golden_hour',  cat: 'natural',     zh: '黃金時刻',   en: 'Golden Hour',        desc: '日出後 / 日落前一小時' },
  { id: 'blue_hour',    cat: 'natural',     zh: '藍色時刻',   en: 'Blue Hour',          desc: '日落後黃昏，冷藍' },
  { id: 'overcast',     cat: 'natural',     zh: '陰天',       en: 'Overcast',           desc: '漫射均勻光' },
  { id: 'moonlight',    cat: 'natural',     zh: '月光',       en: 'Moonlight',          desc: '冷藍夜光' },

  { id: 'soft_light',   cat: 'quality',     zh: '柔光',       en: 'Soft Light',         desc: '漫射光，無強烈陰影' },
  { id: 'hard_light',   cat: 'quality',     zh: '硬光',       en: 'Hard Light',         desc: '強對比、銳利陰影' },
  { id: 'dramatic',     cat: 'quality',     zh: '戲劇打光',   en: 'Dramatic',           desc: '高對比、強情緒' },
  { id: 'low_key',      cat: 'quality',     zh: '低調光',     en: 'Low-key',            desc: '大面積陰影、少光源' },
  { id: 'high_key',     cat: 'quality',     zh: '高調光',     en: 'High-key',           desc: '明亮均勻、少陰影' },

  { id: 'backlit',       cat: 'direction',  zh: '逆光',       en: 'Backlit',            desc: '主體背後光源、剪影感' },
  { id: 'side_lighting', cat: 'direction',  zh: '側光',       en: 'Side Lighting',      desc: '從側邊打光' },
  { id: 'rim_light',     cat: 'direction',  zh: '輪廓光',     en: 'Rim Light',          desc: '邊緣描光' },
  { id: 'rembrandt',     cat: 'direction',  zh: '倫勃朗光',   en: 'Rembrandt',          desc: '經典三角光（45° 側上方）' },

  { id: 'warm_light',    cat: 'temperature',zh: '暖光',       en: 'Warm Light',         desc: '黃橙色調' },
  { id: 'cool_light',    cat: 'temperature',zh: '冷光',       en: 'Cool Light',         desc: '藍綠色調' },

  { id: 'neon_lighting', cat: 'artificial', zh: '霓虹光',     en: 'Neon Lighting',      desc: '多彩霓虹（夜店、賽博龐克）' },
  { id: 'candlelight',   cat: 'artificial', zh: '燭光',       en: 'Candlelight',        desc: '暖橘搖曳' },
]

// Inject dimension to each preset for easy filtering
export const DOP_PRESETS = [
  ...LENS.map(p => ({ ...p, dimension: 'lens' })),
  ...SHOT_TYPE.map(p => ({ ...p, dimension: 'shot_type' })),
  ...LIGHT_SHADOW.map(p => ({ ...p, dimension: 'light_shadow' })),
]

export const DOP_PRESET_BY_ID = Object.fromEntries(DOP_PRESETS.map(p => [p.id, p]))

export function getPresetsByDimension(dimension) {
  return DOP_PRESETS.filter(p => p.dimension === dimension)
}
