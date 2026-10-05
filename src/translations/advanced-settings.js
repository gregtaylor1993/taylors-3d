// Audited static editor captions only. Input values, HA/GLB names, diagnostics
// and selected missing references are intentionally outside this registry.
const entries = [];
const add = (scope, id, selector, kind, en, de, fr, es) => entries.push({ scope,
  key: `advanced.${scope}.${id}`, selector, kind, translations: { en, de, fr, es } });
const field = (scope, id, prefix, control, ...words) => add(scope, id, `[data-field="${prefix}-${control}"]`, 'label', ...words);
const action = (scope, id, prefix, control, ...words) => add(scope, id, `[data-act="${prefix}-${control}"]`, 'text', ...words);
const choice = (scope, id, prefix, control, value, ...words) => add(scope, id,
  `[data-field="${prefix}-${control}"] option[value="${value}"]`, 'text', ...words);
const heading = (scope, id, selector, ...words) => add(scope, id, selector, 'text', ...words);

for (const [scope, prefix] of [['security', 'sec'], ['tracking', 'trk'], ['camera', 'cov']]) {
  action(scope, 'save', prefix, 'save', 'Save', 'Speichern', 'Enregistrer', 'Guardar');
  action(scope, 'cancel', prefix, 'cancel', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
  if (scope !== 'camera') {
    action(scope, 'edit', prefix, 'edit', 'Edit', 'Bearbeiten', 'Modifier', 'Editar');
    for (const control of ['clear', 'clear-draft']) action(scope, `clear.${control}`, prefix, control,
      'Clear saved binding', 'Gespeicherte Zuordnung entfernen', 'Supprimer le lien enregistré', 'Eliminar vínculo guardado');
  }
  const control = scope === 'security' ? 'picker-area' : 'area-filter';
  choice(scope, 'areas.all', prefix, control, 'all', 'All areas', 'Alle Bereiche', 'Toutes les zones', 'Todas las áreas');
  choice(scope, 'areas.unassigned', prefix, control, 'unassigned', 'Unassigned', 'Nicht zugeordnet', 'Non attribué', 'Sin asignar');
}

heading('security', 'title', 'h3', 'Door, window and lock security', 'Sicherheit für Türen, Fenster und Schlösser', 'Sécurité des portes, fenêtres et serrures', 'Seguridad de puertas, ventanas y cerraduras');
heading('security', 'draftCheck', 'h4', 'Read-only draft check', 'Entwurf schreibgeschützt prüfen', 'Vérification du brouillon en lecture seule', 'Comprobación del borrador de solo lectura');
heading('security', 'newBinding', 'legend', 'New security binding', 'Neue Sicherheitszuordnung', 'Nouveau lien de sécurité', 'Nuevo vínculo de seguridad');
heading('security', 'editBinding', 'legend', 'Edit security binding', 'Sicherheitszuordnung bearbeiten', 'Modifier le lien de sécurité', 'Editar vínculo de seguridad');
heading('security', 'highlight', 'legend', 'Security highlight', 'Sicherheitshervorhebung', 'Surbrillance de sécurité', 'Resaltado de seguridad');
heading('security', 'hinge', 'legend', 'Explicit hinge', 'Ausdrücklich festgelegtes Scharnier', 'Charnière définie explicitement', 'Bisagra definida explícitamente');
heading('security', 'plan', 'legend', 'Explicit plan location', 'Ausdrücklich festgelegte Planposition', 'Position du plan définie explicitement', 'Posición del plano definida explícitamente');
heading('security', 'age', 'legend', 'Source reading age', 'Alter des Quellenwerts', 'Ancienneté de la valeur source', 'Antigüedad de la lectura de origen');
action('security', 'add', 'sec', 'add', 'Add security binding', 'Sicherheitszuordnung hinzufügen', 'Ajouter un lien de sécurité', 'Añadir vínculo de seguridad');
action('security', 'clearMalformed', 'sec', 'clear-all', 'Clear malformed security settings', 'Fehlerhafte Sicherheitseinstellungen entfernen', 'Supprimer les paramètres de sécurité mal formés', 'Eliminar ajustes de seguridad mal formados');
action('security', 'repair', 'sec', 'repair', 'Repair links deliberately', 'Verknüpfungen gezielt reparieren', 'Réparer les liens explicitement', 'Reparar vínculos explícitamente');
action('security', 'contactPreset', 'sec', 'contact-preset', 'Use HA contact states: on = open, off = closed', 'HA-Kontaktzustände verwenden: on = offen, off = geschlossen', 'Utiliser les états HA : on = ouvert, off = fermé', 'Usar estados HA: on = abierto, off = cerrado');
const securityFields = [
  ['label', 'Label', 'Beschriftung', 'Libellé', 'Etiqueta'],
  ['enabled', 'Enable security highlight and configured motion', 'Sicherheitshervorhebung und konfigurierte Bewegung aktivieren', 'Activer la surbrillance et le mouvement configuré', 'Activar resaltado y movimiento configurado'],
  ['kind', 'Security kind', 'Sicherheitsart', 'Type de sécurité', 'Tipo de seguridad'],
  ['picker-area', 'Filter source choices by area', 'Quellen nach Bereich filtern', 'Filtrer les sources par zone', 'Filtrar fuentes por área'],
  ['confirmed', 'I confirm this unclassified binary sensor is a real opening contact', 'Dieser unklassifizierte Binärsensor ist tatsächlich ein Öffnungskontakt', 'Je confirme que ce capteur binaire non classé est un vrai contact d’ouverture', 'Confirmo que este sensor binario sin clasificar es un contacto de apertura real'],
  ['target-type', 'Security target', 'Sicherheitsziel', 'Cible de sécurité', 'Destino de seguridad'],
  ['object', 'Tagged model object', 'Markiertes Modellobjekt', 'Objet du modèle étiqueté', 'Objeto del modelo etiquetado'],
  ['open-states', 'Exact open states, separated by commas', 'Exakte Offen-Zustände, durch Kommas getrennt', 'États ouverts exacts, séparés par des virgules', 'Estados abiertos exactos, separados por comas'],
  ['closed-states', 'Exact closed states, separated by commas', 'Exakte Geschlossen-Zustände, durch Kommas getrennt', 'États fermés exacts, séparés par des virgules', 'Estados cerrados exactos, separados por comas'],
  ['open-color', 'Open/unlocked colour (#rrggbb)', 'Farbe für offen/entriegelt (#rrggbb)', 'Couleur ouvert/déverrouillé (#rrggbb)', 'Color abierto/desbloqueado (#rrggbb)'],
  ['unknown-color', 'Unknown colour (#rrggbb)', 'Farbe für unbekannt (#rrggbb)', 'Couleur inconnue (#rrggbb)', 'Color desconocido (#rrggbb)'],
  ['show-closed', 'Also highlight a closed/locked source', 'Auch geschlossene/verriegelte Quelle hervorheben', 'Mettre aussi en évidence une source fermée/verrouillée', 'Resaltar también una fuente cerrada/bloqueada'],
  ['closed-color', 'Closed/locked colour (#rrggbb)', 'Farbe für geschlossen/verriegelt (#rrggbb)', 'Couleur fermé/verrouillé (#rrggbb)', 'Color cerrado/bloqueado (#rrggbb)'],
  ['opacity', 'Highlight opacity, 0 to 1', 'Deckkraft der Hervorhebung, 0 bis 1', 'Opacité de la surbrillance, de 0 à 1', 'Opacidad del resaltado, de 0 a 1'],
  ['motion', 'Animate an explicitly configured rigid moving part', 'Ein ausdrücklich konfiguriertes starres Teil animieren', 'Animer une pièce rigide configurée explicitement', 'Animar una pieza rígida configurada explícitamente'],
  ['target', 'Exact moving part', 'Exaktes bewegliches Teil', 'Pièce mobile exacte', 'Pieza móvil exacta'],
  ['closed-degrees', 'Closed offset, degrees', 'Versatz für geschlossen, Grad', 'Décalage fermé, degrés', 'Desplazamiento cerrado, grados'],
  ['open-degrees', 'Open offset, degrees', 'Versatz für offen, Grad', 'Décalage ouvert, degrés', 'Desplazamiento abierto, grados'],
  ['duration', 'Motion duration, milliseconds (0 = snap)', 'Bewegungsdauer, Millisekunden (0 = sofort)', 'Durée du mouvement, millisecondes (0 = immédiat)', 'Duración del movimiento, milisegundos (0 = inmediato)'],
  ['plan-source', 'Place the indicator using', 'Indikator platzieren anhand von', 'Placer l’indicateur à partir de', 'Colocar el indicador mediante'],
  ['plan-room', 'Exact room', 'Exakter Raum', 'Pièce exacte', 'Habitación exacta'],
  ['plan-room-z', 'Height above room floor, metres', 'Höhe über dem Raumboden, Meter', 'Hauteur au-dessus du sol de la pièce, mètres', 'Altura sobre el suelo de la habitación, metros'],
  ['plan-anchor', 'Exact marker anchor', 'Exakter Markierungsanker', 'Ancrage exact du marqueur', 'Anclaje exacto del marcador'],
  ['plan-floor-constraint', 'Optional exact source floor constraint', 'Optionale Einschränkung auf die exakte Quell-Etage', 'Contrainte facultative sur l’étage source exact', 'Restricción opcional a la planta de origen exacta'],
  ['plan-floor', 'Exact source floor', 'Exakte Quell-Etage', 'Étage source exact', 'Planta de origen exacta'],
  ['plan-x', 'X metres east', 'X Meter nach Osten', 'X mètres vers l’est', 'X metros al este'],
  ['plan-y', 'Y metres north', 'Y Meter nach Norden', 'Y mètres vers le nord', 'Y metros al norte'],
  ['plan-z', 'Z metres above floor', 'Z Meter über dem Boden', 'Z mètres au-dessus du sol', 'Z metros sobre el suelo'],
  ['freshness-mode', 'Reading age policy', 'Regel für das Alter des Messwerts', 'Règle d’ancienneté des valeurs', 'Regla de antigüedad de lecturas'],
  ['freshness-timestamp-mode', 'Which timestamp does this source really report?', 'Welchen Zeitstempel meldet diese Quelle tatsächlich?', 'Quel horodatage cette source fournit-elle réellement ?', '¿Qué marca de tiempo comunica realmente esta fuente?'],
  ['freshness-attribute', 'Actual timestamp attribute path', 'Tatsächlicher Zeitstempel-Attributpfad', 'Chemin de l’attribut d’horodatage réel', 'Ruta del atributo de la marca de tiempo real'],
  ['freshness-format', 'Actual timestamp format', 'Tatsächliches Zeitstempelformat', 'Format réel de l’horodatage', 'Formato real de la marca de tiempo'],
  ['freshness-age', 'Maximum reading age, seconds (optional)', 'Maximales Messwertalter, Sekunden (optional)', 'Ancienneté maximale, secondes (facultatif)', 'Antigüedad máxima, segundos (opcional)'],
];
for (const [id, ...words] of securityFields) field('security', `field.${id}`, 'sec', id, ...words);
field('security', 'lockEntity', 'sec', 'entity', 'Lock entity', 'Schloss-Entität', 'Entité serrure', 'Entidad de cerradura');
field('security', 'contactEntity', 'sec', 'entity', 'Contact entity', 'Kontakt-Entität', 'Entité contact', 'Entidad de contacto');
for (const [id, en, de, fr, es] of [['door', 'Door', 'Tür', 'Porte', 'Puerta'], ['window', 'Window', 'Fenster', 'Fenêtre', 'Ventana'], ['opening', 'Opening', 'Öffnung', 'Ouverture', 'Apertura'], ['lock', 'Lock', 'Schloss', 'Serrure', 'Cerradura']]) choice('security', `kind.${id}`, 'sec', 'kind', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['model', 'Exact tagged model object', 'Exaktes markiertes Modellobjekt', 'Objet exact du modèle étiqueté', 'Objeto exacto del modelo etiquetado'], ['plan', 'Explicit plan indicator', 'Ausdrücklicher Planindikator', 'Indicateur explicite du plan', 'Indicador explícito del plano']]) choice('security', `target.${id}`, 'sec', 'target-type', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['', 'Choose a location source', 'Positionsquelle wählen', 'Choisir une source de position', 'Elegir una fuente de posición'], ['room', 'Exact drawn or tagged room', 'Exakter gezeichneter oder markierter Raum', 'Pièce exacte dessinée ou étiquetée', 'Habitación exacta dibujada o etiquetada'], ['anchor', 'Exact existing marker anchor', 'Exakter vorhandener Markierungsanker', 'Ancrage exact d’un marqueur existant', 'Anclaje exacto de un marcador existente'], ['position', 'Fixed plan metres', 'Feste Plankoordinaten in Metern', 'Coordonnées fixes du plan en mètres', 'Coordenadas fijas del plano en metros']]) choice('security', `planSource.${id || 'choose'}`, 'sec', 'plan-source', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['object', 'Choose a tagged object', 'Markiertes Objekt wählen', 'Choisir un objet étiqueté', 'Elegir un objeto etiquetado'], ['target', 'Choose an exact moving part', 'Exaktes bewegliches Teil wählen', 'Choisir une pièce mobile exacte', 'Elegir una pieza móvil exacta'], ['plan-room', 'Choose an exact room', 'Exakten Raum wählen', 'Choisir une pièce exacte', 'Elegir una habitación exacta'], ['plan-anchor', 'Choose an exact marker', 'Exakte Markierung wählen', 'Choisir un marqueur exact', 'Elegir un marcador exacto'], ['plan-floor', 'Choose an exact floor', 'Exakte Etage wählen', 'Choisir un étage exact', 'Elegir una planta exacta'], ['plan-floor-constraint', 'Use the chosen source’s actual floor', 'Tatsächliche Etage der gewählten Quelle verwenden', 'Utiliser l’étage réel de la source choisie', 'Usar la planta real de la fuente elegida']]) choice('security', `choose.${id}`, 'sec', id, '', en, de, fr, es);
choice('security', 'choose.lock', 'sec', 'entity', '', 'Choose an actual lock', 'Tatsächliches Schloss wählen', 'Choisir une vraie serrure', 'Elegir una cerradura real');
choice('security', 'choose.contact', 'sec', 'entity', '', 'Choose an opening contact', 'Öffnungskontakt wählen', 'Choisir un contact d’ouverture', 'Elegir un contacto de apertura');
for (const key of ['pivot', 'axis']) for (const [index, axis] of ['X', 'Y', 'Z'].entries()) field('security', `${key}.${axis}`, 'sec', `${key}-${index}`, `${key === 'pivot' ? 'Pivot' : 'Axis'} ${axis}`, `${key === 'pivot' ? 'Drehpunkt' : 'Achse'} ${axis}`, `${key === 'pivot' ? 'Pivot' : 'Axe'} ${axis}`, `${key === 'pivot' ? 'Pivote' : 'Eje'} ${axis}`);

