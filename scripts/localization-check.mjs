// Real source/bundle controls and browser keyboard/pointer intent. The fixture
// supplies explicitly simulated HA readings/formatters, not a live HA language
// installation. Native OS colour-dialog automation is deliberately not claimed.
// Run after building: node scripts/localization-check.mjs [--source-only|--bundle-only].
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { launch, newPage, root } from './lib/demo-browser.mjs';
import { installLocalizationFixture, localizationEntities as entities, localizationNames as names,
  localizationFixtureHtml, installExtraEditorFixture } from './lib/localization-fixture.mjs';

const checks = [], errors = [], screenshots = path.join(root, 'screenshots');
let label = '', context = 'fixture';
const check = (name, pass, detail) => {
  checks.push(!!pass);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${name}${detail === undefined ? '' : ' – ' + JSON.stringify(detail)}`);
};
// Independent fixed examples: a bundle check never imports the source lookup
// or derives its expected label from the implementation under test.
const words = Object.freeze({
  en: { lights: 'Lights', security: 'Security', media: 'Media', climate: 'Climate', cars: 'Cars',
    carsEmpty: 'No current vehicle sources are selected. Choose your sources in Edit → Tracking.',
    settings: 'Settings', connected: 'Connected to Home Assistant', top: 'Top',
    toolbar: 'House views and controls', mapToggle: 'Show or hide mini-map', controls: 'All controls', close: 'Close controls',
    colour: 'Colour', choose: 'Choose colour', turnOff: 'Turn off', map: 'Floor mini-map', mapFloor: 'Mini-map floor',
    hideMap: 'Hide mini-map', roomFocus: `Focus ${names.room}`, roomKind: 'Room controls',
    roomSummary: '1 light entity on · 1 media player playing', lightsCount: '1 light on',
    people: '1 of 1 selected person home', undo: 'Undo', redo: 'Redo', rooms: 'Rooms', data: 'Data', house: 'House',
    json: 'Single-layout JSON', import: 'Import JSON', sending: 'Sending command…', error: 'Command failed: ',
  },
  de: { lights: 'Lichter', security: 'Sicherheit', media: 'Medien', climate: 'Klima', cars: 'Autos',
    carsEmpty: 'Derzeit sind keine Fahrzeugquellen ausgewählt. Wähle deine Quellen unter Bearbeiten → Ortung.',
    settings: 'Einstellungen', connected: 'Mit Home Assistant verbunden', top: 'Draufsicht',
    toolbar: 'Hausansichten und Bedienelemente', mapToggle: 'Minikarte ein- oder ausblenden', controls: 'Alle Bedienelemente', close: 'Bedienelemente schließen',
    colour: 'Farbe', choose: 'Farbe wählen', turnOff: 'Ausschalten', map: 'Etagen-Minikarte', mapFloor: 'Etage der Minikarte',
    hideMap: 'Minikarte ausblenden', roomFocus: `${names.room} fokussieren`, roomKind: 'Raumsteuerung',
    roomSummary: '1 Lichtentität eingeschaltet · 1 Medienplayer spielt', lightsCount: '1 Licht eingeschaltet',
    people: '1 von 1 ausgewählten Person zu Hause', undo: 'Rückgängig', redo: 'Wiederholen', rooms: 'Räume', data: 'Daten', house: 'Haus',
    json: 'JSON eines einzelnen Layouts', import: 'JSON importieren', sending: 'Befehl wird gesendet…', error: 'Befehl fehlgeschlagen: ',
  },
  fr: { lights: 'Lumières', security: 'Sécurité', media: 'Médias', climate: 'Climat', cars: 'Voitures',
    carsEmpty: 'Aucune source de véhicule n’est actuellement sélectionnée. Choisissez vos sources dans Modifier → Suivi.',
    settings: 'Paramètres', connected: 'Connecté à Home Assistant', top: 'Vue de dessus',
    toolbar: 'Vues et commandes de la maison', mapToggle: 'Afficher ou masquer la mini-carte', controls: 'Toutes les commandes', close: 'Fermer les commandes',
    colour: 'Couleur', choose: 'Choisir une couleur', turnOff: 'Éteindre', map: 'Minicarte des étages', mapFloor: 'Étage de la minicarte',
    hideMap: 'Masquer la minicarte', roomFocus: `Centrer sur ${names.room}`, roomKind: 'Commandes de la pièce',
    roomSummary: '1 entité d’éclairage allumée · 1 lecteur multimédia en lecture', lightsCount: '1 lumière allumée',
    people: '1 sur 1 personne sélectionnée à la maison', undo: 'Annuler', redo: 'Rétablir', rooms: 'Pièces', data: 'Données', house: 'Maison',
    json: 'JSON d’un seul agencement', import: 'Importer le JSON', sending: 'Envoi de la commande…', error: 'Échec de la commande : ',
  },
  es: { lights: 'Luces', security: 'Seguridad', media: 'Multimedia', climate: 'Clima', cars: 'Coches',
    carsEmpty: 'No hay fuentes de vehículos seleccionadas actualmente. Elige tus fuentes en Editar → Seguimiento.',
    settings: 'Ajustes', connected: 'Conectado a Home Assistant', top: 'Vista superior',
    toolbar: 'Vistas y controles de la casa', mapToggle: 'Mostrar u ocultar el minimapa', controls: 'Todos los controles', close: 'Cerrar los controles',
    colour: 'Color', choose: 'Elegir color', turnOff: 'Apagar', map: 'Minimapa de plantas', mapFloor: 'Planta del minimapa',
    hideMap: 'Ocultar minimapa', roomFocus: `Enfocar ${names.room}`, roomKind: 'Controles de la habitación',
    roomSummary: '1 entidad de luz encendida · 1 reproductor multimedia reproduciendo', lightsCount: '1 luz encendida',
    people: '1 de 1 persona seleccionada en casa', undo: 'Deshacer', redo: 'Rehacer', rooms: 'Habitaciones', data: 'Datos', house: 'Casa',
    json: 'JSON de un solo diseño', import: 'Importar JSON', sending: 'Enviando comando…', error: 'El comando falló: ',
  },
});
// Representative setup/advanced captions are fixed independently of the app
// dictionaries. These checks do not claim every editor/help sentence is translated.
const extendedWords = Object.freeze({
  en: { height: 'Card height', heightHelp: 'CSS height, e.g. 520px or 60vh', view: 'Starting named view (exact ID)',
    modelTitle: 'Model from a URL (instead of uploading in the card)', popup: 'Open device controls', toggle: 'Quick toggle',
    source: 'Imported source settings', sourceModel: 'URL model settings', uploaded: 'Use uploaded model', imported: 'Imported view: ',
    order: 'Button order', up: 'Up', reset: 'Reset view', resetUp: 'Move Reset view up',
    security: 'Door, window and lock security', label: 'Label', kind: 'Security kind', door: 'Door', contact: 'Contact entity',
    tracking: 'Tracking', trackLabel: 'Display label (optional)', appearance: 'Marker appearance', presence: 'Presence',
    camera: 'Camera coverage', heading: 'Heading, degrees clockwise from north', headingAria: 'Heading clockwise from north', headingPlaceholder: 'Choose a direction',
    shading: 'Model shading', display: 'Display choice', authored: 'Authored shading (lamps off)', saveShading: 'Save shading' },
  de: { height: 'Kartenhöhe', heightHelp: 'CSS-Höhe, z. B. 520px oder 60vh', view: 'Benannte Startansicht (exakte ID)',
    modelTitle: 'Modell über URL (statt Hochladen in der Karte)', popup: 'Gerätesteuerung öffnen', toggle: 'Schnell umschalten',
    source: 'Importierte Quelleinstellungen', sourceModel: 'URL-Modelleinstellungen', uploaded: 'Hochgeladenes Modell verwenden', imported: 'Importierte Ansicht: ',
    order: 'Reihenfolge der Schaltflächen', up: 'Nach oben', reset: 'Ansicht zurücksetzen', resetUp: 'Ansicht zurücksetzen nach oben verschieben',
    security: 'Sicherheit für Türen, Fenster und Schlösser', label: 'Beschriftung', kind: 'Sicherheitsart', door: 'Tür', contact: 'Kontakt-Entität',
    tracking: 'Ortung', trackLabel: 'Anzeigebeschriftung (optional)', appearance: 'Aussehen der Markierung', presence: 'Anwesenheit',
    camera: 'Kameraabdeckung', heading: 'Richtung, Grad im Uhrzeigersinn ab Norden', headingAria: 'Richtung im Uhrzeigersinn ab Norden', headingPlaceholder: 'Richtung wählen',
    shading: 'Modellschattierung', display: 'Anzeigeauswahl', authored: 'Im Modell angelegte Schattierung (Lampen aus)', saveShading: 'Schattierung speichern' },
  fr: { height: 'Hauteur de la carte', heightHelp: 'Hauteur CSS, par exemple 520px ou 60vh', view: 'Vue nommée au démarrage (ID exact)',
    modelTitle: 'Modèle depuis une URL (au lieu d’un envoi dans la carte)', popup: 'Ouvrir les commandes de l’appareil', toggle: 'Basculer rapidement',
    source: 'Paramètres des sources importées', sourceModel: 'Paramètres du modèle par URL', uploaded: 'Utiliser le modèle envoyé', imported: 'Vue importée : ',
    order: 'Ordre des boutons', up: 'Monter', reset: 'Réinitialiser la vue', resetUp: 'Monter Réinitialiser la vue',
    security: 'Sécurité des portes, fenêtres et serrures', label: 'Libellé', kind: 'Type de sécurité', door: 'Porte', contact: 'Entité contact',
    tracking: 'Suivi', trackLabel: 'Libellé d’affichage (facultatif)', appearance: 'Apparence du marqueur', presence: 'Présence',
    camera: 'Couverture de la caméra', heading: 'Direction, degrés horaires depuis le nord', headingAria: 'Direction horaire depuis le nord', headingPlaceholder: 'Choisir une direction',
    shading: 'Ombrage du modèle', display: 'Choix d’affichage', authored: 'Ombrage intégré au modèle (lampes éteintes)', saveShading: 'Enregistrer l’ombrage' },
  es: { height: 'Altura de la tarjeta', heightHelp: 'Altura CSS, por ejemplo 520px o 60vh', view: 'Vista inicial con nombre (ID exacto)',
    modelTitle: 'Modelo desde una URL (en lugar de subirlo en la tarjeta)', popup: 'Abrir controles del dispositivo', toggle: 'Cambio rápido',
    source: 'Ajustes de fuentes importadas', sourceModel: 'Ajustes del modelo por URL', uploaded: 'Usar modelo subido', imported: 'Vista importada: ',
    order: 'Orden de botones', up: 'Subir', reset: 'Restablecer vista', resetUp: 'Subir Restablecer vista',
    security: 'Seguridad de puertas, ventanas y cerraduras', label: 'Etiqueta', kind: 'Tipo de seguridad', door: 'Puerta', contact: 'Entidad de contacto',
    tracking: 'Seguimiento', trackLabel: 'Etiqueta de visualización (opcional)', appearance: 'Aspecto del marcador', presence: 'Presencia',
    camera: 'Cobertura de cámara', heading: 'Dirección, grados en sentido horario desde el norte', headingAria: 'Dirección en sentido horario desde el norte', headingPlaceholder: 'Elegir una dirección',
    shading: 'Sombreado del modelo', display: 'Opción de visualización', authored: 'Sombreado integrado en el modelo (lámparas apagadas)', saveShading: 'Guardar sombreado' },
});
const liveWords = Object.freeze({
  en: { weather: 'Weather and sun', intensity: 'Decorative intensity, 0 to 1', quality: 'Low — wall panel',
    weatherHelp: 'It is not a measured rain or snow rate.', weatherError: 'Choose valid settings before saving; nothing has been saved.',
    house: 'House summary', houseName: 'Title', people: 'Selected people', houseSave: 'Save house summary',
    houseHelp: 'Motion sensors do not name a person.', camera: 'Camera view', close: 'Close view', retry: 'Retry',
    stream: 'Camera stream · muted', opening: 'Opening camera…', unknown: 'Camera state is unknown.',
    cameraHelp: 'This view is muted.', scenes: 'Scenes', sceneAria: 'Saved scene light previews', activate: 'Activate', stop: 'Stop preview',
    preview: `Preview ${names.scene}`, pinned: `Previewing ${names.scene} in the model only. Press Stop preview to finish.`,
    activating: `Activating ${names.scene}…`, activated: `Activated ${names.scene}.`, chooseScene: 'Choose a preview, or activate a saved scene.' },
  de: { weather: 'Wetter und Sonne', intensity: 'Dekorative Intensität, 0 bis 1', quality: 'Niedrig — Wandpanel',
    weatherHelp: 'Es ist keine gemessene Regen- oder Schneemenge.', weatherError: 'Wählen Sie vor dem Speichern gültige Einstellungen; es wurde nichts gespeichert.',
    house: 'Hausübersicht', houseName: 'Titel', people: 'Ausgewählte Personen', houseSave: 'Hausübersicht speichern',
    houseHelp: 'Bewegungssensoren nennen keine Person.', camera: 'Kameraansicht', close: 'Ansicht schließen', retry: 'Erneut versuchen',
    stream: 'Kamerastream · stummgeschaltet', opening: 'Kamera wird geöffnet…', unknown: 'Der Kamerazustand ist unbekannt.',
    cameraHelp: 'Diese Ansicht ist stummgeschaltet.', scenes: 'Szenen', sceneAria: 'Gespeicherte Lichtvorschauen für Szenen', activate: 'Aktivieren', stop: 'Vorschau beenden',
    preview: `Vorschau: ${names.scene}`, pinned: `Vorschau von ${names.scene} nur im Modell. Wähle Vorschau beenden, um sie zu beenden.`,
    activating: `${names.scene} wird aktiviert…`, activated: `${names.scene} aktiviert.`, chooseScene: 'Wähle eine Vorschau oder aktiviere eine gespeicherte Szene.' },
  fr: { weather: 'Météo et soleil', intensity: 'Intensité décorative, de 0 à 1', quality: 'Faible — panneau mural',
    weatherHelp: 'Ce n’est pas une mesure de pluie ou de neige.', weatherError: 'Choisissez des paramètres valides avant d’enregistrer ; rien n’a été enregistré.',
    house: 'Résumé de la maison', houseName: 'Titre', people: 'Personnes sélectionnées', houseSave: 'Enregistrer le résumé de la maison',
    houseHelp: 'Les capteurs de mouvement ne nomment pas une personne.', camera: 'Vue de la caméra', close: 'Fermer la vue', retry: 'Réessayer',
    stream: 'Flux de caméra · muet', opening: 'Ouverture de la caméra…', unknown: 'L’état de la caméra est inconnu.',
    cameraHelp: 'Cette vue est muette.', scenes: 'Scènes', sceneAria: 'Aperçus lumineux de scènes enregistrés', activate: 'Activer', stop: 'Arrêter l’aperçu',
    preview: `Aperçu : ${names.scene}`, pinned: `Aperçu de ${names.scene} uniquement dans le modèle. Appuyez sur Arrêter l’aperçu pour terminer.`,
    activating: `Activation de ${names.scene}…`, activated: `${names.scene} activée.`, chooseScene: 'Choisissez un aperçu ou activez une scène enregistrée.' },
  es: { weather: 'Tiempo y sol', intensity: 'Intensidad decorativa, de 0 a 1', quality: 'Baja — panel de pared',
    weatherHelp: 'No es una tasa medida de lluvia o nieve.', weatherError: 'Elija ajustes válidos antes de guardar; no se ha guardado nada.',
    house: 'Resumen de la casa', houseName: 'Título', people: 'Personas seleccionadas', houseSave: 'Guardar el resumen de la casa',
    houseHelp: 'Los sensores de movimiento no identifican a una persona.', camera: 'Vista de cámara', close: 'Cerrar vista', retry: 'Reintentar',
    stream: 'Transmisión de cámara · silenciada', opening: 'Abriendo cámara…', unknown: 'Se desconoce el estado de la cámara.',
    cameraHelp: 'Esta vista está silenciada.', scenes: 'Escenas', sceneAria: 'Previsualizaciones de luces de escenas guardadas', activate: 'Activar', stop: 'Detener previsualización',
    preview: `Previsualizar ${names.scene}`, pinned: `Previsualizando ${names.scene} solo en el modelo. Pulsa Detener previsualización para terminar.`,
    activating: `Activando ${names.scene}…`, activated: `${names.scene} activada.`, chooseScene: 'Elige una previsualización o activa una escena guardada.' },
});
// Fixed examples for the five additional editors, deliberately separate from
// advancedEditors and independent of source/bundle translation imports.
const extraEditorWords = Object.freeze({
  en: {
    scene: ['Scene light previews', 'Preview label', 'Activate sends the real saved scene to Home Assistant.', 'On'],
    idle: ['Ambient idle', 'Wait before idle mode, seconds', 'Rotation is a display effect.', 'Actual sun'],
    wall: ['Wall presentation', 'Fade or glass opacity, percent', 'Normal restores the authored appearance.', 'Fade'],
    floor: ['Floor presentation', 'Additional spacing, metres', 'Side by side puts the chosen floors at one display height', 'Side by side'],
    furniture: ['Furniture', 'Plan X, metres', 'Preview is temporary; saved coordinates stay unchanged until Save.', 'User_<b>Pack_été'],
    missingFloor: 'The exact current floor is missing, ambiguous, stale or has no finite elevation. Its saved ID is kept.',
    sceneNoTime: 'No activation time reported',
  },
  de: {
    scene: ['Lichtvorschauen für Szenen', 'Vorschaubezeichnung', 'Aktivieren sendet die tatsächlich gespeicherte Szene an Home Assistant.', 'Ein'],
    idle: ['Ruhemodus', 'Wartezeit vor Ruhemodus, Sekunden', 'Die Drehung ist ein Anzeigeeffekt.', 'Tatsächliche Sonne'],
    wall: ['Wandansicht', 'Deckkraft für Ausblenden oder Glas, Prozent', 'Normal stellt die ursprüngliche Darstellung wieder her.', 'Ausblenden'],
    floor: ['Etagenansicht', 'Zusätzlicher Abstand, Meter', 'Nebeneinander ordnet die ausgewählten Etagen auf einer Anzeigehöhe', 'Nebeneinander'],
    furniture: ['Möbel', 'Plan X, Meter', 'Vorschau ist vorübergehend; gespeicherte Koordinaten bleiben bis zum Speichern unverändert.', 'User_<b>Pack_été'],
    missingFloor: 'Die genaue aktuelle Etage fehlt, ist mehrdeutig, veraltet oder ohne endliche Höhe. Ihre gespeicherte ID bleibt erhalten.',
    sceneNoTime: 'Kein Aktivierungszeitpunkt gemeldet',
  },
  fr: {
    scene: ['Aperçus lumineux de scènes', 'Libellé de l’aperçu', 'Activer envoie la scène réelle enregistrée à Home Assistant.', 'Allumé'],
    idle: ['Mode ambiant au repos', 'Délai avant le repos, secondes', 'La rotation est un effet d’affichage.', 'Soleil réel'],
    wall: ['Présentation des murs', 'Opacité d’atténuation ou du verre, pourcentage', 'Normal rétablit l’apparence d’origine.', 'Atténuation'],
    floor: ['Présentation des étages', 'Espacement supplémentaire, mètres', 'Côte à côte place les étages choisis à une hauteur d’affichage commune', 'Côte à côte'],
    furniture: ['Mobilier', 'X du plan, mètres', 'L’aperçu est temporaire ; les coordonnées restent inchangées jusqu’à l’enregistrement.', 'User_<b>Pack_été'],
    missingFloor: 'L’étage actuel exact est absent, ambigu, obsolète ou sans altitude finie. Son identifiant enregistré est conservé.',
    sceneNoTime: 'Aucune heure d’activation fournie',
  },
  es: {
    scene: ['Previsualizaciones de luces de escenas', 'Etiqueta de previsualización', 'Activar envía la escena real guardada a Home Assistant.', 'Encendido'],
    idle: ['Modo ambiental en reposo', 'Espera antes del reposo, segundos', 'El giro es un efecto visual.', 'Sol real'],
    wall: ['Presentación de paredes', 'Opacidad de desvanecimiento o cristal, porcentaje', 'Normal restaura la apariencia original.', 'Desvanecer'],
    floor: ['Presentación de plantas', 'Separación adicional, metros', 'Lado a lado sitúa las plantas elegidas a una altura visual común', 'Lado a lado'],
    furniture: ['Muebles', 'X del plano, metros', 'La vista previa es temporal; las coordenadas guardadas no cambian hasta guardar.', 'User_<b>Pack_été'],
    missingFloor: 'La planta actual exacta falta, es ambigua, obsoleta o no tiene elevación finita. Su ID guardado se conserva.',
    sceneNoTime: 'No se comunica hora de activación',
  },
});
const nav = (id) => `[data-house-navigation-id="${id}"]`;
const row = (id) => `.t3d-entity[data-entity="${id}"]`;
const input = (kind) => `${row(entities.lamp)} input[data-light-control="${kind}"]`;
const flush = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function ready(page) {
  await page.evaluate(() => { window.localizationStable = null; });
  try { await page.waitForFunction(() => {
    const card = document.querySelector('taylors3d-card'), view = card?._view, now = performance.now();
    if (!view || card._loading || card._pending || view.dirty || view._tween || view._occFull || view._occTimer
      || now - (view._camMovedAt || 0) < 350) { window.localizationStable = null; return false; }
    const rect = card._scene.getBoundingClientRect(), popup = card._devicePopup?.el;
    const signature = JSON.stringify([rect.x, rect.y, rect.width, rect.height, view.stats.frames,
      card._devicePopup?._session, popup?.dataset.houseControlsLayout, popup?.getBoundingClientRect().height]);
    if (window.localizationStable?.signature !== signature) { window.localizationStable = { signature, at: now }; return false; }
    return now - window.localizationStable.at > 350;
  }, { timeout: 15000, polling: 50 }); } catch (error) {
    error.message += `; ${label}${context}; ${JSON.stringify(await snapshot(page).catch(() => null))}`;
    throw error;
  }
}
async function control(page, selector, callback) {
  context = `native control ${selector}`;
  const handle = await page.evaluateHandle((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector), selector);
  try {
    const element = handle.asElement(); if (!element) throw new Error(`Missing localized control ${selector}`);
    await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element);
  } finally { await handle.dispose(); }
  await flush(page);
}
const click = (page, selector) => control(page, selector, (element) => element.click());
const focusElement = (element) => element.evaluate((node) => {
  // Puppeteer's ElementHandle.focus rejects SVG elements despite native SVG
  // focus support. Focus the actual node, then verify its actual shadow focus.
  node.focus();
  if (node.getRootNode().activeElement !== node) throw new Error('Native control did not receive focus');
});
const focus = (page, selector) => control(page, selector, focusElement);
const keyboard = (page, selector, key) => control(page, selector, async (element) => { await focusElement(element); await page.keyboard.press(key); });
async function type(page, selector, value) {
  await control(page, selector, async (element) => {
    await element.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.press('Backspace'); await page.keyboard.type(value);
  });
  const actual = await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector)?.value, selector);
  if (actual !== value) throw new Error(`Native text produced ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
}
async function narrowStage(page) {
  // Cross the real responsive breakpoint before measuring its remaining borders.
  await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = '320px'; });
  await flush(page);
  const reservation = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card');
    return card.getBoundingClientRect().width - card._stage.getBoundingClientRect().width;
  });
  if (!Number.isFinite(reservation) || reservation < 0) throw new Error('Actual narrow-stage reservation is invalid');
  await page.evaluate((reservation) => { document.querySelector('taylors3d-card').style.width = String(320 + reservation) + 'px'; }, reservation);
  await flush(page);
}

