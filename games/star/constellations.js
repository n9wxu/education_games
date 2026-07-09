'use strict';
// A small bundled catalogue of famous constellations for Star Captain. Star
// positions are approximate, laid out in a normalized 0..1 sky box for the game
// (not survey-grade); names, magnitudes, and colours are public-domain astronomy
// facts. `color` is the star's true tint by spectral class — the renderer applies
// it gently, since star colour is subtle to the eye even on a dark night. `line`
// lists star indices to connect in order to trace the figure.
//
// Spectral tints: M red #ff9d5c · K orange #ffd2a1 · G/F pale gold #fbf4de ·
// A white #ffffff · B blue-white #cbdaff · O blue #b8ccff
module.exports = [
  {
    name: 'Orion', hint: 'The Hunter — look for the three belt stars in a row.',
    stars: [
      { name: 'Betelgeuse', x: 0.36, y: 0.24, mag: 0.5, color: '#ff9d5c' },
      { name: 'Bellatrix',  x: 0.62, y: 0.26, mag: 1.6, color: '#cbdaff' },
      { name: 'Alnitak',    x: 0.44, y: 0.50, mag: 1.7, color: '#b8ccff' },
      { name: 'Alnilam',    x: 0.50, y: 0.51, mag: 1.7, color: '#cbdaff' },
      { name: 'Mintaka',    x: 0.56, y: 0.52, mag: 2.2, color: '#b8ccff' },
      { name: 'Saiph',      x: 0.40, y: 0.78, mag: 2.1, color: '#cbdaff' },
      { name: 'Rigel',      x: 0.64, y: 0.80, mag: 0.1, color: '#cfe0ff' },
    ],
    line: [0, 2, 5, 6, 4, 1, 3, 2],
  },
  {
    name: 'Ursa Major', hint: 'The Great Bear — its brightest stars form the Big Dipper.',
    stars: [
      { name: 'Dubhe',   x: 0.24, y: 0.30, mag: 1.8, color: '#ffd2a1' },
      { name: 'Merak',   x: 0.24, y: 0.46, mag: 2.4, color: '#ffffff' },
      { name: 'Phecda',  x: 0.40, y: 0.50, mag: 2.4, color: '#ffffff' },
      { name: 'Megrez',  x: 0.44, y: 0.36, mag: 3.3, color: '#ffffff' },
      { name: 'Alioth',  x: 0.60, y: 0.34, mag: 1.8, color: '#ffffff' },
      { name: 'Mizar',   x: 0.74, y: 0.34, mag: 2.2, color: '#ffffff' },
      { name: 'Alkaid',  x: 0.86, y: 0.40, mag: 1.9, color: '#cbdaff' },
    ],
    line: [0, 1, 2, 3, 0, 3, 4, 5, 6],
  },
  {
    name: 'Cassiopeia', hint: 'A big "W" (or "M") of five bright stars.',
    stars: [
      { name: 'Segin',    x: 0.18, y: 0.42, mag: 3.4, color: '#cbdaff' },
      { name: 'Ruchbah',  x: 0.36, y: 0.30, mag: 2.7, color: '#ffffff' },
      { name: 'Gamma Cas',x: 0.52, y: 0.48, mag: 2.2, color: '#cbdaff' },
      { name: 'Schedar',  x: 0.68, y: 0.32, mag: 2.2, color: '#ffd2a1' },
      { name: 'Caph',     x: 0.84, y: 0.46, mag: 2.3, color: '#fbf4de' },
    ],
    line: [0, 1, 2, 3, 4],
  },
  {
    name: 'Cygnus', hint: 'The Swan — a big cross flying down the Milky Way.',
    stars: [
      { name: 'Deneb',    x: 0.50, y: 0.16, mag: 1.3, color: '#ffffff' },
      { name: 'Sadr',     x: 0.50, y: 0.44, mag: 2.2, color: '#fbf4de' },
      { name: 'Gienah',   x: 0.26, y: 0.50, mag: 2.5, color: '#ffd2a1' },
      { name: 'Delta Cyg',x: 0.74, y: 0.40, mag: 2.9, color: '#eef3ff' },
      { name: 'Albireo',  x: 0.50, y: 0.82, mag: 3.1, color: '#ffd08a' },
    ],
    line: [0, 1, 4, 1, 2, 1, 3],
  },
  {
    name: 'Leo', hint: 'The Lion — a backwards question mark (the Sickle) is his head.',
    stars: [
      { name: 'Regulus',    x: 0.30, y: 0.62, mag: 1.4, color: '#cbdaff' },
      { name: 'Eta Leonis', x: 0.34, y: 0.48, mag: 3.5, color: '#ffffff' },
      { name: 'Algieba',    x: 0.40, y: 0.38, mag: 2.0, color: '#ffd2a1' },
      { name: 'Zosma',      x: 0.66, y: 0.40, mag: 2.6, color: '#ffffff' },
      { name: 'Denebola',   x: 0.82, y: 0.46, mag: 2.1, color: '#ffffff' },
      { name: 'Chertan',    x: 0.62, y: 0.58, mag: 3.3, color: '#ffffff' },
    ],
    line: [0, 1, 2, 3, 4, 5, 0],
  },
  {
    name: 'Scorpius', hint: 'The Scorpion — a red heart (Antares) and a curling tail.',
    stars: [
      { name: 'Dschubba', x: 0.24, y: 0.24, mag: 2.3, color: '#cbdaff' },
      { name: 'Antares',  x: 0.36, y: 0.40, mag: 1.1, color: '#ff9d5c' },
      { name: 'Tau Sco',  x: 0.40, y: 0.54, mag: 2.8, color: '#cbdaff' },
      { name: 'Epsilon Sco', x: 0.52, y: 0.66, mag: 2.3, color: '#ffd2a1' },
      { name: 'Sargas',   x: 0.66, y: 0.74, mag: 1.9, color: '#fbf4de' },
      { name: 'Shaula',   x: 0.80, y: 0.66, mag: 1.6, color: '#cfe0ff' },
    ],
    line: [0, 1, 2, 3, 4, 5],
  },
];