heading('tracking', 'title', 'h3', 'Tracking', 'Ortung', 'Suivi', 'Seguimiento');
heading('tracking', 'draft', 'h4', 'Unsaved binding', 'Ungespeicherte Zuordnung', 'Lien non enregistré', 'Vínculo sin guardar');
heading('tracking', 'appearance', 'h4', 'Marker appearance', 'Aussehen der Markierung', 'Apparence du marqueur', 'Aspecto del marcador');
heading('tracking', 'roomMapping', 'h4', 'Exact reported room names', 'Exakte gemeldete Raumnamen', 'Noms exacts des pièces signalées', 'Nombres exactos de habitaciones comunicados');
heading('tracking', 'identity', 'h4', 'Confirmed vehicle identity (optional)', 'Bestätigte Fahrzeugidentität (optional)', 'Identité confirmée du véhicule (facultatif)', 'Identidad confirmada del vehículo (opcional)');
heading('tracking', 'expiry', 'h4', 'When does “seen recently” end?', 'Wann endet „kürzlich gesehen“?', 'Quand « vu récemment » prend-il fin ?', '¿Cuándo termina «visto recientemente»?');
heading('tracking', 'display', 'h4', 'Display location', 'Anzeigeposition', 'Position d’affichage', 'Posición de visualización');
heading('tracking', 'fallback', 'h4', 'Fallback display location', 'Ersatz-Anzeigeposition', 'Position d’affichage de repli', 'Posición alternativa de visualización');
const trackingFields = [
  ['kind', 'Observation type', 'Beobachtungsart', 'Type d’observation', 'Tipo de observación'],
  ['label', 'Display label (optional)', 'Anzeigebeschriftung (optional)', 'Libellé d’affichage (facultatif)', 'Etiqueta de visualización (opcional)'],
  ['enabled', 'Show this binding', 'Diese Zuordnung anzeigen', 'Afficher ce lien', 'Mostrar este vínculo'],
  ['area-filter', 'Filter entity choices by current area', 'Entitäten nach aktuellem Bereich filtern', 'Filtrer les entités par zone actuelle', 'Filtrar entidades por área actual'],
  ['color', 'Marker colour (blank uses the display default)', 'Markierungsfarbe (leer = Anzeigestandard)', 'Couleur du marqueur (vide = valeur par défaut)', 'Color del marcador (vacío = predeterminado)'],
  ['size', 'Marker size, 0.1 to 5', 'Markierungsgröße, 0,1 bis 5', 'Taille du marqueur, de 0,1 à 5', 'Tamaño del marcador, de 0,1 a 5'],
  ['heading', 'Marker heading, degrees clockwise from north', 'Markierungsrichtung, Grad im Uhrzeigersinn ab Norden', 'Direction du marqueur, degrés horaires depuis le nord', 'Dirección del marcador, grados en sentido horario desde el norte'],
  ['show-inactive', 'Keep inactive markers visible with their actual status label', 'Inaktive Markierungen mit tatsächlichem Status anzeigen', 'Afficher les marqueurs inactifs avec leur état réel', 'Mostrar marcadores inactivos con su estado real'],
  ['interpolate-ms', 'Smooth consecutive measured positions, milliseconds', 'Aufeinanderfolgende gemessene Positionen glätten, Millisekunden', 'Lisser les positions mesurées consécutives, millisecondes', 'Suavizar posiciones medidas consecutivas, milisegundos'],
  ['signal', 'What this sensor reports', 'Was dieser Sensor meldet', 'Ce que signale ce capteur', 'Lo que comunica este sensor'],
  ['active', 'Active source states, separated by commas', 'Aktive Quellenzustände, durch Kommas getrennt', 'États actifs de la source, séparés par des virgules', 'Estados activos de origen, separados por comas'],
  ['clear', 'Clear source states, separated by commas', 'Inaktive Quellenzustände, durch Kommas getrennt', 'États inactifs de la source, séparés par des virgules', 'Estados inactivos de origen, separados por comas'],
  ['vehicle-confirmed', 'This source reports vehicles here, not general motion', 'Diese Quelle meldet hier Fahrzeuge, keine allgemeine Bewegung', 'Cette source signale des véhicules ici, pas un mouvement général', 'Esta fuente comunica vehículos aquí, no movimiento general'],
  ['location-mode', 'How to choose the display location', 'So wird die Anzeigeposition gewählt', 'Comment choisir la position d’affichage', 'Cómo elegir la posición de visualización'],
  ['room', 'Display in this room', 'In diesem Raum anzeigen', 'Afficher dans cette pièce', 'Mostrar en esta habitación'],
  ['anchor', 'Use this object or marker position', 'Diese Objekt- oder Markierungsposition verwenden', 'Utiliser la position de cet objet ou marqueur', 'Usar la posición de este objeto o marcador'],
  ['floor', 'Floor', 'Etage', 'Étage', 'Planta'],
  ['x', 'X — metres east', 'X — Meter nach Osten', 'X — mètres vers l’est', 'X — metros al este'],
  ['y', 'Y — metres north', 'Y — Meter nach Norden', 'Y — mètres vers le nord', 'Y — metros al norte'],
  ['z', 'Height above floor, metres', 'Höhe über dem Boden, Meter', 'Hauteur au-dessus du sol, mètres', 'Altura sobre el suelo, metros'],
  ['room-source', 'Room location source', 'Quelle für die Raumposition', 'Source de position dans la pièce', 'Fuente de ubicación en habitaciones'],
  ['room-attribute', 'Room attribute (leave blank to use the entity state)', 'Raumattribut (leer = Entitätszustand)', 'Attribut de pièce (vide = état de l’entité)', 'Atributo de habitación (vacío = estado de la entidad)'],
  ['map-value', 'Reported room value', 'Gemeldeter Raumwert', 'Valeur de pièce signalée', 'Valor de habitación comunicado'],
  ['map-room', 'Actual room', 'Tatsächlicher Raum', 'Pièce réelle', 'Habitación real'],
  ['identity-attribute', 'Identifier attribute (blank uses state)', 'Kennungsattribut (leer = Zustand)', 'Attribut d’identification (vide = état)', 'Atributo identificador (vacío = estado)'],
  ['identity-value', 'Exact confirmed identifier to match', 'Exakte bestätigte Kennung zum Abgleich', 'Identifiant exact confirmé à comparer', 'Identificador exacto confirmado para comparar'],
  ['timestamp-mode', 'Event time source', 'Quelle der Ereigniszeit', 'Source de l’heure de l’événement', 'Fuente de la hora del evento'],
  ['timestamp-attr', 'Timestamp attribute path', 'Zeitstempel-Attributpfad', 'Chemin de l’attribut d’horodatage', 'Ruta del atributo de marca de tiempo'],
  ['timestamp-format', 'Timestamp format', 'Zeitstempelformat', 'Format d’horodatage', 'Formato de marca de tiempo'],
  ['expires', 'Show as seen recently for this many seconds', 'So viele Sekunden als kürzlich gesehen anzeigen', 'Afficher comme vu récemment pendant ce nombre de secondes', 'Mostrar como visto recientemente durante estos segundos'],
  ['event-types', 'Vehicle event types to accept, separated by commas (optional for a vehicle-only source)', 'Akzeptierte Fahrzeugereignisse, durch Kommas getrennt (optional bei reiner Fahrzeugquelle)', 'Types d’événements de véhicules acceptés, séparés par des virgules (facultatif pour une source dédiée)', 'Tipos de eventos de vehículos aceptados, separados por comas (opcional para una fuente dedicada)'],
  ['event-type-attr', 'Event type attribute path', 'Attributpfad des Ereignistyps', 'Chemin de l’attribut du type d’événement', 'Ruta del atributo de tipo de evento'],
  ['event-id-attr', 'Event identifier attribute path (optional)', 'Attributpfad der Ereigniskennung (optional)', 'Chemin de l’attribut d’identifiant de l’événement (facultatif)', 'Ruta del atributo identificador del evento (opcional)'],
];
for (const [id, ...words] of trackingFields) field('tracking', `field.${id}`, 'trk', id, ...words);
field('tracking', 'source', 'trk', 'entity', 'Observation source', 'Beobachtungsquelle', 'Source d’observation', 'Fuente de observación');
field('tracking', 'vacuumSource', 'trk', 'entity', 'Vacuum status entity', 'Staubsauger-Statusentität', 'Entité d’état de l’aspirateur', 'Entidad de estado del aspirador');
field('tracking', 'presenceIdentity', 'trk', 'identity', 'Person or device associated with this room source (optional)', 'Dieser Raumquelle zugeordnete Person oder Gerät (optional)', 'Personne ou appareil associé à cette source de pièce (facultatif)', 'Persona o dispositivo asociado a esta fuente de habitación (opcional)');
field('tracking', 'vehicleIdentity', 'trk', 'identity', 'Source that reports the real vehicle identifier', 'Quelle der tatsächlichen Fahrzeugkennung', 'Source de l’identifiant réel du véhicule', 'Fuente del identificador real del vehículo');
field('tracking', 'occupied', 'trk', 'active', 'Occupied source states, separated by commas', 'Belegte Quellenzustände, durch Kommas getrennt', 'États occupés de la source, séparés par des virgules', 'Estados ocupados de origen, separados por comas');
field('tracking', 'empty', 'trk', 'clear', 'Empty source states, separated by commas', 'Leere Quellenzustände, durch Kommas getrennt', 'États vides de la source, séparés par des virgules', 'Estados vacíos de origen, separados por comas');
for (const [id, en, de, fr, es] of [['presence', 'Presence', 'Anwesenheit', 'Présence', 'Presencia'], ['vehicles', 'Driveway vehicles', 'Fahrzeuge auf der Einfahrt', 'Véhicules dans l’allée', 'Vehículos en la entrada'], ['vacuums', 'Robot vacuums', 'Saugroboter', 'Aspirateurs robots', 'Aspiradores robot']]) heading('tracking', `section.${id}`, `[data-act="trk-section"][data-section="${id}"]`, en, de, fr, es);
for (const [id, en, de, fr, es] of [['presence', 'Add presence binding', 'Anwesenheitszuordnung hinzufügen', 'Ajouter un lien de présence', 'Añadir vínculo de presencia'], ['vehicle', 'Add vehicle binding', 'Fahrzeugzuordnung hinzufügen', 'Ajouter un lien de véhicule', 'Añadir vínculo de vehículo'], ['vacuum', 'Add vacuum binding', 'Staubsaugerzuordnung hinzufügen', 'Ajouter un lien d’aspirateur', 'Añadir vínculo de aspirador']]) action('tracking', `add.${id}`, 'trk', 'add', en, de, fr, es);
for (const [id, en, de, fr, es] of [['remove-map', 'Remove mapping', 'Zuordnung entfernen', 'Supprimer la correspondance', 'Eliminar correspondencia'], ['add-map', 'Add room mapping', 'Raumzuordnung hinzufügen', 'Ajouter une correspondance de pièce', 'Añadir correspondencia de habitación'], ['relink', 'Relink deliberately', 'Gezielt neu verknüpfen', 'Rétablir les liens explicitement', 'Volver a vincular explícitamente']]) action('tracking', id, 'trk', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [
  ['room_activity', 'Anonymous room activity', 'Anonyme Raumaktivität', 'Activité anonyme dans la pièce', 'Actividad anónima en la habitación'],
  ['room_location', 'Reported room location', 'Gemeldete Raumposition', 'Position signalée dans une pièce', 'Ubicación de habitación comunicada'],
  ['occupancy', 'Vehicle stays while occupied', 'Fahrzeug bleibt bei Belegung sichtbar', 'Le véhicule reste affiché tant que la place est occupée', 'El vehículo permanece mientras hay ocupación'],
  ['count', 'Reported vehicle count', 'Gemeldete Fahrzeuganzahl', 'Nombre de véhicules signalé', 'Cantidad de vehículos comunicada'],
  ['event', 'Vehicle seen recently — expires', 'Fahrzeug kürzlich gesehen — läuft ab', 'Véhicule vu récemment — expire', 'Vehículo visto recientemente — caduca'],
  ['static', 'Status at a fixed room or dock', 'Status an einem festen Raum oder einer Station', 'État dans une pièce ou une station fixe', 'Estado en una habitación o base fija'],
  ['room', 'Reported room, exact position unknown', 'Gemeldeter Raum, genaue Position unbekannt', 'Pièce signalée, position exacte inconnue', 'Habitación comunicada, posición exacta desconocida'],
  ['xy', 'Measured coordinates with an explicit plan frame', 'Gemessene Koordinaten mit ausdrücklichem Planbezug', 'Coordonnées mesurées avec un repère de plan explicite', 'Coordenadas medidas con un marco de plano explícito'],
]) choice('tracking', `kind.${id}`, 'trk', 'kind', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['room', 'Selected room', 'Gewählter Raum', 'Pièce sélectionnée', 'Habitación seleccionada'], ['position', 'Fixed plan position', 'Feste Planposition', 'Position fixe du plan', 'Posición fija del plano'], ['anchor', 'Existing object or marker', 'Vorhandenes Objekt oder Markierung', 'Objet ou marqueur existant', 'Objeto o marcador existente']]) choice('tracking', `location.${id}`, 'trk', 'location-mode', id, en, de, fr, es);
choice('tracking', 'motion', 'trk', 'signal', 'motion', 'Motion — activity, not identity', 'Bewegung — Aktivität, keine Identität', 'Mouvement — activité, pas identité', 'Movimiento — actividad, no identidad');
choice('tracking', 'occupancy', 'trk', 'signal', 'occupancy', 'Occupancy — anonymous', 'Belegung — anonym', 'Occupation — anonyme', 'Ocupación — anónima');
for (const id of ['entity', 'identity', 'room-source']) choice('tracking', `choose.${id}`, 'trk', id, '', 'Choose an actual entity', 'Tatsächliche Entität wählen', 'Choisir une entité réelle', 'Elegir una entidad real');
choice('tracking', 'choose.floor', 'trk', 'floor', '', 'Choose the actual floor', 'Tatsächliche Etage wählen', 'Choisir l’étage réel', 'Elegir la planta real');
choice('tracking', 'choose.anchor', 'trk', 'anchor', '', 'Choose an existing mapped object', 'Vorhandenes zugeordnetes Objekt wählen', 'Choisir un objet existant associé', 'Elegir un objeto existente vinculado');
for (const id of ['room', 'map-room']) choice('tracking', `choose.${id}`, 'trk', id, '', 'Choose a room with an outline', 'Raum mit Umriss wählen', 'Choisir une pièce avec un contour', 'Elegir una habitación con contorno');