async function remember(page, selector, key) {
  await page.evaluate(({ selector, key }) => {
    const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
    if (!node) throw new Error(`Cannot retain ${selector}`);
    (window.localizationFixture.nodes ||= {})[key] = node;
  }, { selector, key });
}
async function retained(page, selector, key, active = false) {
  return page.evaluate(({ selector, key, active }) => {
    const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
    return node === window.localizationFixture.nodes[key] && (!active || card.shadowRoot.activeElement === node);
  }, { selector, key, active });
}
async function locale(page, language) {
  context = `current HA locale ${language}`;
  await page.evaluate((language) => {
    const card = document.querySelector('taylors3d-card');
    card.hass = { ...card._hass, language, locale: { ...card._hass.locale, language } };
    // HA gives hass separately to a card and its configuration editor. This
    // explicitly simulated host mirrors that delivery, not dashboard saving.
    if (window.localizationFixture.cardEditor) window.localizationFixture.cardEditor.hass = card._hass;
  }, language); await flush(page);
}
async function patch(page, { connected, service, state, language } = {}) {
  await page.evaluate(({ connected, service, state, language, entity }) => {
    const card = document.querySelector('taylors3d-card'), hass = card._hass;
    if (connected !== undefined) hass.connection.connected = connected;
    let services = hass.services;
    if (service !== undefined) { services = { ...services, light: { ...services.light } };
      if (service) services.light.turn_on = {}; else delete services.light.turn_on; }
    const states = state === undefined ? hass.states : { ...hass.states, [entity]: { ...hass.states[entity], state } };
    card.hass = { ...hass, services, states, ...(language ? { language, locale: { ...hass.locale, language } } : {}) };
  }, { connected, service, state, language, entity: entities.lamp }); await flush(page);
}
async function snapshot(page) {
  return page.evaluate(({ entities, names }) => {
    const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot, view = card._view, f = window.localizationFixture;
    const text = (selector) => shadow.querySelector(selector)?.textContent;
    const attr = (selector, attribute = 'aria-label') => shadow.querySelector(selector)?.getAttribute(attribute);
    const popup = card._devicePopup.el;
    return { locale: card._hass.locale.language, title: text('[data-taylors3d-summary-title]'),
      connected: text('[data-taylors3d-summary-meta]'), headerLights: text('[data-taylors3d-summary-item="lights"]'),
      headerPeople: text('[data-taylors3d-summary-item="people"]'), headerWeather: text('[data-taylors3d-summary-item="weather"]'),
      lights: attr('[data-house-navigation-id="lights"]'), settings: attr('[data-house-navigation-id="settings"]'),
      toolbar: attr('.toolbar'), top: text('.toolbar [data-mode="top"]'), mapToggle: attr('.toolbar .minimap-toggle'),
      viewName: text('.chips [data-view="locale_ground"]'),
      popup: popup ? { title: popup.querySelector('h3').textContent, kind: popup.querySelector('.t3d-popup-kind').textContent,
        empty: card._devicePopup._empty?.textContent,
        close: popup.querySelector('.t3d-popup-close').getAttribute('aria-label'),
        summary: popup.querySelector('.t3d-room-summary')?.textContent, mode: popup.dataset.houseControlsLayout,
        rows: [...popup.querySelectorAll('.t3d-entity')].map((node) => ({ id: node.dataset.entity,
          name: node.querySelector('.t3d-entity-name').textContent, value: node.querySelector('.t3d-entity-value').textContent,
          info: node.querySelector('[data-action="more-info"]').textContent,
          infoAria: node.querySelector('[data-action="more-info"]').getAttribute('aria-label'),
          colour: node.querySelector('legend')?.textContent, choose: node.querySelector('.t3d-colour-picker span')?.textContent,
          toggle: node.querySelector('[data-action="toggle"]')?.textContent,
          sending: node.querySelector('.t3d-entity-status').textContent, error: node.querySelector('.t3d-entity-error').textContent,
        })) } : null,
      map: card._miniMap ? { visible: !card._miniMap.el.hidden, aria: card._miniMap.el.getAttribute('aria-label'),
        floorAria: card._miniMap.select.getAttribute('aria-label'), closeAria: card._miniMap.closeButton.getAttribute('aria-label'),
        roomAria: card._miniMap.el.querySelector('[data-room="locale_room"]')?.getAttribute('aria-label'),
        floorNames: [...card._miniMap.select.options].map((option) => option.textContent),
        floorIds: [...card._miniMap.select.options].map((option) => option.value),
        selectedFloor: card._miniMap.scene.floorId, floorValue: card._miniMap.select.value,
        floorSelectorVisible: !card._miniMap.select.hidden,
        roomPoints: card._miniMap.el.querySelector('[data-room="locale_room"]')?.getAttribute('points') } : null,
      editing: card._editing, tab: card._edit?.tab, floor: card._floor, selectedRoom: card._selectedRoomId,
      history: { undo: card._history?.canUndo, redo: card._history?.canRedo, label: card._history?.undoLabel },
      metrics: { frames: view.stats.frames, draws: view.renderer.info.render.calls, memory: { ...view.renderer.info.memory },
        resize: f.resizeCalls, setSize: f.sizeWrites },
      calls: f.services, info: f.info, navigation: f.navigation, commits: f.commits, saves: f.saveCalls,
      realReadingsUnchanged: JSON.stringify(card._hass.states) === f.initialStates,
      rendererSame: view.renderer === f.renderer, sceneSame: card._scene === f.scene,
      names: { lamp: card._hass.states[entities.lamp].attributes.friendly_name, room: card._hass.areas.locale_room.name,
        floor: card._hass.floors.locale_ground.name, title: card._layout.house_summary.title, expected: names.title },
    };
  }, { entities, names });
}
async function screenshot(page, name) {
  fs.mkdirSync(screenshots, { recursive: true }); const main = await page.$('main');
  try { await main.screenshot({ path: path.join(screenshots, name) }); } finally { await main.dispose(); }
}
async function open(mode) {
  const transport = await launch(); let session;
  const requests = [];
  try {
    session = await newPage(transport.browser, { width: 1440, height: 1100 }); const { page } = session;
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url()); requests.push(url.pathname);
      if (request.isNavigationRequest() && url.pathname === '/demo/localization-fixture.html')
        request.respond({ status: 200, contentType: 'text/html', body: localizationFixtureHtml(mode) });
      else request.continue();
    });
    await page.goto(`${transport.base}/demo/localization-fixture.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.localizationModuleReady, { timeout: 15000 }); await page.bringToFront();
    await page.evaluate(installLocalizationFixture, { mode, entities, names }); await ready(page);
    return { ...transport, ...session, requests };
  } catch (error) { errors.push(...session?.errors || []); await transport.close(); throw error; }
}

async function marker(page) {
  context = 'real reachable grouped-device marker';
  const point = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), element = card._markerEls.get('device:locale_device');
    if (!element) return null; element.focus({ preventScroll: true });
    const box = element.querySelector('.fp-dot').getBoundingClientRect(), point = [box.x + box.width / 2, box.y + box.height / 2];
    return card.shadowRoot.elementFromPoint(...point)?.closest('.fp-marker') === element ? point : null;
  });
  if (!point) throw new Error('Current grouped device marker is not reachable by a real pointer.');
  await page.mouse.click(...point); await ready(page);
}
async function room(page) {
  context = 'real exposed room-floor tap';
  const point = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), canvas = card._view.renderer.domElement, box = canvas.getBoundingClientRect();
    for (const x of [-1, 0, 1, -3, 3]) for (const y of [-2, 2, -1, 1]) {
      const point = card._view.screenPoint(x, y, .02, 'locale_ground');
      if (!point || point[0] < box.left + 8 || point[0] > box.right - 8 || point[1] < box.top + 8 || point[1] > box.bottom - 8) continue;
      if (card.shadowRoot.elementFromPoint(...point) === canvas) return point;
    } return null;
  });
  if (!point) throw new Error('No genuine exposed room-floor point is reachable.');
  await page.mouse.click(...point); await ready(page);
}
async function escape(page) { await page.keyboard.press('Escape'); await ready(page); }

async function headerAndNavigation(page) {
  const initial = await snapshot(page);
  check('fixture uses the real connected card, scene and current source identities', initial.rendererSame && initial.sceneSame
    && initial.names.title === names.title && initial.names.lamp === names.lamp && initial.calls.length === 0, initial.names);
  await focus(page, nav('lights')); await remember(page, nav('lights'), 'nav-lights');
  await remember(page, '.toolbar [data-mode="top"]', 'top'); await remember(page, '.chips [data-view="locale_ground"]', 'view');
  for (const [language, resolved] of [['de-DE', 'de'], ['fr-FR', 'fr'], ['es-ES', 'es'], ['it-IT', 'en'], ['en', 'en']]) {
    await locale(page, language); await ready(page); const current = await snapshot(page), expected = words[resolved];
    check(`${language} resolves owned navigation/header captions`, current.lights === expected.lights && current.settings === expected.settings
      && current.connected === expected.connected && current.headerLights === expected.lightsCount && current.headerPeople === expected.people,
    { lights: current.lights, connected: current.connected, count: current.headerLights, people: current.headerPeople });
    check(`${language} preserves exact focused navigation and native toolbar/view nodes`, await retained(page, nav('lights'), 'nav-lights', true)
      && await retained(page, '.toolbar [data-mode="top"]', 'top') && await retained(page, '.chips [data-view="locale_ground"]', 'view'));
    check(`${language} keeps real names/native HA formatter output and identifier attributes`, current.title === names.title && current.viewName === names.view
      && current.headerWeather === 'HA_STATE:cloudy · HA_ATTR:temperature:12.25' && current.realReadingsUnchanged
      && current.toolbar === expected.toolbar && current.top === expected.top && current.mapToggle === expected.mapToggle
      && current.names.room === names.room && current.names.floor === names.ground && current.calls.length === 0, current.headerWeather);
  }
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language);
    for (const id of ['lights', 'security', 'media', 'climate', 'cars']) {
      const before = (await snapshot(page)).navigation.length;
      await keyboard(page, nav(id), 'Enter'); await ready(page); const current = await snapshot(page);
      check(`${language} translates the owned ${id} category title and preserves its exact selection`, current.popup?.title === words[language][id]
        && current.navigation.length === before + 1 && equal(current.navigation.at(-1), { type: 'category', id })
        && (id !== 'cars' || current.popup.empty === words[language].carsEmpty)
        && current.realReadingsUnchanged && current.calls.length === 0, current.popup);
      await escape(page);
    }
  }
  const before = (await snapshot(page)).navigation.length;
  await focus(page, nav('lights')); await page.keyboard.down('Space');
  try { await locale(page, 'de'); check('held native Space stays focused on the same translated action', await retained(page, nav('lights'), 'nav-lights', true)); }
  finally { await page.keyboard.up('Space'); }
  await ready(page); let current = await snapshot(page);
  check('translated held Space opens exactly the intended Lights category without HA action', current.navigation.length === before + 1
    && equal(current.navigation.at(-1), { type: 'category', id: 'lights' }) && current.popup?.title === words.de.lights
    && current.popup.rows.some((entry) => entry.id === entities.lamp && entry.name === names.lamp) && current.calls.length === 0, current.popup);
  await escape(page);
  await focus(page, nav('media')); await remember(page, nav('media'), 'nav-media'); const oldCalls = current.navigation.length;
  await page.keyboard.down('Space');
  try {
    await patch(page, { connected: false, language: 'fr' });
    check('session loss disables current translated native category buttons', await page.evaluate(() => document.querySelector('taylors3d-card').shadowRoot.querySelector('[data-house-navigation-id="media"]').disabled));
    await patch(page, { connected: true, language: 'es' });
  } finally { await page.keyboard.up('Space'); }
  await ready(page); current = await snapshot(page);
  check('language/session recovery cannot revive a held old category action', current.navigation.length === oldCalls && !current.popup
    && await retained(page, nav('media'), 'nav-media') && current.calls.length === 0, current.navigation);
  await keyboard(page, nav('media'), 'Space'); await ready(page); current = await snapshot(page);
  check('a fresh native key after recovery selects the unchanged Media action once', current.navigation.length === oldCalls + 1
    && equal(current.navigation.at(-1), { type: 'category', id: 'media' }) && current.popup.rows.some((entry) => entry.id === entities.player)
    && current.calls.length === 0, current.navigation.at(-1));
  await escape(page);
}

async function popupScenario(page, mode) {
  await marker(page); let current = await snapshot(page);
  check('genuine device pointer opens grouped controls with literal device/entity names and no command', current.popup?.title === names.device
    && current.popup.rows.some((entry) => entry.id === entities.temperature && entry.name === names.temperature && entry.value === 'HA_STATE:12.345')
    && current.calls.length === 0, current.popup);
  await focus(page, input('color')); await remember(page, input('color'), 'colour'); await remember(page, row(entities.lamp), 'lamp-row');
  // Explicit DOM input/change path, plus real focus: the OS picker itself is
  // outside Puppeteer's supported surface. Native keyboard ranges follow below.
  await control(page, input('color'), (element) => element.evaluate((node) => { node.value = '#abcdef'; node.dispatchEvent(new Event('input', { bubbles: true })); }));
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page); current = await snapshot(page); const light = current.popup.rows.find((entry) => entry.id === entities.lamp);
    check(`${language} localizes popup captions around the exact focused unfinished colour input`, await retained(page, input('color'), 'colour', true)
      && await retained(page, row(entities.lamp), 'lamp-row') && light.info === words[language].controls
      && light.colour === words[language].colour && light.choose === words[language].choose && light.toggle === words[language].turnOff
      && current.popup.close === words[language].close, light);
    check(`${language} never translates real names/readings or submits an input preview`, current.popup.title === names.device && light.name === names.lamp
      && current.popup.rows.find((entry) => entry.id === entities.temperature).value === 'HA_STATE:12.345' && current.realReadingsUnchanged
      && current.calls.length === 0 && await page.evaluate((selector) => document.querySelector('taylors3d-card').shadowRoot.querySelector(selector).value === '#abcdef', input('color')));
  }
  await control(page, input('color'), (element) => element.evaluate((node) => node.dispatchEvent(new Event('change', { bubbles: true }))));
  current = await snapshot(page);
  check('one explicit colour change retains its exact RGB service payload after locale switches', equal(current.calls, [['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [171, 205, 239] }]])
    && current.realReadingsUnchanged, current.calls);
  let count = current.calls.length;
  await keyboard(page, input('brightness'), 'End'); current = await snapshot(page);
  check('real keyboard brightness End submits one255 command with the original entity ID', current.calls.length === count + 1
    && equal(current.calls.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, brightness: 255 }]), current.calls.at(-1));
  count = current.calls.length; await locale(page, 'fr'); await keyboard(page, input('kelvin'), 'End'); current = await snapshot(page);
  check('real keyboard Kelvin End uses the actual reported6400 bound exactly once', current.calls.length === count + 1
    && equal(current.calls.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, color_temp_kelvin: 6400 }]), current.calls.at(-1));
  count = current.calls.length;
  await page.evaluate(() => { window.localizationFixture.deferNext = true; });
  await keyboard(page, `${row(entities.lamp)} [data-action="toggle"]`, 'Space'); await locale(page, 'es'); current = await snapshot(page);
  check('pending command caption changes language without repeating the deliberate toggle', current.calls.length === count + 1
    && equal(current.calls.at(-1), ['light', 'toggle', { entity_id: entities.lamp }])
    && current.popup.rows.find((entry) => entry.id === entities.lamp).sending === words.es.sending, current.calls.at(-1));
  await page.evaluate(() => { window.localizationFixture.pending.reject(new Error('<HA_ORIGINAL_ERROR_été>')); window.localizationFixture.pending = null; });
  await flush(page); await locale(page, 'fr'); current = await snapshot(page);
  check('translated error prefix preserves the literal HA error safely as text', current.popup.rows.find((entry) => entry.id === entities.lamp).error === words.fr.error + '<HA_ORIGINAL_ERROR_été>'
    && await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('ha_original_error_été')));
  await screenshot(page, `localization-${mode}-fr-device.png`);
  count = current.calls.length;
  await focus(page, input('color')); await remember(page, input('color'), 'revoked-colour');
  await control(page, input('color'), (element) => element.evaluate((node) => { node.value = '#102030'; node.dispatchEvent(new Event('input', { bubbles: true })); }));
  await patch(page, { service: false, language: 'de' }); current = await snapshot(page);
  check('service loss removes unavailable light fields while retaining the actual entity and raw HA readings', current.calls.length === count
    && current.realReadingsUnchanged && current.popup.title === names.device && current.popup.close === words.de.close
    && current.popup.rows.some((entry) => entry.id === entities.lamp && entry.name === names.lamp)
    && await page.evaluate((selector) => {
      const card = document.querySelector('taylors3d-card');
      return !window.localizationFixture.nodes['revoked-colour'].isConnected && !card.shadowRoot.querySelector(selector)
        && !card.shadowRoot.querySelector('input[data-light-control="brightness"]') && !card.shadowRoot.querySelector('input[data-light-control="kelvin"]');
    }, input('color')), current.popup);
  await patch(page, { service: true, language: 'es' }); await remember(page, input('color'), 'recovered-colour'); current = await snapshot(page);
  check('service recovery presents a fresh field with the exact current HA colour and translated caption', current.calls.length === count
    && current.realReadingsUnchanged && current.popup.close === words.es.close
    && await page.evaluate(({ selector, name }) => {
      const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
      return node?.isConnected && node !== window.localizationFixture.nodes['revoked-colour'] && node.value === '#0c2238'
        && node.getAttribute('aria-label') === `${name}: elegir color`;
    }, { selector: input('color'), name: names.lamp }), current.popup);
  await page.evaluate(() => window.localizationFixture.nodes['revoked-colour'].dispatchEvent(new Event('change', { bubbles: true })));
  await flush(page); current = await snapshot(page);
  check('locale changes cannot revive an unfinished command after service loss/recovery', current.calls.length === count
    && current.realReadingsUnchanged && await retained(page, input('color'), 'recovered-colour'), current.calls);
  await control(page, input('color'), (element) => element.evaluate((node) => {
    node.value = '#102030'; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  })); current = await snapshot(page);
  check('a fresh explicit input after recovery can send the exact current RGB action', current.calls.length === count + 1
    && equal(current.calls.at(-1), ['light', 'turn_on', { entity_id: entities.lamp, rgb_color: [16, 32, 48] }]), current.calls.at(-1));
  count = current.calls.length;
  await focus(page, input('color')); await remember(page, input('color'), 'disconnected-colour');
  await control(page, input('color'), (element) => element.evaluate((node) => { node.value = '#010203'; node.dispatchEvent(new Event('input', { bubbles: true })); }));
  await patch(page, { connected: false, language: 'de' }); await patch(page, { connected: true, language: 'fr' });
  await page.evaluate(() => window.localizationFixture.nodes['disconnected-colour'].dispatchEvent(new Event('change', { bubbles: true })));
  await flush(page); current = await snapshot(page);
  check('connection recovery/localization rejects an old detached colour release', current.calls.length === count, current.calls);
  await marker(page); await keyboard(page, `${row(entities.lamp)} [data-action="more-info"]`, 'Enter'); await ready(page); current = await snapshot(page);
  check('translated All controls sends exactly HA more-info and no extra service', equal(current.info, [entities.lamp])
    && current.calls.length === count && !current.popup, current.info);
}

async function roomAndMap(page, mode) {
  await room(page); const initial = await snapshot(page), count = initial.calls.length;
  check('actual floor tap identifies the exact room and grouped secondary/current player', initial.popup?.title === names.room
    && initial.popup.rows.some((entry) => entry.id === entities.temperature) && initial.popup.rows.some((entry) => entry.id === entities.player)
    && initial.selectedRoom === 'locale_room', initial.popup);
  await focus(page, `${row(entities.temperature)} [data-action="more-info"]`);
  await remember(page, `${row(entities.temperature)} [data-action="more-info"]`, 'room-info');
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page); const current = await snapshot(page);
    check(`${language} translates actual room counts without changing the room/current entity list`, current.popup.title === names.room
      && current.popup.kind === words[language].roomKind && current.popup.summary === words[language].roomSummary
      && equal(current.popup.rows.map((entry) => entry.id), initial.popup.rows.map((entry) => entry.id)), current.popup.summary);
    check(`${language} preserves room All-controls focus and produces no passive service`, await retained(page, `${row(entities.temperature)} [data-action="more-info"]`, 'room-info', true)
      && current.calls.length === count && current.realReadingsUnchanged);
  }
  await locale(page, 'de'); await screenshot(page, `localization-${mode}-de-room.png`); await escape(page);
  if (!(await snapshot(page)).map.visible) await click(page, '.toolbar .minimap-toggle'); await ready(page);
  // The map follows the actual named view. Choose the real overview before
  // expecting both floors; a one-floor view correctly hides its floor selector.
  await keyboard(page, '.chips [data-view="all"]', 'Enter'); await ready(page);
  let mapScope = await snapshot(page);
  check('native overview exposes both literal floors with the exact ground map selection', mapScope.floor === 'all'
    && equal(mapScope.map.floorNames, [names.ground, names.upper])
    && equal(mapScope.map.floorIds, ['locale_ground', 'locale_upper']) && mapScope.map.floorSelectorVisible
    && mapScope.map.selectedFloor === 'locale_ground' && mapScope.map.floorValue === 'locale_ground'
    && mapScope.calls.length === count && mapScope.realReadingsUnchanged, mapScope.map);
  await focus(page, '.taylors3d-minimap [data-room="locale_room"]'); await remember(page, '.taylors3d-minimap [data-room="locale_room"]', 'map-room');
  await remember(page, '.taylors3d-minimap .map-floor', 'map-floor'); const points = (await snapshot(page)).map.roomPoints;
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page); const current = await snapshot(page);
    check(`${language} localizes mini-map ARIA and keeps exact native SVG focus/coordinates`, current.map.aria === words[language].map
      && current.map.floorAria === words[language].mapFloor && current.map.closeAria === words[language].hideMap
      && current.map.roomAria === words[language].roomFocus && current.map.roomPoints === points
      && await retained(page, '.taylors3d-minimap [data-room="locale_room"]', 'map-room', true), current.map);
    check(`${language} leaves literal HA floor options and the selected actual floor intact`, equal(current.map.floorNames, [names.ground, names.upper])
      && equal(current.map.floorIds, ['locale_ground', 'locale_upper']) && current.map.floorSelectorVisible
      && current.map.selectedFloor === 'locale_ground' && current.map.floorValue === 'locale_ground'
      && await retained(page, '.taylors3d-minimap .map-floor', 'map-floor') && current.floor === 'all' && current.calls.length === count);
  }
  await page.keyboard.press('Enter'); await ready(page); const current = await snapshot(page);
  const camera = await page.evaluate(() => document.querySelector('taylors3d-card')._view.getTopCamera());
  check('translated SVG Enter focuses exactly the source room on its actual floor without a device action', current.selectedRoom === 'locale_room'
    && current.floor === 'locale_ground' && camera.center.every((value) => Math.abs(value) < 1e-5) && current.calls.length === count && !current.popup, camera);
  check('exact room focus narrows the map to its literal floor and hides the unnecessary selector', equal(current.map.floorNames, [names.ground])
    && equal(current.map.floorIds, ['locale_ground']) && current.map.selectedFloor === 'locale_ground'
    && current.map.floorValue === 'locale_ground' && !current.map.floorSelectorVisible);
  // Room focus deliberately selected one floor. Restore the real overview
  // before exercising native focus on its two-floor selector again.
  await keyboard(page, '.chips [data-view="all"]', 'Enter'); await ready(page); mapScope = await snapshot(page);
  check('native overview restores the same real selector and literal options without device actions', mapScope.floor === 'all'
    && equal(mapScope.map.floorNames, [names.ground, names.upper])
    && equal(mapScope.map.floorIds, ['locale_ground', 'locale_upper']) && mapScope.map.floorSelectorVisible
    && mapScope.map.selectedFloor === 'locale_ground' && mapScope.map.floorValue === 'locale_ground'
    && await retained(page, '.taylors3d-minimap .map-floor', 'map-floor') && mapScope.calls.length === count && mapScope.realReadingsUnchanged);
  await focus(page, '.taylors3d-minimap .map-floor'); await locale(page, 'es');
  check('native mini-map floor selector retains focus through language change', await retained(page, '.taylors3d-minimap .map-floor', 'map-floor', true));
  await keyboard(page, '.taylors3d-minimap .map-close', 'Space'); await ready(page);
  check('translated native map close works and returns focus to the same bubble button', await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'); return card._miniMap.el.hidden && card.shadowRoot.activeElement === card._miniMapBtn;
  }));
}

async function editorScenario(page, mode) {
  await locale(page, 'en'); await keyboard(page, nav('settings'), 'Enter'); await ready(page);
  check('actual Settings key opens the native House editor', (await snapshot(page)).editing && (await snapshot(page)).tab === 'house');
  const title = '[data-field="house-summary-title"]'; await type(page, title, 'User_Unfinished_Title_été');
  await remember(page, title, 'editor-title'); await remember(page, '[data-act="tab"][data-id="rooms"]', 'rooms-tab');
  const before = await snapshot(page);
  const personOptions = await page.evaluate(() => [...document.querySelector('taylors3d-card').shadowRoot
    .querySelector('[data-field="house-summary-person"]').options].map((option) => [option.value, option.textContent]));
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page);
    const data = await page.evaluate(({ title, expected }) => {
      const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot;
      return { value: shadow.querySelector(title).value,
        rooms: shadow.querySelector('[data-act="tab"][data-id="rooms"]').textContent,
        house: shadow.querySelector('[data-act="tab"][data-id="house"]').textContent,
        undo: shadow.querySelector('[data-act="history-undo"]').textContent,
        redo: shadow.querySelector('[data-act="history-redo"]').textContent,
        houseTitle: shadow.querySelector('[data-house-summary-editor] h3').textContent,
        titleCaption: shadow.querySelector('[data-house-summary-text="name"]').textContent,
        peopleCaption: shadow.querySelector('[data-house-summary-text="people"]').textContent,
        saveCaption: shadow.querySelector('[data-act="house-summary-save"]').textContent,
        ownedHelp: shadow.querySelector('[data-house-summary-text="peopleHelp"]').textContent,
        people: [...shadow.querySelector('[data-field="house-summary-person"]').options].map((option) => [option.value, option.textContent]),
        rawTitle: card._layout.house_summary.title, expected };
    }, { title, expected: words[language] });
    check(`${language} updates native tabs/history while retaining focused unfinished title`, await retained(page, title, 'editor-title', true)
      && await retained(page, '[data-act="tab"][data-id="rooms"]', 'rooms-tab') && data.value === 'User_Unfinished_Title_été'
      && data.rooms === words[language].rooms && data.house === words[language].house && data.undo === words[language].undo && data.redo === words[language].redo
      && equal(data.people, personOptions), data);
    check(`${language} translates actual House labels and help without translating a typed title or person name`,
      data.houseTitle === liveWords[language].house && data.titleCaption === liveWords[language].houseName
      && data.peopleCaption === liveWords[language].people && data.saveCaption === liveWords[language].houseSave
      && data.ownedHelp.includes(liveWords[language].houseHelp) && data.rawTitle === names.title, data);
    check(`${language} causes no draft commit, layout rewrite or device command`, (await snapshot(page)).commits === before.commits
      && (await snapshot(page)).calls.length === before.calls.length && data.rawTitle === names.title);
  }
  await screenshot(page, `localization-${mode}-es-editor.png`);
  await focus(page, '[data-act="house-summary-save"]'); await remember(page, '[data-act="house-summary-save"]', 'house-held-save');
  await page.keyboard.down('Space');
  try { await locale(page, 'de'); await locale(page, 'fr');
    check('language-only changes retain the exact eligible held House Save without a passive write',
      await retained(page, '[data-act="house-summary-save"]', 'house-held-save', true)
      && (await snapshot(page)).commits === before.commits); }
  finally { await page.keyboard.up('Space'); }
  await ready(page); let current = await snapshot(page);
  check('explicit native Save makes one layout history step without translating typed text', current.commits === before.commits + 1
    && current.names.title === 'User_Unfinished_Title_été' && current.history.undo && current.calls.length === before.calls.length, current.history);
  await focus(page, '[data-act="history-undo"]'); await remember(page, '[data-act="history-undo"]', 'undo'); const historyLabel = current.history.label;
  await locale(page, 'fr');
  const history = await page.evaluate(() => { const card = document.querySelector('taylors3d-card');
    return { text: card.shadowRoot.querySelector('[data-act="history-undo"]').textContent, title: card.shadowRoot.querySelector('[data-act="history-undo"]').title }; });
  check('translated history keeps the exact focused native button and original edit label', await retained(page, '[data-act="history-undo"]', 'undo', true)
    && history.text === words.fr.undo && history.title === `Annuler : ${historyLabel}`, history);
  await page.keyboard.press('Space'); await ready(page); current = await snapshot(page);
  check('native translated Undo restores original saved title exactly', current.names.title === names.title && current.history.redo && current.calls.length === before.calls.length);
  await keyboard(page, '[data-act="history-redo"]', 'Enter'); await ready(page); current = await snapshot(page);
  check('native translated Redo restores the literal saved draft exactly', current.names.title === 'User_Unfinished_Title_été'
    && current.calls.length === before.calls.length);
  await keyboard(page, '[data-act="tab"][data-id="data"]', 'Space'); await ready(page);
  await remember(page, 'input[data-field="import"]', 'json-file'); await focus(page, '[data-single-layout-text="export"]');
  await remember(page, '[data-single-layout-text="export"]', 'json-export');
  for (const language of ['de', 'fr', 'es', 'it-IT']) {
    await locale(page, language); const expected = words[language] || words.en;
    const captions = await page.evaluate(() => { const shadow = document.querySelector('taylors3d-card').shadowRoot;
      return { title: shadow.querySelector('[data-single-layout-text="title"]').textContent,
        import: shadow.querySelector('[data-single-layout-text="import"]').textContent,
        tab: shadow.querySelector('[data-act="tab"][data-id="data"]').textContent }; });
    check(`${language} labels Single-layout JSON honestly with the same native file/export nodes`, captions.title === expected.json
      && captions.import === expected.import && captions.tab === expected.data && await retained(page, 'input[data-field="import"]', 'json-file')
      && await retained(page, '[data-single-layout-text="export"]', 'json-export', true), captions);
  }
  await keyboard(page, '.toolbar .edit', 'Space'); await ready(page);
  check('localized Done returns to the actual saved House presentation without a service', !(await snapshot(page)).editing
    && (await snapshot(page)).calls.length === before.calls.length);
}

async function passiveState(page) {
  return page.evaluate(() => { const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
    return { layout: JSON.stringify(card._layout), config: JSON.stringify(card._config), states: JSON.stringify(card._hass.states),
      services: f.services.length, commits: f.commits, saves: f.saveCalls, configEvents: f.configEvents.length };
  });
}

const advancedHelp = {
  en: { security: 'Unlocking never means a door is open.', tracking: 'Editing changes this layout only;', cameras: 'This filters choices only.', model: 'These choices do not bake new shadows' },
  de: { security: 'Entriegelt bedeutet niemals offen.', tracking: 'Die Bearbeitung ändert nur dieses Layout;', cameras: 'Dies filtert nur die Auswahl.', model: 'Diese Optionen berechnen keine gebackenen Schatten' },
  fr: { security: 'Déverrouillé ne signifie jamais que la porte est ouverte.', tracking: 'L’édition modifie uniquement ce plan ;', cameras: 'Cela filtre uniquement les choix.', model: 'Ces options ne précalculent pas les ombres' },
  es: { security: 'Desbloquear nunca significa que la puerta esté abierta.', tracking: 'Editar solo cambia este diseño;', cameras: 'Esto solo filtra las opciones.', model: 'Estas opciones no precalculan sombras' },
};

async function advancedEditors(page, mode) {
  await locale(page, 'en'); await keyboard(page, nav('settings'), 'Enter'); await ready(page);
  const scenarios = [
    { tab: 'security', root: '[data-security-editor]', field: 'sec-label', value: 'User_Unsaved_Security_été', add: 'sec-add' },
    { tab: 'tracking', root: '[data-trk-editor]', field: 'trk-label', value: 'User_Unsaved_Tracking_été', add: 'trk-add' },
    { tab: 'cameras', root: '[data-cov-editor]', field: 'cov-heading', value: '137.5' },
    { tab: 'model', root: '[data-model-rendering-editor]', field: 'model-rendering-preset', value: 'authored' },
  ];
  for (const scenario of scenarios) {
    context = `actual advanced ${scenario.tab} draft`;
    await keyboard(page, `[data-act="tab"][data-id="${scenario.tab}"]`, 'Enter'); await ready(page);
    if (scenario.add) await keyboard(page, `[data-act="${scenario.add}"]`, 'Space');
    const selector = `[data-field="${scenario.field}"]`, key = `advanced-${scenario.tab}`;
    if (scenario.tab === 'model') {
      // A real native select key chooses a visual draft; Save remains separate.
      await keyboard(page, selector, 'Home'); await keyboard(page, selector, 'ArrowDown'); await keyboard(page, selector, 'ArrowDown');
    } else await type(page, selector, scenario.value);
    await remember(page, selector, key); await ready(page);
    const baseline = await passiveState(page);
    const raw = await page.evaluate(({ root, selector }) => { const card = document.querySelector('taylors3d-card'), panel = card.shadowRoot;
      return { value: panel.querySelector(selector).value,
        nativeEntities: [...panel.querySelectorAll(`${root} select option`)].filter((node) => node.value.includes('.'))
          .map((node) => [node.value, node.textContent]) };
    }, { root: scenario.root, selector });
    check(`${scenario.tab} native input creates only the explicit unsaved draft`, raw.value === scenario.value, raw);
    for (const language of ['de', 'fr', 'es', 'en', 'it-IT']) {
      await locale(page, language); await ready(page); const expected = extendedWords[language] || extendedWords.en;
      const expectedHelp = (advancedHelp[language] || advancedHelp.en)[scenario.tab];
      const actual = await page.evaluate(({ scenario, selector, expectedHelp }) => {
        const shadow = document.querySelector('taylors3d-card').shadowRoot, root = shadow.querySelector(scenario.root);
        const caption = (field) => shadow.querySelector(`[data-field="${field}"]`)?.closest('label')?.querySelector('[data-advanced-caption]')?.textContent.trim();
        const text = (query) => root?.querySelector(query)?.textContent.trim();
        return { title: text('h3'), value: shadow.querySelector(selector)?.value,
          label: caption(scenario.field), kind: caption('sec-kind'), contact: caption('sec-entity'),
          door: shadow.querySelector('[data-field="sec-kind"] option[value="door"]')?.textContent,
          appearance: text('h4:has([data-advanced-caption="advanced.tracking.appearance"])'),
          presence: text('[data-act="trk-section"][data-section="presence"]'),
          headingAria: shadow.querySelector('[data-field="cov-heading-slider"]')?.getAttribute('aria-label'),
          headingPlaceholder: shadow.querySelector('[data-field="cov-heading"]')?.getAttribute('placeholder'),
          authored: shadow.querySelector('[data-field="model-rendering-preset"] option[value="authored"]')?.textContent,
          saveShading: text('[data-act="model-rendering-save"]'),
          nativeEntities: [...(root?.querySelectorAll('select option') || [])].filter((node) => node.value.includes('.')).map((node) => [node.value, node.textContent]),
          localizedHelp: root?.textContent.includes(expectedHelp),
        };
      }, { scenario, selector, expectedHelp });
      const captions = scenario.tab === 'security' ? actual.title === expected.security && actual.label === expected.label
          && actual.kind === expected.kind && actual.door === expected.door && actual.contact === expected.contact
        : scenario.tab === 'tracking' ? actual.title === expected.tracking && actual.label === expected.trackLabel && actual.presence === expected.presence
          && actual.appearance === expected.appearance
          : scenario.tab === 'cameras' ? actual.title === expected.camera && actual.label === expected.heading
            && actual.headingAria === expected.headingAria && actual.headingPlaceholder === expected.headingPlaceholder
            : actual.title === expected.shading && actual.label === expected.display && actual.authored === expected.authored && actual.saveShading === expected.saveShading;
      check(`${language} updates representative ${scenario.tab} captions around the exact focused native draft`, captions
        && actual.value === scenario.value && await retained(page, selector, key, true), actual);
      check(`${language} ${scenario.tab} keeps raw entity names/IDs, translated guidance and zero passive writes`, equal(await passiveState(page), baseline)
        && equal(actual.nativeEntities, raw.nativeEntities) && actual.localizedHelp, { raw: actual.nativeEntities, localizedHelp: actual.localizedHelp });
    }
    // Measure the real card's 320px stage; CSS and focus belong to the app.
    await narrowStage(page);
    await ready(page); await locale(page, 'es'); await focus(page, selector);
    const bounds = await page.evaluate((selector) => { const card = document.querySelector('taylors3d-card'), node = card.shadowRoot.querySelector(selector);
      const box = node.getBoundingClientRect(), stage = card._stage.getBoundingClientRect(), label = node.closest('label');
      return { stage: stage.width, left: box.left, right: box.right, stageLeft: stage.left, stageRight: stage.right,
        height: box.height, width: box.width, captionClipped: label.scrollWidth > label.clientWidth + 1,
        focused: card.shadowRoot.activeElement === node, outline: getComputedStyle(node).outlineStyle };
    }, selector);
    check(`Spanish ${scenario.tab} draft remains reachable and readable at a real 320px stage`, Math.abs(bounds.stage - 320) < .1
      && bounds.left >= bounds.stageLeft - 1 && bounds.right <= bounds.stageRight + 1 && bounds.width >= 44 && bounds.height >= 43
      && !bounds.captionClipped && bounds.focused && bounds.outline !== 'none', bounds);
    await screenshot(page, `localization-${mode}-es-320-${scenario.tab}.png`);
    await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = '1180px'; }); await ready(page);
  }
  await keyboard(page, '.toolbar .edit', 'Space'); await ready(page);
}

async function narrowOwned(page, selector, mode, name) {
  await narrowStage(page);
  await ready(page);
  const bounds = await page.evaluate((selector) => {
    const card = document.querySelector('taylors3d-card'), owned = card.shadowRoot.querySelector(selector), stage = card._stage.getBoundingClientRect();
    const targets = [...owned.querySelectorAll('button,select,input:not([type="checkbox"])')].filter((node) => node.getClientRects().length && !node.hidden)
      .map((node) => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, right: r.right,
        text: node.getAttribute('aria-label') || node.textContent || node.value }; });
    return { stage: stage.width, left: stage.left, right: stage.right, targets,
      clipped: [...owned.querySelectorAll('label,p,h3,h4,legend')].filter((node) => node.getClientRects().length && node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.textContent) };
  }, selector);
  check(`${name} translated controls remain reachable at an actual320px stage with44px targets and no horizontal clipping`,
    Math.abs(bounds.stage - 320) < .1 && bounds.targets.length > 0 && bounds.clipped.length === 0
    && bounds.targets.every((target) => target.width >= 44 && target.height >= 44 && target.left >= bounds.left - 1 && target.right <= bounds.right + 1), bounds);
  await screenshot(page, `localization-${mode}-es-320-${name}.png`);
  await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = '1180px'; }); await ready(page);
}

async function extraEditorPassiveState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), f = window.localizationFixture, renderer = card._view.renderer;
    return { history: [card._history.current, card._history.size, card._history.canUndo, card._history.canRedo, card._history.grouping],
      canvases: card.shadowRoot.querySelectorAll('canvas').length, rendererSame: renderer === f.renderer, sceneSame: card._scene === f.scene,
      gpu: { ...renderer.info.memory, programs: renderer.info.programs.length },
      savedPreview: card._scenePreviewController.active, editorPreview: card._edit._scenePreviewEditor.controller.active,
      editorToken: card._edit._scenePreviewEditor.previewToken, furniturePreview: card._furnitureCoordinator?.preview ?? null,
      furnitureReads: [...f.extraLibraryReads], cameraConfigs: f.cameraConfigs.length, cameraStarts: f.cameraStarts, cameraStops: f.cameraStops };
  });
}

async function extraEditorsScenario(page, mode) {
  await locale(page, 'en'); await page.evaluate(installExtraEditorFixture, { entities, names }); await ready(page);
  await keyboard(page, nav('settings'), 'Enter'); await ready(page);
  const scenarios = [
    { id: 'scene', tab: 'scenes', root: '[data-scene-preview-editor]', editor: '_scenePreviewEditor', prefix: 'scene-preview-',
      field: 'label', value: 'User_<b>Unsaved_été', select: 'light-state', caption: 'scene.label', help: 'scene.actionHelp', selected: 'on' },
    { id: 'idle', tab: 'idle', root: '[data-ambient-idle-editor]', editor: '_ambientIdleEditor', prefix: 'ambient-idle-',
      field: 'idle_seconds', value: '121', select: 'dim.when', caption: 'idle.delay', help: 'idle.rotationHelp', selected: 'sun' },
    { id: 'wall', tab: 'model', root: '[data-wall-presentation-editor]', editor: '_wallPresentationEditor', prefix: 'wall-presentation-',
      field: 'opacity', value: '23', select: 'mode', caption: 'wall.opacity', help: 'wall.help', selected: 'fade' },
    { id: 'floor', tab: 'model', root: '[data-floor-presentation-editor]', editor: '_floorPresentationEditor', prefix: 'floor-presentation-',
      field: 'gap_m', value: '3.37', select: 'mode', caption: 'floor.spacing', help: 'floor.help', selected: 'horizontal' },
    { id: 'furniture', tab: 'furniture', root: '[data-furniture-editor]', editor: '_furnitureEditor', prefix: 'furniture-',
      field: 'x', value: '', select: 'pack_id', caption: 'furniture.x', help: 'furniture.previewHelp', selected: 'a'.repeat(64) },
  ];
  for (const scenario of scenarios) {
    context = `actual extra ${scenario.id} native editor`;
    await locale(page, 'en'); await keyboard(page, `[data-act="tab"][data-id="${scenario.tab}"]`, 'Enter'); await ready(page);
    if (scenario.id === 'furniture') {
      await keyboard(page, '[data-act="library-refresh"]', 'Space');
      await page.waitForFunction(() => document.querySelector('taylors3d-card').furnitureCatalogue().status === 'ready', { timeout: 15000 });
      await ready(page); await keyboard(page, '[data-act="furniture-repair-instance"]', 'Space'); await ready(page);
    }
    const selector = `[data-field="${scenario.prefix}${scenario.field}"]`, select = `[data-field="${scenario.prefix}${scenario.select}"]`;
    await type(page, selector, scenario.value);
    // Ctrl+A with an empty type string selects without deleting. Backspace is
    // an actual native edit, leaving a deliberate unfinished numeric draft.
    if (scenario.value === '') await keyboard(page, selector, 'Backspace');
    await remember(page, selector, `extra-${scenario.id}-input`);
    await remember(page, select, `extra-${scenario.id}-select`); await ready(page);
    await page.evaluate((scenario) => {
      const card = document.querySelector('taylors3d-card'), f = window.localizationFixture, root = card.shadowRoot.querySelector(scenario.root);
      f.extraEditorNodes = { root, title: root.querySelector('h3'),
        caption: root.querySelector(`[data-editor-extra-caption="${scenario.caption}"]`),
        options: [...root.querySelectorAll('select')].map((select) => ({ select, options: [...select.options], values: [...select.options].map((option) => option.value) })) };
    }, scenario);
    const baseline = await passiveState(page), lifecycle = await extraEditorPassiveState(page);
    const draft = await page.evaluate((scenario) => {
      const editor = document.querySelector('taylors3d-card')._edit[scenario.editor];
      return { value: JSON.stringify(editor.draft), generation: editor._generation ?? null, epoch: editor._epoch ?? null };
    }, scenario);
    check(`${scenario.id} native keyboard input creates a dirty local draft without preview pin or new GPU`,
      await page.evaluate((scenario) => document.querySelector('taylors3d-card')._edit[scenario.editor].dirty, scenario)
      && lifecycle.canvases === 1 && lifecycle.rendererSame && lifecycle.sceneSame && lifecycle.savedPreview === null
      && lifecycle.editorPreview === null && lifecycle.editorToken === null && lifecycle.furniturePreview === null, lifecycle);
    // Focus the typed field, then the actual native select. Both paths exercise
    // Root's preservation branch; no editor/render callback is replaced.
    for (const focused of [selector, select]) {
      await focus(page, focused);
      for (const language of ['de', 'fr', 'es', 'en']) {
        await locale(page, language); await ready(page);
        const actual = await page.evaluate(({ scenario, selector, select }) => {
          const card = document.querySelector('taylors3d-card'), f = window.localizationFixture, root = card.shadowRoot.querySelector(scenario.root), editor = card._edit[scenario.editor];
          const nodes = f.extraEditorNodes, choice = root.querySelector(select);
          return { title: root.querySelector('h3').textContent.trim(),
            caption: root.querySelector(`[data-editor-extra-caption="${scenario.caption}"]`).textContent,
            help: root.querySelector(`[data-editor-extra-caption="${scenario.help}"]`).textContent,
            value: root.querySelector(selector).value, selected: choice.value, option: choice.selectedOptions[0]?.textContent,
            draft: JSON.stringify(editor.draft), dirty: editor.dirty, generation: editor._generation ?? null, epoch: editor._epoch ?? null,
            rootSame: root === nodes.root, titleSame: root.querySelector('h3') === nodes.title,
            captionSame: root.querySelector(`[data-editor-extra-caption="${scenario.caption}"]`) === nodes.caption,
            optionsSame: nodes.options.every(({ select, options, values }) => select.isConnected && options.length === select.options.length
              && options.every((option, index) => select.options[index] === option && option.value === values[index])),
            literalChoices: [...root.querySelectorAll('option')].filter((option) => option.textContent.includes('User_')).map((option) => [option.value, option.textContent]),
            literalReading: root.querySelector('[data-scene-preview-reading]')?.textContent,
            status: root.querySelector('[data-furniture-status]')?.textContent,
            asset: root.querySelector('[data-furniture-asset]')?.textContent,
            savedFloor: editor.draft?.instances?.[0]?.floor_id,
            floorChoice: root.querySelector('[data-field="furniture-floor_id"]')?.value,
            floorChoiceText: root.querySelector('[data-field="furniture-floor_id"]')?.selectedOptions[0]?.textContent,
            floorChoiceDisabled: root.querySelector('[data-field="furniture-floor_id"]')?.selectedOptions[0]?.disabled,
            saveDisabled: root.querySelector(`[data-act="${scenario.prefix}save"]`).disabled,
            injectedMarkup: [...root.querySelectorAll('b,i')].some((node) => node.textContent.includes('User_')),
          };
        }, { scenario, selector, select });
        const expected = extraEditorWords[language][scenario.id];
        check(`${language} ${scenario.id} captions/help/native option translate around the same focused ${focused === selector ? 'input' : 'select'}`,
          actual.title === expected[0] && actual.caption === expected[1] && actual.help.includes(expected[2]) && actual.option === expected[3]
          && actual.value === scenario.value && actual.selected === scenario.selected && actual.dirty && actual.draft === draft.value
          && actual.generation === draft.generation && actual.epoch === draft.epoch && actual.rootSame && actual.titleSame && actual.captionSame && actual.optionsSame
          && await retained(page, selector, `extra-${scenario.id}-input`, focused === selector)
          && await retained(page, select, `extra-${scenario.id}-select`, focused === select), actual);
        const raw = scenario.id === 'scene' ? actual.literalChoices.some(([id, name]) => id === entities.scene
            && name === names.scene + ' (' + extraEditorWords[language].sceneNoTime + ')')
            && actual.literalChoices.some(([id, name]) => id === entities.lamp && name === names.lamp) && actual.literalReading.includes('HA_STATE:on')
          : scenario.id === 'floor' ? actual.literalChoices.some(([id, name]) => id === 'locale_ground' && name.includes(names.ground))
            && actual.literalChoices.some(([id, name]) => id === 'locale_upper' && name.includes(names.upper))
            : scenario.id === 'furniture' ? actual.literalChoices.some(([id, name]) => id === 'a'.repeat(64) && name === 'User_<b>Pack_été')
              && actual.literalChoices.some(([id, name]) => id === 'user_chair' && name === 'User_<b>Chair_été')
              && actual.savedFloor === 'user_missing_floor' && actual.floorChoice === '' && actual.floorChoiceDisabled
              && actual.floorChoiceText.includes('user_missing_floor') && actual.asset === 'b'.repeat(64) && actual.saveDisabled
              && actual.status.includes(extraEditorWords[language].missingFloor) : true;
        check(`${language} ${scenario.id} keeps literal user data, saved identities/readings, zero passive writes/services/history and one existing GPU`,
          raw && !actual.injectedMarkup && equal(await passiveState(page), baseline) && equal(await extraEditorPassiveState(page), lifecycle));
      }
    }
    await focus(page, selector); await locale(page, 'es'); await narrowOwned(page, scenario.root, mode, `extra-${scenario.id}-editor`);
    await narrowStage(page);
    await ready(page);
    const narrow = await page.evaluate(({ root, selector }) => {
      const card = document.querySelector('taylors3d-card'), input = card.shadowRoot.querySelector(selector), owned = card.shadowRoot.querySelector(root);
      const stage = card._stage.getBoundingClientRect();
      return { stage: stage.width, focused: card.shadowRoot.activeElement === input, outline: getComputedStyle(input).outlineStyle,
        checks: [...owned.querySelectorAll('input[type="checkbox"]')].map((node) => {
          // The native associated label is the full checkbox click target; its
          // smaller glyph is not the entire clickable area.
          const label = node.closest('label'), rect = label.getBoundingClientRect();
          return { width: rect.width, height: rect.height, native: label.control === node,
            inside: rect.left >= stage.left - 1 && rect.right <= stage.right + 1 };
        }) };
    }, { root: scenario.root, selector });
    check(`${scenario.id} actual320px draft keeps native focus/outline and every associated checkbox label has a44px target`,
      Math.abs(narrow.stage - 320) < .1 && narrow.focused && narrow.outline !== 'none'
      && narrow.checks.every(({ width, height, native, inside }) => width >= 44 && height >= 44 && native && inside)
      && await retained(page, selector, `extra-${scenario.id}-input`, true), narrow);
    await page.evaluate(() => { document.querySelector('taylors3d-card').style.width = '1180px'; }); await ready(page);
    await keyboard(page, `[data-act="${scenario.prefix}cancel"]`, 'Space'); await ready(page);
    check(`${scenario.id} native Cancel discards only the draft without saving, device action, history or preview leaks`,
      equal(await passiveState(page), baseline) && equal(await extraEditorPassiveState(page), lifecycle)
      && await page.evaluate((scenario) => !document.querySelector('taylors3d-card')._edit[scenario.editor].dirty, scenario));
  }
  const reads = await page.evaluate(() => window.localizationFixture.extraLibraryReads);
  check('extra Furniture fixture performs only explicit anonymous catalogue reads through the actual client; no asset/ZIP/import/write request',
    reads.length > 0 && reads.every((request) => request.url === '/api/taylors3d/furniture' && request.method === 'GET'), reads);
  await keyboard(page, '.toolbar .edit', 'Space'); await ready(page);
}

async function environmentAndHouse(page, mode) {
  await locale(page, 'en'); await keyboard(page, nav('settings'), 'Enter'); await ready(page);
  await keyboard(page, '[data-act="tab"][data-id="environment"]', 'Enter'); await ready(page);
  const intensity = '[data-field="env-weather-intensity"]', source = '[data-field="env-weather-entity"]';
  await keyboard(page, source, 'End'); await type(page, intensity, '0.37'); await remember(page, intensity, 'weather-intensity');
  await remember(page, source, 'weather-source');
  await page.evaluate(() => { const f = window.localizationFixture, shadow = document.querySelector('taylors3d-card').shadowRoot;
    f.weatherSourceOption = shadow.querySelector('[data-field="env-weather-entity"]').selectedOptions[0];
    f.weatherQualityOption = shadow.querySelector('[data-field="env-weather-quality"]').selectedOptions[0]; });
  const baseline = await passiveState(page);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page);
    const data = await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot, f = window.localizationFixture;
      const select = shadow.querySelector('[data-field="env-weather-entity"]'), quality = shadow.querySelector('[data-field="env-weather-quality"]');
      return { title: shadow.querySelector('[data-env-weather-editor] h3').textContent,
        intensity: shadow.querySelector('[data-env-weather-text="intensity"]').textContent,
        help: shadow.querySelector('[data-env-weather-text="intensityHelp"]').textContent,
        value: shadow.querySelector('[data-field="env-weather-intensity"]').value, source: select.value, sourceName: select.selectedOptions[0].textContent,
        sourceOptionSame: select.selectedOptions[0] === f.weatherSourceOption,
        quality: quality.value, qualityText: quality.selectedOptions[0].textContent, qualityOptionSame: quality.selectedOptions[0] === f.weatherQualityOption,
        draft: card._edit._weatherEditor.draft, renderers: shadow.querySelectorAll('canvas').length,
        rendererSame: card._view.renderer === f.renderer, sceneSame: card._scene === f.scene };
    });
    check(`${language} Weather captions/help update around the same focused unsaved decimal draft and native options`,
      data.title === liveWords[language].weather && data.intensity === liveWords[language].intensity && data.help.includes(liveWords[language].weatherHelp)
      && data.quality === 'low' && data.qualityText === liveWords[language].quality && data.qualityOptionSame && data.sourceOptionSame
      && data.value === '0.37' && data.draft.intensity === '0.37' && data.source === entities.weather && data.sourceName === 'User_Weather_été'
      && await retained(page, intensity, 'weather-intensity', true) && await retained(page, source, 'weather-source'), data);
    check(`${language} Weather language refresh keeps raw layout/readings, no passive writes/actions and the one existing renderer`,
      equal(await passiveState(page), baseline) && data.renderers === 1 && data.rendererSame && data.sceneSame);
  }
  await locale(page, 'es'); await narrowOwned(page, '[data-env-weather-editor]', mode, 'weather-editor');
  await type(page, intensity, ''); await keyboard(page, '[data-act="env-weather-save"]', 'Space'); await focus(page, intensity);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language);
    check(`${language} translates the visible Weather invalid-draft warning without saving or silently repairing the blank number`,
      await page.evaluate(({ expected, baseline }) => { const card = document.querySelector('taylors3d-card');
        return card.shadowRoot.querySelector('[data-env-weather-preview]').textContent.includes(expected)
          && card._edit._weatherEditor.draft.intensity === '' && window.localizationFixture.commits === baseline.commits
          && window.localizationFixture.services.length === baseline.services;
      }, { expected: liveWords[language].weatherError, baseline }));
  }
  await keyboard(page, '[data-act="env-weather-cancel"]', 'Space'); await keyboard(page, '[data-act="tab"][data-id="house"]', 'Enter'); await ready(page);
  await type(page, '[data-field="house-summary-title"]', 'User_Context_Draft_été');
  await locale(page, 'es'); await narrowOwned(page, '[data-house-summary-editor]', mode, 'house-editor');
  const before = await passiveState(page);
  await focus(page, '[data-act="house-summary-save"]'); await page.keyboard.down('Space');
  try { await patch(page, { connected: false, language: 'de' }); await patch(page, { connected: true, language: 'es' }); }
  finally { await page.keyboard.up('Space'); }
  const held = await page.evaluate(() => { const card = document.querySelector('taylors3d-card');
    return { draft: card._edit._houseSummaryEditor.draft.title, stale: card._edit._houseSummaryEditor.stale,
      saved: card._layout.house_summary.title, disabled: card.shadowRoot.querySelector('[data-act="house-summary-save"]').disabled }; });
  check('House language/session recovery retains the unfinished title but cannot revive an old held Save',
    held.draft === 'User_Context_Draft_été' && held.stale && held.disabled && equal(await passiveState(page), before), held);
  await keyboard(page, '[data-act="house-summary-cancel"]', 'Space'); await keyboard(page, '.toolbar .edit', 'Space'); await ready(page);
}

async function liveSnapshot(page) {
  return page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), f = window.localizationFixture, feed = card._devicePopup.cameraFeed, bar = card._scenePreviewBar;
    const text = (selector) => feed.el?.querySelector(selector)?.textContent;
    return { camera: feed.el ? { aria: feed.el.getAttribute('aria-label'), title: text('.t3d-camera-title'), help: text('.t3d-camera-help'),
      status: text('.t3d-camera-status'), close: text('[data-action="close-camera"]'), retry: text('[data-action="retry-camera"]'),
      controls: text('[data-action="camera-more-info"]'), native: !!feed.nativeCard, muted: feed.nativeCard?.shadowRoot.querySelector('video').muted } : null,
    scenes: { title: bar.heading.textContent, aria: bar.el.getAttribute('aria-label'), stop: bar.stopButton.textContent,
      preview: bar.el.querySelector('[data-scene-action="preview"]')?.textContent,
      activate: bar.el.querySelector('[data-scene-action="activate"]')?.textContent,
      status: bar.status.textContent, pressed: bar.el.querySelector('[data-scene-action="preview"]')?.getAttribute('aria-pressed') },
    services: f.services, commits: f.commits, saves: f.saveCalls, info: f.info,
    cameraConfigs: f.cameraConfigs, starts: f.cameraStarts, stops: f.cameraStops,
    cameraRequests: f.websocket.filter((message) => message.type === 'camera/capabilities').length,
    rendererSame: card._view.renderer === f.renderer, sceneSame: card._scene === f.scene, canvases: card.shadowRoot.querySelectorAll('canvas').length,
    resources: { ...card._view.renderer.info.memory }, frames: card._view.stats.frames };
  });
}

async function cameraLanguages(page, mode) {
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); card.setConfig({ ...card._config, control_panel: 'right' }); });
  await locale(page, 'en'); await keyboard(page, nav('security'), 'Space'); await ready(page);
  const cameraButton = `${row(entities.camera)} [data-action="camera-view"]`, close = '[data-action="close-camera"]';
  await keyboard(page, cameraButton, 'Enter');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status === 'ready', { timeout: 15000 }); await ready(page);
  await focus(page, close); await remember(page, close, 'live-camera-close');
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
    f.cameraNative = card._devicePopup.cameraFeed.nativeCard; f.cameraSection = card._devicePopup.cameraFeed.el; });
  const baseline = await passiveState(page), native = await liveSnapshot(page);
  check('native camera helper receives only the exact simulated saved HA camera configuration', equal(native.cameraConfigs, [{
    type: 'picture-entity', entity: entities.camera, camera_view: 'live', show_name: false, show_state: false,
    fit_mode: 'contain', tap_action: { action: 'none' },
  }]) && native.starts === 1 && native.stops === 0 && native.camera.muted, native.cameraConfigs);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page); const current = await liveSnapshot(page);
    check(`${language} camera captions/help retain the literal HA camera name and exact focused player controls`,
      current.camera.aria === liveWords[language].camera && current.camera.close === liveWords[language].close
      && current.camera.retry === liveWords[language].retry && current.camera.status === liveWords[language].stream
      && current.camera.help.includes(liveWords[language].cameraHelp) && current.camera.title === names.camera
      && current.camera.controls === (language === 'es' ? 'Todos los controles' : words[language].controls)
      && await retained(page, close, 'live-camera-close', true)
      && await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
        return card._devicePopup.cameraFeed.nativeCard === f.cameraNative && card._devicePopup.cameraFeed.el === f.cameraSection; }), current.camera);
    check(`${language} camera language changes neither restart playback nor issue passive actions/writes/new GPU resources`,
      equal(await passiveState(page), baseline) && current.starts === native.starts && current.stops === native.stops
      && current.cameraRequests === native.cameraRequests && current.cameraConfigs.length === 1
      && current.rendererSame && current.sceneSame && current.canvases === 1 && equal(current.resources, native.resources)
      && current.frames === native.frames, current);
  }
  await locale(page, 'es'); await narrowOwned(page, '.taylors3d-camera-feed', mode, 'camera-player');
  await keyboard(page, close, 'Space'); let current = await liveSnapshot(page);
  check('translated native Close removes the actual simulated player exactly once without a camera service',
    !current.camera && current.stops === 1 && current.services.length === native.services.length);
  await page.evaluate(() => { window.localizationFixture.deferNextCamera = true; }); await keyboard(page, cameraButton, 'Enter');
  await focus(page, close); await remember(page, close, 'pending-camera-close'); const beforePending = await liveSnapshot(page);
  await locale(page, 'de'); await locale(page, 'fr'); current = await liveSnapshot(page);
  check('a pending camera lookup changes its current language without restarting the request or replacing focused controls',
    current.camera.status === liveWords.fr.opening && current.cameraRequests === beforePending.cameraRequests
    && await retained(page, close, 'pending-camera-close', true) && current.cameraConfigs.length === 1);
  await page.evaluate(() => { const f = window.localizationFixture; f.pendingCamera.resolve({ frontend_stream_types: ['hls'] }); f.pendingCamera = null; });
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status === 'ready', { timeout: 15000 }); await flush(page);
  current = await liveSnapshot(page);
  check('the owned pending camera result opens once using the latest French language and original source',
    current.camera.status === liveWords.fr.stream && current.cameraConfigs.length === 2 && current.cameraConfigs.at(-1).entity === entities.camera);
  await keyboard(page, close, 'Space');
  await page.evaluate(() => { window.localizationFixture.deferNextCamera = true; }); await keyboard(page, cameraButton, 'Enter');
  const oldRequest = await liveSnapshot(page);
  await patch(page, { connected: false, language: 'de' }); await patch(page, { connected: true, language: 'es' });
  await page.evaluate(() => { const f = window.localizationFixture; f.pendingCamera.resolve({ frontend_stream_types: ['hls'] }); f.pendingCamera = null; }); await flush(page);
  current = await liveSnapshot(page);
  check('session recovery and language changes cannot attach an old pending camera player or send an automatic retry',
    !current.camera && current.cameraConfigs.length === oldRequest.cameraConfigs.length && current.cameraRequests === oldRequest.cameraRequests
    && current.services.length === oldRequest.services.length);
  await keyboard(page, nav('security'), 'Space'); await keyboard(page, cameraButton, 'Enter');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status === 'ready', { timeout: 15000 });
  await page.evaluate((entity) => { const card = document.querySelector('taylors3d-card');
    card.hass = { ...card._hass, states: { ...card._hass.states, [entity]: { ...card._hass.states[entity], state: 'unknown' } } };
  }, entities.camera); await flush(page); await focus(page, close); await remember(page, close, 'blocked-camera-close');
  const blocked = await liveSnapshot(page);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); current = await liveSnapshot(page);
    check(`${language} localizes an unavailable current camera reason without reviving playback or fetching another stream`,
      current.camera.status === liveWords[language].unknown && !current.camera.native && current.cameraRequests === blocked.cameraRequests
      && await retained(page, close, 'blocked-camera-close', true), current.camera);
  }
  await page.evaluate((entity) => { const card = document.querySelector('taylors3d-card');
    card.hass = { ...card._hass, states: { ...card._hass.states, [entity]: { ...card._hass.states[entity], state: 'idle' } } };
  }, entities.camera); await flush(page); await locale(page, 'es'); await keyboard(page, '[data-action="retry-camera"]', 'Space');
  await page.waitForFunction(() => document.querySelector('taylors3d-card')._devicePopup.cameraFeed.status === 'ready', { timeout: 15000 });
  const infoBefore = (await liveSnapshot(page)).info.length; await keyboard(page, '[data-action="camera-more-info"]', 'Enter'); await ready(page); current = await liveSnapshot(page);
  check('a fresh translated Retry/All-controls gesture opens only the original camera info and cleans the player',
    !current.camera && current.info.length === infoBefore + 1 && current.info.at(-1) === entities.camera
    && current.services.length === native.services.length && current.starts === current.stops, current.info);
}

async function sceneLanguages(page, mode) {
  await locale(page, 'en');
  await page.evaluate(({ entities, names }) => {
    const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
    f.originalSceneSettings = card._layout.scene_previews;
    // This explicit fixture setup supplies a saved mapping; the real card still
    // owns preview, held gestures and one separately requested HA action.
    card._layout = { ...card._layout, scene_previews: { enabled: true, items: [{ id: 'locale_saved_scene', label: names.scene,
      scene_entity: entities.scene, lights: [{ entity: entities.lamp, state: 'on', brightness: 200, color: { mode: 'rgb', rgb: [0, 0, 255] } }] }] } };
    card._syncScenePreviews();
  }, { entities, names }); await ready(page);
  const preview = '[data-scene-action="preview"][data-scene-id="locale_saved_scene"]',
    activate = '[data-scene-action="activate"][data-scene-id="locale_saved_scene"]', stop = '[data-scene-action="stop"]';
  await keyboard(page, preview, 'Space'); await focus(page, stop); await remember(page, stop, 'scene-stop'); await remember(page, preview, 'scene-preview');
  await remember(page, activate, 'scene-activate');
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'); window.localizationFixture.sceneToken = card._scenePreviewController.active.token; });
  await ready(page); const baseline = await passiveState(page), pinned = await liveSnapshot(page);
  for (const language of ['de', 'fr', 'es', 'en']) {
    await locale(page, language); await ready(page); const current = await liveSnapshot(page);
    check(`${language} saved scene captions keep the literal saved name and the same focused pinned preview`,
      current.scenes.title === liveWords[language].scenes && current.scenes.aria === liveWords[language].sceneAria
      && current.scenes.activate === liveWords[language].activate && current.scenes.stop === liveWords[language].stop
      && current.scenes.preview === liveWords[language].preview && current.scenes.status === liveWords[language].pinned && current.scenes.pressed === 'true'
      && await retained(page, stop, 'scene-stop', true) && await retained(page, preview, 'scene-preview') && await retained(page, activate, 'scene-activate')
      && await page.evaluate(() => { const card = document.querySelector('taylors3d-card');
        return card._scenePreviewController.active?.token === window.localizationFixture.sceneToken && !card.shadowRoot.querySelector('[data-scene-preview-bar] i'); }), current.scenes);
    check(`${language} pinned preview language refresh keeps actual HA readings, sends no command/write and creates no new GPU work`,
      equal(await passiveState(page), baseline) && current.rendererSame && current.sceneSame && current.canvases === 1
      && equal(current.resources, pinned.resources) && current.frames === pinned.frames);
  }
  await locale(page, 'es'); await narrowOwned(page, '[data-scene-preview-bar]', mode, 'saved-scenes');
  await focus(page, activate); await page.keyboard.down('Space');
  try { await locale(page, 'de'); await locale(page, 'fr');
    check('a translated held saved-scene Activate remains the exact eligible native button with no passive action',
      await retained(page, activate, 'scene-activate', true) && (await liveSnapshot(page)).services.length === baseline.services); }
  finally { await page.keyboard.up('Space'); }
  await flush(page); let current = await liveSnapshot(page);
  check('releasing the current translated scene gesture sends exactly one original scene action and keeps raw scene/light state',
    current.services.length === baseline.services + 1 && equal(current.services.at(-1), ['scene', 'turn_on', { entity_id: entities.scene }])
    && current.scenes.status === liveWords.fr.activated
    && await page.evaluate(({ entities }) => { const card = document.querySelector('taylors3d-card');
      return card._hass.states[entities.scene].state === 'unknown' && card._hass.states[entities.lamp].attributes.brightness === 128
        && !card._scenePreviewController.active && !card._lightPreview; }, { entities }), current.scenes);
  for (const kind of ['connection', 'account', 'role', 'availability']) {
    const calls = current.services.length; await focus(page, activate); await page.keyboard.down('Space');
    try {
      await page.evaluate(({ kind, entity }) => { const card = document.querySelector('taylors3d-card'), hass = card._hass;
        const account = hass.user.id, role = hass.user.is_admin, state = hass.states[entity].state;
        if (kind === 'connection') hass.connection.connected = false;
        if (kind === 'account') hass.user.id = 'locale-other-user';
        if (kind === 'role') hass.user.is_admin = !role;
        if (kind === 'availability') hass.states[entity].state = 'unavailable';
        hass.locale.language = 'de'; card.hass = hass;
        if (kind === 'connection') hass.connection.connected = true;
        if (kind === 'account') hass.user.id = account;
        if (kind === 'role') hass.user.is_admin = role;
        if (kind === 'availability') hass.states[entity].state = state;
        hass.locale.language = 'es'; card.hass = hass;
      }, { kind, entity: entities.scene }); await flush(page);
    } finally { await page.keyboard.up('Space'); }
    await flush(page); current = await liveSnapshot(page);
    check(`language and synchronous ${kind} recovery cannot revive an old held scene action before the coalesced update`, current.services.length === calls);
  }
  const count = current.services.length;
  await page.evaluate(() => { window.localizationFixture.deferNext = true; }); await keyboard(page, activate, 'Space');
  await locale(page, 'es'); current = await liveSnapshot(page);
  check('a fresh pending scene action updates to current Spanish once without altering source labels or repeating its request',
    current.services.length === count + 1 && current.scenes.status === liveWords.es.activating
    && equal(current.services.at(-1), ['scene', 'turn_on', { entity_id: entities.scene }]), current.scenes);
  await page.evaluate(() => { const f = window.localizationFixture; f.pending.reject(new Error('<USER_SCENE_ERROR_été>')); f.pending = null; });
  await flush(page); await locale(page, 'fr'); current = await liveSnapshot(page);
  check('a current scene error remains literal escaped HA text across language changes', current.scenes.status === '<USER_SCENE_ERROR_été>'
    && await page.evaluate(() => !document.querySelector('taylors3d-card').shadowRoot.querySelector('user_scene_error_été')));
  await page.evaluate(() => { window.localizationFixture.deferNext = true; }); await keyboard(page, activate, 'Space');
  const pendingCalls = (await liveSnapshot(page)).services.length;
  // The request was already sent. Recovery may allow a fresh gesture later, but
  // cannot turn its old success/error into current feedback for the recovered UI.
  await patch(page, { connected: false, language: 'de' }); await patch(page, { connected: true, language: 'es' });
  await page.evaluate(() => { const f = window.localizationFixture; f.pending.reject(new Error('<OLD_SESSION_SCENE_ERROR_été>')); f.pending = null; });
  await flush(page); current = await liveSnapshot(page);
  check('a late pending scene result stays fenced after language and connection loss/recovery without undoing the sent HA command',
    current.services.length === pendingCalls && current.scenes.status === liveWords.es.chooseScene
    && !current.scenes.status.includes('OLD_SESSION') && current.commits === pinned.commits && current.saves === pinned.saves, current.scenes);
  await screenshot(page, `localization-${mode}-es-scene-recovery.png`);
  await page.evaluate(() => { const card = document.querySelector('taylors3d-card'), f = window.localizationFixture;
    card._layout = { ...card._layout, scene_previews: f.originalSceneSettings }; card._syncScenePreviews(); }); await ready(page);
}

async function formControl(page, selector, callback) {
  context = `actual card-editor native ${selector}`;
  const element = await page.$(`#locale-form-host ${selector}`);
  if (!element) throw new Error(`Missing actual card-editor control ${selector}`);
  try { await element.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'nearest' })); await callback(element); }
  finally { await element.dispose(); }
  await flush(page);
}

