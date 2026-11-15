/**
 * Identidad del producto centralizada.
 *
 * El proyecto se presenta como una estrella vigilante que observa la Tierra: el producto
 * y la mascota comparten nombre. Cambia aquí `name`, `fullName` y `mascotName` y toda la
 * interfaz (título, intro, cabecera, metadatos, mensajes de la estrella) se actualiza.
 */
export const brand = {
  /** Nombre corto visible en la cabecera y en la intro. */
  name: 'Vigía',
  /** Nombre largo para títulos y metadatos. */
  fullName: 'Vigía · la estrella que observa la actividad térmica de la Tierra',
  /** Monograma para espacios reducidos. */
  shortMark: 'V',
  tagline: 'Una estrella vigilante para observar la actividad térmica del planeta',
  /** Subtítulo técnico (cabecera). */
  subtitle: 'MODIS + VIIRS armonizados · calendario histórico · pronóstico experimental',
  /** Nombre de la estrella guardiana (mascota). */
  mascotName: 'Vigía',
  event: 'NASA Space Apps Challenge 2026',
  challenge: 'Harmonization of MODIS and VIIRS Hot Spots',
  challengeUrl:
    'https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/',
  pilot: {
    regionId: 'chiquitania',
    label: 'Chiquitanía · Santa Cruz, Bolivia',
  },
} as const;

/** Alternativas con el mismo concepto (estrella / luna vigilante) por si se prefiere otra. */
export const nameProposals = ['Vigía', 'Astra Vigía', 'Lumen', 'Selene', 'Centinela', 'Atalaya'] as const;
