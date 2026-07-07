/**
 * gif-registry.mjs
 * Static registry of GOES-16 GIF categories and regions served by IDEAM.
 * GIF URL pattern: {base}/GIFS/{subfolder}/{REGION}_{canal}.gif
 */

export const BASE_URL = 'https://bart.ideam.gov.co/geotiff/goes16';

/** 3 animation categories */
export const CATEGORIES = {
  VISUAL: {
    label: 'Visual',
    subfolder: 'VISUAL',
    canal: 'C02',
    description: 'Canal 2 — reflectancia visible rojo (0.64 µm)',
  },
  INFRARROJO: {
    label: 'Infrarrojo',
    subfolder: 'INFRARROJO',
    canal: 'C13',
    description: 'Canal 13 — IR ventana limpia (10.3 µm)',
  },
  VAPOR_AGUA: {
    label: 'Vapor de agua',
    subfolder: 'VAPOR_AGUA',
    canal: 'C08',
    description: 'Canal 8 — vapor de agua nivel superior (6.19 µm)',
  },
};

/**
 * 23 regions.
 * hero:true marks the region shown by default in the hero section.
 * label is the display name shown in the UI (Spanish).
 */
export const REGIONS = [
  { id: 'AMAZONAS',    label: 'Amazonas' },
  { id: 'ANTIOQUIA',   label: 'Antioquia' },
  { id: 'ARAUCA',      label: 'Arauca' },
  { id: 'BARRANCABERMEJA', label: 'Barrancabermeja' },
  { id: 'BOGOTA',      label: 'Bogotá' },
  { id: 'BUCARAMANGA', label: 'Bucaramanga' },
  { id: 'CARIBE',      label: 'Caribe' },
  { id: 'CARIBE2',     label: 'Caribe 2' },
  { id: 'CARIBE_PCT',  label: 'Caribe PCT' },
  { id: 'CAUCA_MOCOA', label: 'Cauca — Mocoa' },
  { id: 'CHOCO',       label: 'Chocó' },
  { id: 'COLOMBIA',    label: 'Colombia completa', hero: true },
  { id: 'CORNARE',     label: 'Cornare' },
  { id: 'CRPA_05',     label: 'CRPA 05' },
  { id: 'CUCUTA',      label: 'Cúcuta' },
  { id: 'CUNDINAMARCA', label: 'Cundinamarca' },
  { id: 'DUITAMA',     label: 'Duitama' },
  { id: 'FULLDISK',    label: 'Disco completo' },
  { id: 'GUAVIARE',    label: 'Guaviare' },
  { id: 'IDIGER',      label: 'IDIGER' },
  { id: 'MITU',        label: 'Mitú' },
  { id: 'MOJANA',      label: 'La Mojana' },
  { id: 'SAN_ANDRES',  label: 'San Andrés y Providencia' },
];

/**
 * Build the absolute GIF URL for a given region and category.
 * @param {string} regionId  - region id from REGIONS (e.g. 'COLOMBIA')
 * @param {string} categoryKey - key from CATEGORIES (e.g. 'INFRARROJO')
 * @returns {string}
 */
export function gifUrl(regionId, categoryKey) {
  const cat = CATEGORIES[categoryKey];
  if (!cat) throw new Error(`Unknown category: ${categoryKey}`);
  return `${BASE_URL}/GIFS/${cat.subfolder}/${regionId}_${cat.canal}.gif`;
}