async function cardEditor(page, mode) {
  context = 'actual card editor in explicitly simulated minimal HA form host';
  await locale(page, 'en');
  await page.evaluate((names) => {
    const card = document.querySelector('taylors3d-card'), f = window.localizationFixture, host = document.querySelector('#locale-form-host');
    host.hidden = false; const editor = card.constructor.getConfigElement(); f.cardEditor = editor; host.append(editor);
    editor.setConfig({ type: 'custom:taylors3d-card', height: '680px', view_id: 'raw-view_id-été', device_tap_action: 'popup',
      model: '/local/User_Model_été.glb', model_position: [1, 2, 3], model_opacity: .4,
      views: { 'raw-view_id-été': { label: names.importedView, extension: [false, null, 'User_Raw_été'] } },
      arbitrary_option: { untouched: 'User_Extension_été' }, model_rendering: { shadows: 'off', lamps: 'off', extra: 'User_Raw_Shading_été' } });
    editor.hass = card._hass;
    // These proposed config events are observed only. There is no HA dashboard
    // save handler and they are not silently applied to the rendered card.
    editor.addEventListener('config-changed', (event) => f.configEvents.push(structuredClone(event.detail.config)));
    f.formRaw = JSON.stringify(editor._config);
  }, names);
  const field = '[data-native-field="view_id"]';
  await formControl(page, field, async (element) => { await element.focus(); await page.keyboard.down('Control');
    try { await page.keyboard.press('KeyA'); } finally { await page.keyboard.up('Control'); }
    await page.keyboard.type('User_Unfinished_View_ID_été'); });
  await page.evaluate((field) => { const f = window.localizationFixture; f.formField = document.querySelector(`#locale-form-host ${field}`); }, field);
  const baseline = await passiveState(page);
  for (const language of ['de', 'fr', 'es', 'en', 'it-IT']) {
    await locale(page, language); const expected = extendedWords[language] || extendedWords.en;
    const actual = await page.evaluate(({ field, names }) => {
      const f = window.localizationFixture, editor = f.cardEditor, host = document.querySelector('#locale-form-host'), node = host.querySelector(field);
      const flatten = (schema) => schema.flatMap((item) => item.schema ? flatten(item.schema) : [item]);
      return { height: host.querySelector('[data-native-caption="height"]').textContent, heightHelp: host.querySelector('[data-native-helper="height"]').textContent,
        view: host.querySelector('[data-native-caption="view_id"]').textContent,
        modelTitle: editor._form.schema.find((item) => item.title?.includes('URL')).title,
        options: [...host.querySelector('[data-native-field="device_tap_action"]').options].map((option) => [option.value, option.textContent]),
        source: host.querySelector('[data-imported-source-controls] h3').textContent,
        sourceModel: host.querySelector('details:has([data-source-action="uploaded-model"]) summary').textContent,
        uploaded: host.querySelector('[data-source-action="uploaded-model"]').textContent,
        imported: host.querySelector('details[data-view-key] summary').textContent,
        order: host.querySelector('.bubble-control-order h3').textContent,
        up: host.querySelector('[data-control="reset"] .up').textContent,
        upAria: host.querySelector('[data-control="reset"] .up').getAttribute('aria-label'),
        rawModel: host.querySelector('[data-source-inspection="model"]').textContent,
        rawView: host.querySelector('details[data-view-key="raw-view_id-été"] [data-source-inspection="view"]')?.textContent,
        configExact: JSON.stringify(editor._config) === f.formRaw,
        fieldSame: node === f.formField, focused: document.activeElement === node, value: node.value,
        schemaValues: flatten(editor._form.schema).find((item) => item.name === 'device_tap_action').selector.select.options.map((option) => option.value),
        viewName: editor._config.views['raw-view_id-été'].label === names.importedView,
      };
    }, { field, names });
    check(`${language} actual card schema/helper/options/imported-source captions use fixed expected translations`, actual.height === expected.height
      && actual.heightHelp === expected.heightHelp && actual.view === expected.view && actual.modelTitle === expected.modelTitle
      && equal(actual.options, [['popup', expected.popup], ['toggle', expected.toggle]]) && actual.source === expected.source
      && actual.sourceModel === expected.sourceModel && actual.uploaded === expected.uploaded && actual.imported === expected.imported + 'raw-view_id-été'
      && actual.order === expected.order && actual.up === expected.up && actual.upAria === expected.resetUp, actual);
    check(`${language} card form retains exact unfinished native ID, raw import values and zero proposed/saved changes`, actual.fieldSame && actual.focused
      && actual.value === 'User_Unfinished_View_ID_été' && actual.configExact && actual.viewName
      && equal(actual.schemaValues, ['popup', 'toggle']) && actual.rawModel.includes('/local/User_Model_été.glb')
      && actual.rawView?.includes('User_Raw_été') && equal(await passiveState(page), baseline), actual);
  }
  // A deliberate real blur produces exactly one native value-changed/config-
  // changed proposal. Nothing here clicks HA Save or claims persistence there.
  await page.keyboard.press('Tab'); await flush(page);
  const proposed = await page.evaluate(() => { const f = window.localizationFixture;
    return { events: f.configEvents, originalView: f.cardEditor._config.views['raw-view_id-été'] };
  });
  check('native changed view ID emits one actual config-changed proposal with raw import extras intact', proposed.events.length === 1
    && proposed.events[0].view_id === 'User_Unfinished_View_ID_été' && proposed.originalView.label === names.importedView
    && equal(proposed.originalView.extension, [false, null, 'User_Raw_été']) && proposed.events[0].model_position[0] === 1, proposed);
  await formControl(page, '[data-control="reset"] .up', async (element) => { await element.focus(); await page.keyboard.press('Tab'); await page.keyboard.down('Shift');
    try { await page.keyboard.press('Tab'); } finally { await page.keyboard.up('Shift'); } });
  await page.evaluate(() => { const f = window.localizationFixture;
    f.orderButton = document.querySelector('#locale-form-host [data-control="reset"] .up'); });
  const beforeOrder = await page.evaluate(() => JSON.stringify(window.localizationFixture.cardEditor._config));
  await locale(page, 'de');
  check('localized actual button order preserves the exact focused native action without proposing a reorder', await page.evaluate((before) => {
    const f = window.localizationFixture; return document.activeElement === f.orderButton && f.orderButton.isConnected && JSON.stringify(f.cardEditor._config) === before && f.configEvents.length === 1;
  }, beforeOrder));
  await page.keyboard.press('Space'); await flush(page);
  check('fresh translated native order action emits exactly one proposal with unchanged raw control IDs', await page.evaluate(() => {
    const f = window.localizationFixture; return f.configEvents.length === 2 && JSON.stringify(f.configEvents[1].bubble_bar_controls) === JSON.stringify(['reset', 'mode', 'section', 'daynight', 'minimap', 'edit']);
  }));
  await formControl(page, 'details:has([data-source-action="uploaded-model"]) summary', (element) => element.click());
  await formControl(page, '[data-source-action="uploaded-model"]', (element) => element.focus());
  await page.evaluate(() => { const f = window.localizationFixture;
    f.sourceButton = document.querySelector('#locale-form-host [data-source-action="uploaded-model"]'); });
  await page.keyboard.down('Space');
  try { await locale(page, 'fr'); check('held imported-source action survives pure locale change as the same native focused button', await page.evaluate(() => {
    const f = window.localizationFixture; return document.activeElement === f.sourceButton && f.sourceButton.isConnected && f.configEvents.length === 2;
  })); } finally { await page.keyboard.up('Space'); }
  await flush(page);
  const cleared = await page.evaluate(() => { const f = window.localizationFixture; return { events: f.configEvents.length, config: f.cardEditor._config }; });
  check('translated deliberate source-clear emits one proposal deleting exact URL keys and retaining raw view/shading/extras', cleared.events === 3
    && !Object.hasOwn(cleared.config, 'model') && !Object.hasOwn(cleared.config, 'model_position') && !Object.hasOwn(cleared.config, 'model_opacity')
    && cleared.config.views['raw-view_id-été'].label === names.importedView && cleared.config.model_rendering.extra === 'User_Raw_Shading_été'
    && cleared.config.arbitrary_option.untouched === 'User_Extension_été', cleared);
  await page.evaluate(() => { document.querySelector('#locale-form-host').style.width = '320px'; }); await locale(page, 'es');
  await formControl(page, '[data-native-field="view_id"]', async (element) => { await element.focus(); await page.keyboard.press('Tab'); await page.keyboard.down('Shift');
    try { await page.keyboard.press('Tab'); } finally { await page.keyboard.up('Shift'); } });
  const narrow = await page.evaluate(() => { const host = document.querySelector('#locale-form-host'), bounds = host.getBoundingClientRect();
    const fields = [...host.querySelectorAll('input,select,.bubble-control-order button,[data-imported-source-controls] button')].filter((node) => node.getClientRects().length);
    return { width: bounds.width, focused: document.activeElement?.dataset.nativeField === 'view_id',
      bad: fields.filter((node) => { const r = node.getBoundingClientRect(); return r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.height < 43; }).map((node) => node.dataset.nativeField || node.dataset.sourceAction || node.textContent),
      clipped: [...host.querySelectorAll('label,p,summary,h3')].filter((node) => node.getClientRects().length && node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent) };
  });
  check('Spanish actual card-editor controls/captions remain readable in the explicit 320px minimal form host', narrow.width === 320 && narrow.focused
    && narrow.bad.length === 0 && narrow.clipped.length === 0, narrow);
  const element = await page.$('#locale-form-host');
  try { await element.screenshot({ path: path.join(screenshots, `localization-${mode}-es-320-card-editor.png`) }); } finally { await element.dispose(); }
  const after = await passiveState(page);
  check('card-editor proposals never write the actual layout, services, readings or card config', after.layout === baseline.layout
    && after.config === baseline.config && after.states === baseline.states && after.services === baseline.services && after.commits === baseline.commits && after.saves === baseline.saves);
  await page.evaluate(() => { const f = window.localizationFixture; f.cardEditor.remove(); f.cardEditor = null;
    const host = document.querySelector('#locale-form-host'); host.hidden = true; host.style.width = '700px'; });
  await page.evaluate(() => scrollTo(0, 0)); await ready(page);
}