// Source-policy values are built-in enums. Real timestamps and state strings
// remain exact raw values, not captions.
for (const [id, en, de, fr, es] of [['current', 'Current HA state — no age limit', 'Aktueller HA-Zustand — keine Altersgrenze', 'État HA actuel — sans limite d’ancienneté', 'Estado HA actual — sin límite de antigüedad'], ['timestamp', 'Actual timestamp — check reading age', 'Tatsächlicher Zeitstempel — Messwertalter prüfen', 'Horodatage réel — vérifier l’ancienneté', 'Marca de tiempo real — comprobar antigüedad']]) {
  choice('security', `age.${id}`, 'sec', 'freshness-mode', id, en, de, fr, es);
  for (const target of ['status', 'position']) choice('tracking', `age.${target}.${id}`, 'trk', `freshness-${target}-mode`, id, en, de, fr, es);
}
choice('security', 'age.saved', 'sec', 'freshness-mode', 'saved', 'Saved rule — choose a deliberate replacement', 'Gespeicherte Regel — gezielt ersetzen', 'Règle enregistrée — choisir un remplacement explicite', 'Regla guardada — elegir sustitución explícita');
for (const target of ['status', 'position']) {
  choice('tracking', `age.${target}.saved`, 'trk', `freshness-${target}-mode`, 'saved', 'Saved rule — choose a deliberate repair', 'Gespeicherte Regel — gezielt reparieren', 'Règle enregistrée — choisir une réparation explicite', 'Regla guardada — elegir reparación explícita');
  field('tracking', `age.${target}.timestampField`, 'trk', `freshness-${target}-timestamp-mode`, 'Which timestamp does this source really report?', 'Welchen Zeitstempel meldet diese Quelle tatsächlich?', 'Quel horodatage cette source fournit-elle réellement ?', '¿Qué marca de tiempo comunica realmente esta fuente?');
  field('tracking', `age.${target}.attributeField`, 'trk', `freshness-${target}-attribute`, 'Timestamp attribute path', 'Zeitstempel-Attributpfad', 'Chemin de l’attribut d’horodatage', 'Ruta del atributo de marca de tiempo');
  field('tracking', `age.${target}.formatField`, 'trk', `freshness-${target}-format`, 'Actual timestamp format', 'Tatsächliches Zeitstempelformat', 'Format réel de l’horodatage', 'Formato real de la marca de tiempo');
  field('tracking', `age.${target}.ageField`, 'trk', `freshness-${target}-age`, 'Maximum reading age, seconds', 'Maximales Messwertalter, Sekunden', 'Ancienneté maximale, secondes', 'Antigüedad máxima, segundos');
  choice('tracking', `age.${target}.choose`, 'trk', `freshness-${target}-timestamp-mode`, '', 'Choose the actual timestamp', 'Tatsächlichen Zeitstempel wählen', 'Choisir l’horodatage réel', 'Elegir la marca de tiempo real');
}
choice('security', 'age.choose', 'sec', 'freshness-timestamp-mode', '', 'Choose the actual timestamp', 'Tatsächlichen Zeitstempel wählen', 'Choisir l’horodatage réel', 'Elegir la marca de tiempo real');
for (const [id, en, de, fr, es] of [['iso', 'ISO date/time with timezone', 'ISO-Datum/Zeit mit Zeitzone', 'Date/heure ISO avec fuseau horaire', 'Fecha/hora ISO con zona horaria'], ['seconds', 'Unix seconds', 'Unix-Sekunden', 'Secondes Unix', 'Segundos Unix'], ['milliseconds', 'Unix milliseconds', 'Unix-Millisekunden', 'Millisecondes Unix', 'Milisegundos Unix']]) choice('security', `format.${id}`, 'sec', 'freshness-format', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['state', 'Entity state is the timestamp', 'Entitätszustand ist der Zeitstempel', 'L’état de l’entité est l’horodatage', 'El estado de la entidad es la marca de tiempo'], ['attribute', 'An attribute reports the timestamp', 'Ein Attribut meldet den Zeitstempel', 'Un attribut fournit l’horodatage', 'Un atributo comunica la marca de tiempo'], ['last_updated', 'HA last state or attribute update', 'Letzte HA-Zustands- oder Attributaktualisierung', 'Dernière mise à jour d’état ou d’attribut HA', 'Última actualización de estado o atributo HA'], ['last_changed', 'HA last state change', 'Letzte HA-Zustandsänderung', 'Dernier changement d’état HA', 'Último cambio de estado HA']]) choice('security', `timestamp.${id}`, 'sec', 'freshness-timestamp-mode', id, en, de, fr, es);
for (const target of ['status', 'position']) {
  for (const [id, en, de, fr, es] of [['state', 'Entity state is the actual timestamp', 'Entitätszustand ist der tatsächliche Zeitstempel', 'L’état de l’entité est l’horodatage réel', 'El estado de la entidad es la marca de tiempo real'], ['attribute', 'An attribute is the actual timestamp', 'Ein Attribut ist der tatsächliche Zeitstempel', 'Un attribut est l’horodatage réel', 'Un atributo es la marca de tiempo real'], ['last_updated', 'Home Assistant last state or attribute update', 'Letzte Home-Assistant-Zustands- oder Attributaktualisierung', 'Dernière mise à jour d’état ou d’attribut Home Assistant', 'Última actualización de estado o atributo de Home Assistant'], ['last_changed', 'Home Assistant last state change', 'Letzte Home-Assistant-Zustandsänderung', 'Dernier changement d’état Home Assistant', 'Último cambio de estado de Home Assistant']]) choice('tracking', `timestamp.${target}.${id}`, 'trk', `freshness-${target}-timestamp-mode`, id, en, de, fr, es);
  for (const [id, en, de, fr, es] of [['iso', 'ISO date/time with Z or a timezone offset', 'ISO-Datum/Zeit mit Z oder Zeitzonenversatz', 'Date/heure ISO avec Z ou décalage horaire', 'Fecha/hora ISO con Z o desfase horario'], ['seconds', 'Unix seconds', 'Unix-Sekunden', 'Secondes Unix', 'Segundos Unix'], ['milliseconds', 'Unix milliseconds', 'Unix-Millisekunden', 'Millisecondes Unix', 'Milisegundos Unix']]) choice('tracking', `format.${target}.${id}`, 'trk', `freshness-${target}-format`, id, en, de, fr, es);
}
for (const [id, en, de, fr, es] of [['position', 'Measured position', 'Gemessene Position', 'Position mesurée', 'Posición medida'], ['vacuum', 'Vacuum status', 'Staubsaugerstatus', 'État de l’aspirateur', 'Estado del aspirador'], ['vehicle', 'Vehicle source', 'Fahrzeugquelle', 'Source du véhicule', 'Fuente del vehículo'], ['observation', 'Observation source', 'Beobachtungsquelle', 'Source d’observation', 'Fuente de observación']]) {
  heading('tracking', `ageHeading.${id}`, '[data-trk-freshness] h4', `${en} reading age`, `Alter: ${de}`, `Ancienneté : ${fr}`, `Antigüedad: ${es}`);
  field('tracking', `ageField.${id}`, 'trk', `freshness-${id === 'position' ? 'position' : 'status'}-mode`, `${en} freshness`, `Aktualität: ${de}`, `Fraîcheur : ${fr}`, `Vigencia: ${es}`);
}
for (const [id, en, de, fr, es] of [['state', 'Entity state contains the event time', 'Entitätszustand enthält die Ereigniszeit', 'L’état contient l’heure de l’événement', 'El estado contiene la hora del evento'], ['attribute', 'An attribute contains the event time', 'Ein Attribut enthält die Ereigniszeit', 'Un attribut contient l’heure de l’événement', 'Un atributo contiene la hora del evento'], ['last_changed', 'Explicit pulse when the state changes', 'Ausdrücklicher Impuls bei Zustandsänderung', 'Impulsion explicite au changement d’état', 'Pulso explícito al cambiar el estado'], ['last_updated', 'Explicit event when state or attributes change', 'Ausdrückliches Ereignis bei Zustands- oder Attributänderung', 'Événement explicite au changement d’état ou d’attribut', 'Evento explícito al cambiar estado o atributos'], ['', 'Choose how this source reports time', 'Zeitmeldung dieser Quelle auswählen', 'Choisir comment cette source indique l’heure', 'Elegir cómo comunica el tiempo esta fuente']]) choice('tracking', `eventTime.${id || 'choose'}`, 'trk', 'timestamp-mode', id, en, de, fr, es);
for (const [id, en, de, fr, es] of [['iso', 'ISO date/time', 'ISO-Datum/Zeit', 'Date/heure ISO', 'Fecha/hora ISO'], ['seconds', 'Unix seconds', 'Unix-Sekunden', 'Secondes Unix', 'Segundos Unix'], ['milliseconds', 'Unix milliseconds', 'Unix-Millisekunden', 'Millisecondes Unix', 'Milisegundos Unix']]) choice('tracking', `eventFormat.${id}`, 'trk', 'timestamp-format', id, en, de, fr, es);

