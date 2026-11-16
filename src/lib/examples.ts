/** Ready-made samples of every format Import reads, with where a player finds the real thing. */
export interface ImportExample {
  id: string;
  label: string;
  where: string;
  text: string;
}

export const IMPORT_EXAMPLES: ImportExample[] = [
  {
    id: 'leaderboard',
    label: 'Leaderboard / guide text',
    where:
      'On a Hexenzirkel leaderboard (or a KQM guide) select the rotation lines under the team — "1st rotation", "2nd onwards", "Rotation time" — copy them and paste here. Notes in between are ignored.',
    text: [
      '1st rotation: Odette EE > Yae EEE > Sucrose N1E > Mitya hECQC > Sucrose E > Mitya C',
      '2nd onwards: Odette EE > Sucrose E > Mitya hEC > Yae EEE > Sucrose N1E > Mitya CQC',
      'Counted over 4 rotations.',
      'Rotation time: 72 s',
    ].join('\n'),
  },
  {
    id: 'simple',
    label: 'One line',
    where: 'The shortest form: a name followed by its actions, characters separated by ">". You can also type it directly in the editor.',
    text: 'Raiden E > Xingqiu EQ > Bennett QE > Xiangling QE > Raiden Q N3C N3C N3C\nRotation time: 21 s',
  },
  {
    id: 'gcsim',
    label: 'gcsim config',
    where:
      'On gcsim.app open a simulation, go to the "Config" tab and copy it all. The team comes from the "char" lines; what is before the "while" loop is the first rotation, the loop body is the rotation that repeats.',
    text: [
      'raiden char lvl=90/90 cons=0 talent=9,9,9;',
      'xingqiu char lvl=90/90 cons=6 talent=9,9,9;',
      'bennett char lvl=90/90 cons=5 talent=9,9,9;',
      'xiangling char lvl=90/90 cons=6 talent=9,9,9;',
      'options iteration=1000 duration=90;',
      'active raiden;',
      'raiden skill;',
      'while 1 {',
      '  xingqiu skill, burst;',
      '  bennett burst, skill;',
      '  xiangling burst, skill;',
      '  raiden burst, attack:3, charge, attack:3, charge;',
      '}',
    ].join('\n'),
  },
  {
    id: 'go',
    label: 'Genshin Optimizer file',
    where:
      'Hexenzirkel\'s "⬇ Export rotation" button downloads a Genshin Optimizer target config (.json). Open that file here with "Open file…". It describes one character only, so pick who it is after importing.',
    text: JSON.stringify(
      {
        name: 'MDPS C0',
        description: 'hECQC C 3x[hEC CQC]',
        targets: [{ path: ['skill', 'holdDmg'], weight: 1, hitMode: 'avgHit', bonusStats: {} }],
      },
      null,
      2,
    ),
  },
];

/** The cheat sheet of the notation, shown wherever rotations are typed. */
export const NOTATION_HELP: [string, string][] = [
  ['E', 'skill (tap)'],
  ['hE', 'skill (hold)'],
  ['Q', 'burst'],
  ['N3', '3 normal attacks'],
  ['C', 'charged attack'],
  ['N2C', '2 attacks + charged'],
  ['D', 'dash'],
  ['J', 'jump'],
  ['P', 'plunge'],
  ['2x[…]', 'repeat'],
  ['>', 'next character'],
];