async function readabilityAndIdle(page, mode) {
  await locale(page, 'de'); await ready(page); await screenshot(page, `localization-${mode}-de-desktop.png`);
  await narrowStage(page); await ready(page); await locale(page, 'es'); await ready(page); await room(page);
  const layout = await page.evaluate(() => {
    const card = document.querySelector('taylors3d-card'), shadow = card.shadowRoot, stage = card._stage.getBoundingClientRect();
    const popup = card._devicePopup.el, scene = card._scene.getBoundingClientRect();
    const nav = shadow.querySelector('[data-house-navigation]'), items = nav.querySelector('[data-house-navigation-items]');
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height }; };
    return { stage: rect(card._stage), scene: rect(card._scene), popup: rect(popup), popupMode: popup.dataset.houseControlsLayout,
      nav: rect(nav), scrollable: items.scrollWidth > items.clientWidth,
      targets: [...shadow.querySelectorAll('[data-house-navigation-id],.t3d-popup-close,.t3d-entity-actions button')]
        .filter((node) => !node.hidden && node.getClientRects().length).map((node) => ({ label: node.getAttribute('aria-label') || node.textContent, ...rect(node) })),
      overflow: [...popup.querySelectorAll('.t3d-entity-name,.t3d-entity-value,.t3d-entity-actions button,.t3d-popup-kind,.t3d-popup-head h3')]
        .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => ({ label: node.textContent, width: node.clientWidth, scroll: node.scrollWidth })),
      outside: popup.getBoundingClientRect().left < stage.left - 1 || popup.getBoundingClientRect().right > stage.right + 1,
      enoughScene: scene.height >= 240, actualWidth: stage.width,
    };
  });
  check('Spanish room controls use actual320px bottom sheet with no horizontal clipping', Math.abs(layout.actualWidth - 320) < .1
    && layout.popupMode === 'sheet' && !layout.outside && layout.overflow.length === 0 && layout.enoughScene, layout);
  check('translated narrow navigation keeps every supplied action reachable via native horizontal scrolling', layout.scrollable
    && layout.targets.filter((target) => target.label).every((target) => target.width >= 44 && target.height >= 44), layout.targets);
  await screenshot(page, `localization-${mode}-es-320-room.png`); await escape(page);
  await focus(page, nav('settings')); await page.keyboard.press('End');
  check('translated native narrow navigation End reaches the actual Settings control', await page.evaluate(() =>
    document.querySelector('taylors3d-card').shadowRoot.activeElement?.dataset.houseNavigationId === 'settings'));
  await ready(page); const before = await snapshot(page);
  for (let i = 0; i < 8; i++) await page.evaluate(() => { const card = document.querySelector('taylors3d-card');
    card.hass = { ...card._hass, locale: { ...card._hass.locale }, states: { ...card._hass.states } };
  });
  await ready(page); const after = await snapshot(page);
  check('identical locale/readings create no GPU frames, resources, resize or renderer size writes', equal(before.metrics, after.metrics), { before: before.metrics, after: after.metrics });
  check('passive language/readings leave service/layout-write counts and actual scene identities unchanged', after.calls.length === before.calls.length
    && after.commits === before.commits && after.saves === before.saves && after.rendererSame && after.sceneSame && after.realReadingsUnchanged,
  { calls: after.calls.length, commits: after.commits, saves: after.saves });
}

