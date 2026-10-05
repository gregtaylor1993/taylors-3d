// Display text only. Entity IDs, source values and user names stay literal.
const en = {
  'entityChoice.missing': 'Missing entity', 'entityChoice.noState': 'No current state',
  'entityChoice.disabled': 'Disabled', 'entityChoice.hidden': 'Hidden',
  'entityChoice.config': 'config', 'entityChoice.diagnostic': 'diagnostic',
  'entityChoice.unavailable': 'Unavailable', 'entityChoice.outsideFilter': 'Outside current filter',
  'entityChoice.unknown': 'Unknown',
  'plan.empty': 'No rooms drawn yet. Open edit mode to draw rooms for your areas.',
};
const de = {
  'entityChoice.missing': 'Entität fehlt', 'entityChoice.noState': 'Kein aktueller Zustand',
  'entityChoice.disabled': 'Deaktiviert', 'entityChoice.hidden': 'Ausgeblendet',
  'entityChoice.config': 'Konfiguration', 'entityChoice.diagnostic': 'Diagnose',
  'entityChoice.unavailable': 'Nicht verfügbar', 'entityChoice.outsideFilter': 'Außerhalb des aktuellen Filters',
  'entityChoice.unknown': 'Unbekannt',
  'plan.empty': 'Noch keine Räume gezeichnet. Öffnen Sie den Bearbeitungsmodus, um Räume für Ihre Bereiche zu zeichnen.',
};
const fr = {
  'entityChoice.missing': 'Entité manquante', 'entityChoice.noState': 'Aucun état actuel',
  'entityChoice.disabled': 'Désactivée', 'entityChoice.hidden': 'Masquée',
  'entityChoice.config': 'Configuration', 'entityChoice.diagnostic': 'Diagnostic',
  'entityChoice.unavailable': 'Indisponible', 'entityChoice.outsideFilter': 'Hors du filtre actuel',
  'entityChoice.unknown': 'Inconnu',
  'plan.empty': 'Aucune pièce dessinée. Ouvrez le mode édition pour dessiner les pièces de vos zones.',
};
const es = {
  'entityChoice.missing': 'Falta la entidad', 'entityChoice.noState': 'Sin estado actual',
  'entityChoice.disabled': 'Desactivada', 'entityChoice.hidden': 'Oculta',
  'entityChoice.config': 'Configuración', 'entityChoice.diagnostic': 'Diagnóstico',
  'entityChoice.unavailable': 'No disponible', 'entityChoice.outsideFilter': 'Fuera del filtro actual',
  'entityChoice.unknown': 'Desconocido',
  'plan.empty': 'Todavía no hay habitaciones dibujadas. Abra el modo de edición para dibujar las habitaciones de sus áreas.',
};
export default Object.freeze(Object.fromEntries(Object.entries({ en, de, fr, es }).map(([language, messages]) => [language, Object.freeze(messages)])));
