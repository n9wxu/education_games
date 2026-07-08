'use strict';
// A small bundled catalogue of famous constellations for Star Captain. Star
// positions are approximate, laid out in a normalized 0..1 sky box for the game
// (not survey-grade); names and shapes are public-domain astronomy facts. `line`
// lists star indices to connect in order to trace the figure.
module.exports = [
  {
    name: 'Orion', hint: 'The Hunter — look for the three belt stars in a row.',
    stars: [
      { name: 'Betelgeuse', x: 0.36, y: 0.24, mag: 0.5 },
      { name: 'Bellatrix',  x: 0.62, y: 0.26, mag: 1.6 },
      { name: 'Alnitak',    x: 0.44, y: 0.50, mag: 1.7 },
      { name: 'Alnilam',    x: 0.50, y: 0.51, mag: 1.7 },
      { name: 'Mintaka',    x: 0.56, y: 0.52, mag: 2.2 },
      { name: 'Saiph',      x: 0.40, y: 0.78, mag: 2.1 },
      { name: 'Rigel',      x: 0.64, y: 0.80, mag: 0.1 },
    ],
    line: [0, 2, 5, 6, 4, 1, 3, 2],
  },
  {
    name: 'Ursa Major', hint: 'The Great Bear — its brightest stars form the Big Dipper.',
    stars: [
      { name: 'Dubhe',   x: 0.24, y: 0.30, mag: 1.8 },
      { name: 'Merak',   x: 0.24, y: 0.46, mag: 2.4 },
      { name: 'Phecda',  x: 0.40, y: 0.50, mag: 2.4 },
      { name: 'Megrez',  x: 0.44, y: 0.36, mag: 3.3 },
      { name: 'Alioth',  x: 0.60, y: 0.34, mag: 1.8 },
      { name: 'Mizar',   x: 0.74, y: 0.34, mag: 2.2 },
      { name: 'Alkaid',  x: 0.86, y: 0.40, mag: 1.9 },
    ],
    line: [0, 1, 2, 3, 0, 3, 4, 5, 6],
  },
  {
    name: 'Cassiopeia', hint: 'A big "W" (or "M") of five bright stars.',
    stars: [
      { name: 'Segin',    x: 0.18, y: 0.42, mag: 3.4 },
      { name: 'Ruchbah',  x: 0.36, y: 0.30, mag: 2.7 },
      { name: 'Gamma Cas',x: 0.52, y: 0.48, mag: 2.2 },
      { name: 'Schedar',  x: 0.68, y: 0.32, mag: 2.2 },
      { name: 'Caph',     x: 0.84, y: 0.46, mag: 2.3 },
    ],
    line: [0, 1, 2, 3, 4],
  },
  {
    name: 'Cygnus', hint: 'The Swan — a big cross flying down the Milky Way.',
    stars: [
      { name: 'Deneb',    x: 0.50, y: 0.16, mag: 1.3 },
      { name: 'Sadr',     x: 0.50, y: 0.44, mag: 2.2 },
      { name: 'Gienah',   x: 0.26, y: 0.50, mag: 2.5 },
      { name: 'Delta Cyg',x: 0.74, y: 0.40, mag: 2.9 },
      { name: 'Albireo',  x: 0.50, y: 0.82, mag: 3.1 },
    ],
    line: [0, 1, 4, 1, 2, 1, 3],
  },
  {
    name: 'Leo', hint: 'The Lion — a backwards question mark (the Sickle) is his head.',
    stars: [
      { name: 'Regulus',    x: 0.30, y: 0.62, mag: 1.4 },
      { name: 'Eta Leonis', x: 0.34, y: 0.48, mag: 3.5 },
      { name: 'Algieba',    x: 0.40, y: 0.38, mag: 2.0 },
      { name: 'Zosma',      x: 0.66, y: 0.40, mag: 2.6 },
      { name: 'Denebola',   x: 0.82, y: 0.46, mag: 2.1 },
      { name: 'Chertan',    x: 0.62, y: 0.58, mag: 3.3 },
    ],
    line: [0, 1, 2, 3, 4, 5, 0],
  },
  {
    name: 'Scorpius', hint: 'The Scorpion — a red heart (Antares) and a curling tail.',
    stars: [
      { name: 'Dschubba', x: 0.24, y: 0.24, mag: 2.3 },
      { name: 'Antares',  x: 0.36, y: 0.40, mag: 1.1 },
      { name: 'Tau Sco',  x: 0.40, y: 0.54, mag: 2.8 },
      { name: 'Epsilon Sco', x: 0.52, y: 0.66, mag: 2.3 },
      { name: 'Sargas',   x: 0.66, y: 0.74, mag: 1.9 },
      { name: 'Shaula',   x: 0.80, y: 0.66, mag: 1.6 },
    ],
    line: [0, 1, 2, 3, 4, 5],
  },
];