const modes = process.argv.includes('--source-only') ? ['source'] : process.argv.includes('--bundle-only') ? ['bundle'] : ['source', 'bundle'];
for (const mode of modes) {
  label = `${mode}: `; let session;
  try {
    session = await open(mode);
    check('loads only the selected real source or built app path', mode === 'source'
      ? session.requests.includes('/src/taylors3d-card.js') && !session.requests.includes('/dist/taylors3d-card.js')
      : session.requests.includes('/dist/taylors3d-card.js') && !session.requests.some((url) => url.startsWith('/src/')));
    await headerAndNavigation(session.page); await popupScenario(session.page, mode);
    await roomAndMap(session.page, mode); await editorScenario(session.page, mode);
    await advancedEditors(session.page, mode); await environmentAndHouse(session.page, mode); await extraEditorsScenario(session.page, mode); await cardEditor(session.page, mode);
    await cameraLanguages(session.page, mode); await sceneLanguages(session.page, mode); await readabilityAndIdle(session.page, mode);
  } catch (error) { check('language browser scenario completed', false, { context, message: error.message, stack: error.stack }); }
  finally {
    if (session) {
      check('fixture disconnects the actual card and settles cleanup before browser close', await session.page.evaluate(() => {
        const card = document.querySelector('taylors3d-card'); if (!card) return false;
        card._devicePopup.close(); card.remove(); return !card.isConnected;
      }).catch(() => false));
      await flush(session.page).catch(() => {}); errors.push(...session.errors); await session.close();
    }
  }
}
check('no application browser errors or warnings', errors.length === 0, errors);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} localization browser checks passed.`);
if (checks.some((ok) => !ok)) process.exitCode = 1;
