// 星座连线定义（星名来自 HYG 星表 proper 字段）
export interface ConstellationDef {
  name: string;
  lines: [string, string][];
}

export const CONSTELLATIONS: ConstellationDef[] = [
  {
    name: '猎户座',
    lines: [
      ['Betelgeuse', 'Alnitak'], ['Betelgeuse', 'Bellatrix'],
      ['Bellatrix', 'Mintaka'], ['Mintaka', 'Alnilam'], ['Alnilam', 'Alnitak'],
      ['Alnitak', 'Saiph'], ['Mintaka', 'Rigel'], ['Rigel', 'Saiph'],
    ],
  },
  {
    name: '大熊座 · 北斗七星',
    lines: [
      ['Dubhe', 'Merak'], ['Merak', 'Phecda'], ['Phecda', 'Megrez'],
      ['Megrez', 'Dubhe'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'], ['Mizar', 'Alkaid'],
    ],
  },
  {
    name: '仙后座',
    lines: [
      ['Caph', 'Schedar'], ['Schedar', 'Cih'], ['Cih', 'Ruchbah'], ['Ruchbah', 'Segin'],
    ],
  },
  {
    name: '大犬座',
    lines: [
      ['Mirzam', 'Sirius'], ['Sirius', 'Wezen'], ['Wezen', 'Adhara'], ['Wezen', 'Aludra'],
    ],
  },
  {
    name: '天琴座',
    lines: [
      ['Vega', 'Zosma'], ['Zosma', 'Sheliak'], ['Sheliak', 'Sulafat'], ['Sulafat', 'Vega'],
    ],
  },
];