heading('camera', 'title', 'h3', 'Camera coverage', 'Kameraabdeckung', 'Couverture de la caméra', 'Cobertura de cámara');
const cameraFields = [
  ['area-filter', 'Filter cameras by current area', 'Kameras nach aktuellem Bereich filtern', 'Filtrer les caméras par zone actuelle', 'Filtrar cámaras por área actual'],
  ['camera', 'Camera', 'Kamera', 'Caméra', 'Cámara'],
  ['anchor', 'Camera object or marker', 'Kameraobjekt oder Markierung', 'Objet ou marqueur de caméra', 'Objeto o marcador de cámara'],
  ['enabled', 'Show approximate coverage', 'Ungefähre Abdeckung anzeigen', 'Afficher la couverture approximative', 'Mostrar cobertura aproximada'],
  ['heading', 'Heading, degrees clockwise from north', 'Richtung, Grad im Uhrzeigersinn ab Norden', 'Direction, degrés horaires depuis le nord', 'Dirección, grados en sentido horario desde el norte'],
  ['heading-slider', 'Heading slider — move to choose', 'Richtungsregler — bewegen zum Auswählen', 'Curseur de direction — déplacer pour choisir', 'Control de dirección — mover para elegir'],
  ['fov', 'Horizontal field of view, degrees', 'Horizontales Sichtfeld, Grad', 'Champ de vision horizontal, degrés', 'Campo de visión horizontal, grados'],
  ['range', 'Approximate range, metres', 'Ungefähre Reichweite, Meter', 'Portée approximative, mètres', 'Alcance aproximado, metros'],
  ['color', 'Coverage colour', 'Farbe der Abdeckung', 'Couleur de la couverture', 'Color de cobertura'],
  ['opacity', 'Opacity, 0 to 1', 'Deckkraft, 0 bis 1', 'Opacité, de 0 à 1', 'Opacidad, de 0 a 1'],
  ['show-rays', 'Show camera boundary rays', 'Grenzstrahlen der Kamera anzeigen', 'Afficher les rayons de limite de la caméra', 'Mostrar rayos del límite de cámara'],
  ['segments', 'Coverage curve detail, 2 to 64 segments', 'Kurvendetail der Abdeckung, 2 bis 64 Segmente', 'Détail de la courbe, de 2 à 64 segments', 'Detalle de la curva, de 2 a 64 segmentos'],
];
for (const [id, ...words] of cameraFields) field('camera', `field.${id}`, 'cov', id, ...words);
action('camera', 'clear', 'cov', 'clear', 'Clear saved coverage', 'Gespeicherte Abdeckung entfernen', 'Supprimer la couverture enregistrée', 'Eliminar cobertura guardada');
add('camera', 'headingAria', '[data-field="cov-heading-slider"]', 'aria-label', 'Heading clockwise from north', 'Richtung im Uhrzeigersinn ab Norden', 'Direction horaire depuis le nord', 'Dirección en sentido horario desde el norte');
add('camera', 'headingPlaceholder', '[data-field="cov-heading"]', 'placeholder', 'Choose a direction', 'Richtung wählen', 'Choisir une direction', 'Elegir una dirección');
add('camera', 'fovPlaceholder', '[data-field="cov-fov"]', 'placeholder', 'Camera specification', 'Kameraspezifikation', 'Caractéristiques de la caméra', 'Especificación de cámara');
add('camera', 'rangePlaceholder', '[data-field="cov-range"]', 'placeholder', 'Enter reach', 'Reichweite eingeben', 'Saisir la portée', 'Introducir alcance');
add('tracking', 'typesAria', 'nav[aria-label]', 'aria-label', 'Tracking types', 'Ortungsarten', 'Types de suivi', 'Tipos de seguimiento');

