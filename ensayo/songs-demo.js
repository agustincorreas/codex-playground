// songs-demo.js — temas de ejemplo. Son canciones tradicionales de dominio
// público o letras originales, para no meter letras con derechos en el repo.
// Los tiempos [m:ss] están calculados a partir del BPM (sirven con el metrónomo);
// con un backing de YouTube hay que ajustarlos desde "Sincronizar".
(function () {
  'use strict';

  // Genera tiempos por compás para armar cifrados de ejemplo sincronizados.
  function t(bar, bpm, beats = 4, offset = 0) {
    const sec = offset + (bar - 1) * beats * 60 / bpm;
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return `[${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}]`;
  }

  const risingSunBpm = 78; // 6/8 sentido en 2 → lo tratamos como 3/4 a 78
  const rs = (bar) => t(bar, risingSunBpm, 3);
  const houseOfTheRisingSun = {
    title: 'House of the Rising Sun',
    artist: 'Tradicional',
    key: 'Am',
    bpm: risingSunBpm,
    beats: 3,
    genre: 'Folk / Rock',
    notes: 'Arpegio clásico en 6/8. Buscá un backing sin guitarra o sin voz según tu instrumento.',
    chart: `{title: House of the Rising Sun}
{artist: Tradicional}
{key: Am}
{tempo: ${risingSunBpm}}
{time: 6/8}

[Intro]
${rs(1)} [Am] [C] [D] [F]
${rs(5)} [Am] [C] [E] [E]

[Verso 1]
${rs(9)} There [Am]is a [C]house in [D]New Or[F]leans
${rs(13)} They [Am]call the [C]Rising [E]Sun [E]
${rs(17)} And it's [Am]been the [C]ruin of [D]many a poor [F]boy
${rs(21)} And [Am]God, I [E]know I'm [Am]one [E]

[Verso 2]
${rs(25)} My [Am]mother [C]was a [D]tailor [F]
${rs(29)} She [Am]sewed my [C]new blue [E]jeans [E]
${rs(33)} My [Am]father [C]was a [D]gamblin' [F]man
${rs(37)} [Am]Down in [E]New Or[Am]leans [E]

[Solo]
${rs(41)} [Am] [C] [D] [F]
${rs(45)} [Am] [C] [E] [E]
${rs(49)} [Am] [C] [D] [F]
${rs(53)} [Am] [E] [Am] [E]

[Verso 3]
${rs(57)} Oh [Am]mother, [C]tell your [D]children [F]
${rs(61)} Not to [Am]do what [C]I have [E]done [E]
${rs(65)} Spend your [Am]lives in [C]sin and [D]misery [F]
${rs(69)} In the [Am]House of the [E]Rising [Am]Sun [E]

[Final]
${rs(73)} [Am] [C] [D] [F]
${rs(77)} [Am] [E] [Am]
`,
  };

  const bluesBpm = 92;
  const bl = (bar) => t(bar, bluesBpm, 4, 0);
  const bluesEnA = {
    title: 'Blues de ensayo en A',
    artist: 'Ensayo (original)',
    key: 'A',
    bpm: bluesBpm,
    beats: 4,
    genre: 'Blues',
    notes: 'Blues de 12 compases con letra original. Ideal para probar loop A-B sobre el solo.',
    chart: `{title: Blues de ensayo en A}
{artist: Ensayo}
{key: A}
{tempo: ${bluesBpm}}
{time: 4/4}

[Intro]
${bl(1)} [A7] [A7] [A7] [A7]

[Verso 1]
${bl(5)} [A7]Me levanté temprano, [A7]la banda no llegó
${bl(7)} [A7]Me levanté temprano, [A7]la banda no llegó
${bl(9)} [D7]Me levanté temprano, [D7]la banda no llegó
${bl(11)} [A7]Prendí la computadora [A7]y el ensayo empezó
${bl(13)} [E7]Doce compases, [D7]la base sonó
${bl(15)} [A7]Y la guitarra [E7]al fin entró

[Verso 2]
${bl(17)} [A7]No tengo baterista, [A7]tampoco bajista hoy
${bl(19)} [A7]No tengo baterista, [A7]tampoco bajista hoy
${bl(21)} [D7]No tengo baterista, [D7]tampoco bajista hoy
${bl(23)} [A7]Con el backing track [A7]igual me voy
${bl(25)} [E7]Ponele loop al solo, [D7]bajale el tempo un poco
${bl(27)} [A7]Que mañana tocamos [E7]y quiero sonar loco

[Solo]
${bl(29)} [A7] [A7] [A7] [A7]
${bl(33)} [D7] [D7] [A7] [A7]
${bl(37)} [E7] [D7] [A7] [E7]

[Verso 3]
${bl(41)} [A7]Sincronicé la letra, [A7]los acordes también
${bl(43)} [A7]Sincronicé la letra, [A7]los acordes también
${bl(45)} [D7]Sincronicé la letra, [D7]los acordes también
${bl(47)} [A7]Ahora el estribillo [A7]lo sé re bien
${bl(49)} [E7]Blues de ensayo, [D7]sos mi banda fiel
${bl(51)} [A7]Hasta que vuelvan [E7]los del cuartel

[Final]
${bl(53)} [A7] [A7] [D7] [D7]
${bl(57)} [A7] [E7] [A7]
`,
  };

  const saintsBpm = 120;
  const sa = (bar) => t(bar, saintsBpm, 4, 0);
  const saints = {
    title: 'When the Saints Go Marching In',
    artist: 'Tradicional',
    key: 'C',
    bpm: saintsBpm,
    beats: 4,
    genre: 'Jazz / Dixieland',
    notes: 'Tres acordes, tempo rápido. Buena para probar transposición y cambio de velocidad.',
    chart: `{title: When the Saints Go Marching In}
{artist: Tradicional}
{key: C}
{tempo: ${saintsBpm}}

[Intro]
${sa(1)} [C] [C] [G7] [C]

[Verso 1]
${sa(5)} Oh when the [C]saints go marching in
${sa(9)} Oh when the saints go marching [G7]in
${sa(13)} Oh Lord I [C]want to [C7]be in that [F]number
${sa(17)} When the [C]saints go [G7]marching [C]in

[Verso 2]
${sa(21)} And when the [C]sun refuse to shine
${sa(25)} And when the sun refuse to [G7]shine
${sa(29)} Oh Lord I [C]want to [C7]be in that [F]number
${sa(33)} When the [C]sun re[G7]fuse to [C]shine

[Solo]
${sa(37)} [C] [C] [C] [C]
${sa(41)} [C] [C] [G7] [G7]
${sa(45)} [C] [C7] [F] [F]
${sa(49)} [C] [G7] [C] [C]

[Verso 3]
${sa(53)} Oh when the [C]trumpet sounds its call
${sa(57)} Oh when the trumpet sounds its [G7]call
${sa(61)} Oh Lord I [C]want to [C7]be in that [F]number
${sa(65)} When the [C]trumpet [G7]sounds its [C]call
`,
  };

  window.DemoSongs = [houseOfTheRisingSun, bluesEnA, saints];
})();