heading('shading', 'title', 'h3', 'Model shading', 'Modellschattierung', 'Ombrage du modèle', 'Sombreado del modelo');
heading('shading', 'contents', 'h4', 'What is in this model?', 'Was enthält dieses Modell?', 'Que contient ce modèle ?', '¿Qué contiene este modelo?');
field('shading', 'display', 'model-rendering', 'preset', 'Display choice', 'Anzeigeauswahl', 'Choix d’affichage', 'Opción de visualización');
action('shading', 'save', 'model-rendering', 'save', 'Save shading', 'Schattierung speichern', 'Enregistrer l’ombrage', 'Guardar sombreado');
action('shading', 'cancel', 'model-rendering', 'cancel', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
choice('shading', 'preset.invalid', 'model-rendering', 'preset', 'invalid', 'Invalid saved settings — choose a replacement', 'Ungültige gespeicherte Einstellungen — Ersatz wählen', 'Paramètres enregistrés invalides — choisir un remplacement', 'Ajustes guardados no válidos — elegir sustitución');
choice('shading', 'preset.custom', 'model-rendering', 'preset', 'custom', 'Imported custom settings — kept unchanged', 'Importierte benutzerdefinierte Einstellungen — unverändert beibehalten', 'Paramètres personnalisés importés — conservés sans modification', 'Ajustes personalizados importados — conservados sin cambios');
for (const [id, en, de, fr, es] of [['normal', 'Normal', 'Normal', 'Normal', 'Normal'], ['no-shadows', 'No realtime shadows', 'Keine Echtzeitschatten', 'Sans ombres en temps réel', 'Sin sombras en tiempo real'], ['authored', 'Authored shading (lamps off)', 'Im Modell angelegte Schattierung (Lampen aus)', 'Ombrage intégré au modèle (lampes éteintes)', 'Sombreado integrado en el modelo (lámparas apagadas)'], ['shadows-only', 'Realtime shadows (lamps off)', 'Echtzeitschatten (Lampen aus)', 'Ombres en temps réel (lampes éteintes)', 'Sombras en tiempo real (lámparas apagadas)']]) choice('shading', `preset.${id}`, 'model-rendering', 'preset', id, en, de, fr, es);

export const advancedCaptionEntries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry,
  translations: Object.freeze(entry.translations) })));
const byScope = new Map(['security', 'tracking', 'camera', 'shading'].map((scope) => [scope,
  advancedCaptionEntries.filter((entry) => entry.scope === scope)]));
const byKey = new Map(advancedCaptionEntries.map((entry) => [entry.key, entry]));
const addToIndex = (index, key, entry) => { const list = index.get(key) || []; list.push(entry); index.set(key, list); };
const captionIndexes = new Map([...byScope].map(([scope, scoped]) => {
  const fields = new Map(), actions = new Map(), headings = [], attributes = [];
  for (const entry of scoped) {
    const field = entry.selector.match(/^\[data-field="([^"]+)"\]/)?.[1];
    const action = entry.selector.match(/^\[data-act="([^"]+)"\]/)?.[1];
    if (field) addToIndex(fields, field, entry);
    else if (action) addToIndex(actions, action, entry);
    else if (['label', 'text'].includes(entry.kind)) headings.push(entry);
    else attributes.push(entry);
  }
  return [scope, { fields, actions, headings, attributes }];
}));
export default Object.freeze(Object.fromEntries(['en', 'de', 'fr', 'es'].map((language) => [language,
  Object.freeze(Object.fromEntries(advancedCaptionEntries.map((entry) => [entry.key, entry.translations[language]])))])));

function markCaption(selected, entry) {
    const host = entry.kind === 'label' ? selected.closest('label') : selected;
    if (!host) return;
    if (!['label', 'text'].includes(entry.kind)) {
      const marker = `data-advanced-${entry.kind}-key`;
      if (host.getAttribute(marker) === entry.key || host.getAttribute(entry.kind) === entry.translations.en) host.setAttribute(marker, entry.key);
      return;
    }
    if (host.tagName === 'OPTION') {
      if (host.textContent === entry.translations.en) host.dataset.advancedOption = entry.key;
      return;
    }
    const direct = [...host.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim() === entry.translations.en);
    if (!direct) return;
    const span = host.ownerDocument.createElement('span'); span.dataset.advancedCaption = entry.key;
    span.dataset.advancedLeading = direct.textContent.match(/^\s*/)[0];
    span.dataset.advancedTrailing = direct.textContent.match(/\s*$/)[0];
    span.textContent = direct.textContent; direct.replaceWith(span);
}

function markCaptions(root, index) {
  // Index exact authored controls once; do not scan HA names or query every
  // caption selector on each HA update. Native options remain plain text.
  for (const selected of root.querySelectorAll('[data-field],[data-act],h3,h4,legend,nav[aria-label]')) {
    for (const entry of index.fields.get(selected.dataset.field) || []) {
      const option = entry.selector.match(/ option\[value="([^"]*)"\]$/);
      if (option) {
        if (selected.tagName === 'SELECT') for (const choice of selected.options) if (choice.value === option[1]) markCaption(choice, entry);
      } else markCaption(selected, entry);
    }
    for (const entry of index.actions.get(selected.dataset.act) || []) if (selected.matches(entry.selector)) markCaption(selected, entry);
    if (['H3', 'H4', 'LEGEND'].includes(selected.tagName)) for (const entry of index.headings) if (selected.matches(entry.selector)) markCaption(selected, entry);
    if (selected.tagName === 'NAV') for (const entry of index.attributes) if (selected.matches(entry.selector)) markCaption(selected, entry);
  }
}

// Native controls are retained. Only marked caption text/attributes change.
export function updateAdvancedCaptions(root, scope, translate) {
  if (!root || typeof translate !== 'function') return;
  const owned = byScope.get(scope) || [];
  const index = captionIndexes.get(scope); if (!index) return;
  markCaptions(root, index);
  for (const node of root.querySelectorAll('[data-advanced-caption],[data-advanced-option]')) {
    const entry = byKey.get(node.dataset.advancedCaption || node.dataset.advancedOption);
    if (entry?.scope !== scope) continue;
    const value = (node.dataset.advancedLeading || '') + translate(entry.key, entry.translations.en) + (node.dataset.advancedTrailing || '');
    if (node.textContent !== value) node.textContent = value;
  }
  for (const entry of owned) if (!['label', 'text'].includes(entry.kind)) {
    for (const host of root.querySelectorAll(`[data-advanced-${entry.kind}-key="${entry.key}"]`)) {
      const value = translate(entry.key, entry.translations.en);
      if (host.getAttribute(entry.kind) !== value) host.setAttribute(entry.kind, value);
    }
  }
}

export function renderAdvancedCaptions(html, scope, translate) {
  const template = document.createElement('template'); template.innerHTML = html;
  updateAdvancedCaptions(template.content, scope, translate);
  return template.innerHTML;
}
