// Explicit authored Edit controls. Names, IDs, imported diagnostics and field values are never matched.
export const coreCaptionEntries = [];
const rows = [];
const add = (key, en, de, fr, es) => { rows.push([key, en, de, fr, es]); return key; };
const control = (scopes, kind, name, key, en, de, fr, es) => {
  add(key, en, de, fr, es);
  coreCaptionEntries.push({ scopes: scopes.split(' '), kind, selector: kind === 'label' ? `[data-field="${name}"]` : kind === 'option' ? name : `[data-act="${name}"]`, key, en });
};
const text = (scopes, selector, key, en, de, fr, es) => {
  add(key, en, de, fr, es); coreCaptionEntries.push({ scopes: scopes.split(' '), kind: 'text', selector, key, en });
};
control('rooms', 'label', 'room-area', 'area', 'Area', 'Bereich', 'Zone', 'Área');
control('rooms', 'label', 'room-floor', 'floor', 'Floor', 'Etage', 'Étage', 'Planta');
control('rooms', 'label', 'room-outdoor', 'outdoor', 'Outdoor (no walls)', 'Außenbereich (ohne Wände)', 'Extérieur (sans murs)', 'Exterior (sin paredes)');
control('rooms', 'button', 'finish', 'finish', 'Finish', 'Fertigstellen', 'Terminer', 'Terminar');
control('rooms', 'button', 'undo-point', 'undoPoint', 'Undo point', 'Punkt zurücknehmen', 'Annuler le point', 'Deshacer punto');
control('rooms', 'button', 'cancel-draw', 'cancelDraw', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
control('rooms', 'button', 'pick-cancel', 'cancelPick', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
control('rooms', 'button', 'pick-use', 'useOutline', 'Use this outline', 'Diesen Umriss verwenden', 'Utiliser ce contour', 'Usar este contorno');
control('rooms', 'button', 'pick-draw', 'drawInstead', 'Draw instead', 'Stattdessen zeichnen', 'Dessiner à la place', 'Dibujar en su lugar');
control('rooms', 'button', 'del-door', 'removeDoor', 'Remove', 'Entfernen', 'Retirer', 'Eliminar');
control('rooms', 'button', 'deselect', 'doneRoom', 'Done', 'Fertig', 'Terminé', 'Listo');
control('rooms', 'button', 'draw', 'draw', 'Draw', 'Zeichnen', 'Dessiner', 'Dibujar');
control('rooms', 'button', 'pick', 'pick', 'Pick', 'Auswählen', 'Choisir', 'Seleccionar');
control('rooms', 'button', 'del-floor', 'removeFloor', 'Remove', 'Entfernen', 'Retirer', 'Eliminar');
control('rooms', 'button', 'add-floor', 'addFloor', 'Add floor', 'Etage hinzufügen', 'Ajouter un étage', 'Añadir planta');
control('devices', 'label', 'marker-z', 'markerHeight', 'Height above floor (m)', 'Höhe über dem Boden (m)', 'Hauteur au-dessus du sol (m)', 'Altura sobre el suelo (m)');
control('devices', 'button', 'deselect-marker', 'doneDevice', 'Done', 'Fertig', 'Terminé', 'Listo');
control('devices', 'button', 'detach', 'detach', 'Detach', 'Lösen', 'Détacher', 'Separar');
control('devices', 'button', 'unpin', 'unpin', 'Return to auto placement', 'Zur automatischen Platzierung', 'Revenir au placement automatique', 'Volver a la colocación automática');
control('devices', 'button', 'hide', 'hideDevice', 'Hide', 'Ausblenden', 'Masquer', 'Ocultar');
control('devices', 'button', 'place', 'place', 'Place', 'Platzieren', 'Placer', 'Colocar');
control('devices', 'button', 'unhide', 'unhideDevice', 'Unhide', 'Einblenden', 'Afficher', 'Mostrar');
control('objects', 'label', 'obj-hidden', 'hideObject', 'Hide', 'Ausblenden', 'Masquer', 'Ocultar');
control('objects', 'button', 'obj-test', 'test', 'Test', 'Testen', 'Tester', 'Probar');
control('objects', 'label', 'obj-picker-area', 'objectArea', 'Filter suggestions by area', 'Vorschläge nach Bereich filtern', 'Filtrer les suggestions par zone', 'Filtrar sugerencias por área');
control('mower', 'label', 'mower-picker-area', 'mowerArea', 'Filter suggestions by area', 'Vorschläge nach Bereich filtern', 'Filtrer les suggestions par zone', 'Filtrar sugerencias por área');
control('mower', 'label', 'mower-entity', 'entity', 'Entity', 'Entität', 'Entité', 'Entidad');
control('mower', 'label', 'mower-source', 'source', 'Source', 'Quelle', 'Source', 'Origen');
control('mower', 'label', 'mower-xattr', 'xAttribute', 'x attribute', 'x-Attribut', 'Attribut x', 'Atributo x');
control('mower', 'label', 'mower-yattr', 'yAttribute', 'y attribute', 'y-Attribut', 'Attribut y', 'Atributo y');
control('mower', 'label', 'mower-floor', 'mowerFloor', 'Floor', 'Etage', 'Étage', 'Planta');
control('mower', 'label', 'mower-trail', 'trail', 'Show trail (this session)', 'Spur zeigen (diese Sitzung)', 'Afficher la trace (cette session)', 'Mostrar recorrido (esta sesión)');
control('mower', 'label', 'ov-entity', 'overlaySource', 'Image or camera entity', 'Bild- oder Kameraentität', 'Entité image ou caméra', 'Entidad de imagen o cámara');
control('mower', 'button', 'cal-cancel', 'cancelCalibration', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
control('mower', 'button', 'cal-del', 'removePoint', 'Remove', 'Entfernen', 'Retirer', 'Eliminar');
control('mower', 'button', 'cal-add', 'addPoint', 'Add point', 'Punkt hinzufügen', 'Ajouter un point', 'Añadir punto');
control('mower', 'button', 'trail-clear', 'clearTrail', 'Clear trail', 'Spur löschen', 'Effacer la trace', 'Borrar recorrido');
control('mower', 'button', 'ov-remove', 'removeOverlay', 'Remove overlay', 'Überlagerung entfernen', 'Retirer la superposition', 'Eliminar superposición');
control('mower', 'button', 'mower-remove', 'removeMower', 'Remove mower', 'Mäher entfernen', 'Retirer la tondeuse', 'Eliminar cortacésped');
control('views', 'label', 'screen-name', 'screenName', 'Screen name (this browser)', 'Bildschirmname (dieser Browser)', 'Nom de l’écran (ce navigateur)', 'Nombre de pantalla (este navegador)');
control('views', 'button', 'save-screen-name', 'saveScreen', 'Save screen name', 'Bildschirmnamen speichern', 'Enregistrer le nom de l’écran', 'Guardar nombre de pantalla');
control('views', 'label', 'vw-view', 'view', 'View', 'Ansicht', 'Vue', 'Vista');
control('views', 'label', 'vw-label', 'label', 'Label', 'Bezeichnung', 'Libellé', 'Etiqueta');
control('views', 'button', 'vw-add', 'addView', 'Add view', 'Ansicht hinzufügen', 'Ajouter une vue', 'Añadir vista');
control('views', 'button', 'vw-up', 'viewsUp', 'Up', 'Nach oben', 'Monter', 'Subir');
control('views', 'button', 'vw-down', 'down', 'Down', 'Nach unten', 'Descendre', 'Bajar');
control('views', 'button', 'vw-save-cam', 'saveCamera', 'Save current view as start', 'Aktuelle Ansicht als Start speichern', 'Enregistrer la vue actuelle comme départ', 'Guardar vista actual como inicio');
control('views', 'button', 'vw-reset-cam', 'resetCamera', 'Reset camera', 'Kamera zurücksetzen', 'Réinitialiser la caméra', 'Restablecer cámara');
control('views', 'button', 'vw-pivot', 'pivot', 'Set rotation centre', 'Drehzentrum setzen', 'Définir le centre de rotation', 'Establecer centro de rotación');
control('views', 'button', 'vw-pivot-cancel', 'cancelPivot', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
control('views', 'label', 'vw-zoom-to', 'zoom', 'Zoom towards', 'Zoomen in Richtung', 'Zoomer vers', 'Acercar hacia');
control('views', 'label', 'vw-cut', 'cut', 'Cut at storey height', 'Auf Geschosshöhe schneiden', 'Couper à la hauteur de l’étage', 'Cortar a la altura de la planta');
control('views', 'label', 'vw-sec-dir', 'direction', 'Direction', 'Richtung', 'Direction', 'Dirección');
control('views', 'button', 'vw-sec-reset', 'resetSection', 'Reset section', 'Schnitt zurücksetzen', 'Réinitialiser la coupe', 'Restablecer corte');
control('views', 'button', 'vw-rm', 'removeRule', 'Remove', 'Entfernen', 'Retirer', 'Eliminar');
control('views', 'button', 'vw-reset', 'resetView', 'Reset this view', 'Diese Ansicht zurücksetzen', 'Réinitialiser cette vue', 'Restablecer esta vista');
control('model', 'label', 'md-scale', 'scale', 'Scale', 'Maßstab', 'Échelle', 'Escala');
control('model', 'button', 'model-fit', 'frameModel', 'Frame model', 'Modell einpassen', 'Cadrer le modèle', 'Encuadrar modelo');
control('model', 'button', 'md-copy-report', 'copyReport', 'Copy to clipboard', 'In die Zwischenablage kopieren', 'Copier dans le presse-papiers', 'Copiar al portapapeles');
control('model', 'button', 'md-ack', 'ack', 'OK', 'OK', 'OK', 'Aceptar');
control('model', 'button', 'md-forget', 'forget', 'Forget', 'Vergessen', 'Oublier', 'Olvidar');
for (const [field, scope] of [['obj-picker-area', 'objects'], ['mower-picker-area', 'mower']]) {
  control(scope, 'option', `[data-field="${field}"] option[value="all"]`, `${scope}AllAreas`, 'All areas', 'Alle Bereiche', 'Toutes les zones', 'Todas las áreas');
  control(scope, 'option', `[data-field="${field}"] option[value="unassigned"]`, `${scope}Unassigned`, 'Unassigned', 'Nicht zugewiesen', 'Non attribué', 'Sin asignar');
}
for (const [value, key, en, de, fr, es] of [
  ['gps', 'gps', 'GPS (latitude / longitude)', 'GPS (Breitengrad / Längengrad)', 'GPS (latitude / longitude)', 'GPS (latitud / longitud)'],
  ['xy', 'xy', 'Map x / y attributes', 'Kartenattribute x / y', 'Attributs x / y de la carte', 'Atributos x / y del mapa'],
  ['image', 'image', 'Live map image (mower icon colour)', 'Live-Kartenbild (Farbe des Mähersymbols)', 'Image de carte en direct (couleur de l’icône de tondeuse)', 'Imagen de mapa en directo (color del icono del cortacésped)'],
]) control('mower', 'option', `[data-field="mower-source"] option[value="${value}"]`, key, en, de, fr, es);
text('rooms', 'p.hint', 'drawHelp', 'Click the corners on the plan. Points snap to 5 cm and to existing corners, so shared walls line up. Click the first point or press Enter to finish, Backspace removes the last point, Esc cancels.', 'Klicken Sie die Ecken im Plan an. Punkte rasten auf 5 cm und an vorhandenen Ecken ein, damit gemeinsame Wände übereinstimmen. Klicken Sie den ersten Punkt an oder drücken Sie Enter zum Abschließen, Backspace entfernt den letzten Punkt, Esc bricht ab.', 'Cliquez sur les coins du plan. Les points s’alignent à 5 cm et sur les coins existants, pour raccorder les murs communs. Cliquez sur le premier point ou appuyez sur Entrée pour terminer, Retour arrière retire le dernier point, Échap annule.', 'Haga clic en las esquinas del plano. Los puntos se ajustan a 5 cm y a las esquinas existentes para alinear paredes compartidas. Pulse el primer punto o Intro para terminar; Retroceso elimina el último punto y Esc cancela.');
text('rooms', 'p.hint', 'pickHelp', "Click on this room's floor in the model.", 'Klicken Sie im Modell auf den Boden dieses Raums.', 'Cliquez sur le sol de cette pièce dans le modèle.', 'Haga clic en el suelo de esta habitación en el modelo.');
text('rooms', 'p.hint', 'reshape', 'Drag corners to reshape. Drag an edge midpoint to add a corner, right-click a corner to delete it.', 'Ziehen Sie Ecken zum Umformen. Ziehen Sie eine Kantenmitte zum Hinzufügen einer Ecke; Rechtsklick auf eine Ecke löscht sie.', 'Déplacez les coins pour modifier la forme. Déplacez le milieu d’un bord pour ajouter un coin ; un clic droit sur un coin le supprime.', 'Arrastre las esquinas para cambiar la forma. Arrastre el punto medio de un borde para añadir una esquina; clic derecho en una esquina la elimina.');
text('rooms', 'p.hint', 'noAreas', 'No areas in Home Assistant yet. Create areas under Settings → Areas.', 'Noch keine Bereiche in Home Assistant. Erstellen Sie Bereiche unter Einstellungen → Bereiche.', 'Aucune zone dans Home Assistant. Créez-en dans Paramètres → Zones.', 'Aún no hay áreas en Home Assistant. Créelas en Ajustes → Áreas.');
text('rooms', 'p.hint', 'floorHelp', "Floors come from Home Assistant (Settings → Areas → Floors). Add one here only for a level HA doesn't have.", 'Etagen stammen aus Home Assistant (Einstellungen → Bereiche → Etagen). Fügen Sie hier nur eine Ebene hinzu, die HA noch nicht hat.', 'Les étages viennent de Home Assistant (Paramètres → Zones → Étages). Ajoutez-en un ici seulement s’il n’existe pas dans HA.', 'Las plantas proceden de Home Assistant (Ajustes → Áreas → Plantas). Añada una aquí solo si HA no tiene ese nivel.');
text('devices', 'p', 'liveMowerHelp', 'Follows the live mower position. Set it up in the Mower tab.', 'Folgt der aktuellen Mäherposition. Richten Sie dies im Reiter Mäher ein.', 'Suit la position actuelle de la tondeuse. Configurez-la dans l’onglet Tondeuse.', 'Sigue la posición actual del cortacésped. Configúrelo en la pestaña Cortacésped.');
text('devices', 'p.dim', 'allPlaced', 'Every device is on the plan.', 'Alle Geräte sind im Plan.', 'Tous les appareils sont sur le plan.', 'Todos los dispositivos están en el plano.');
text('devices', 'p.dim', 'nothingHidden', 'Nothing hidden.', 'Nichts ausgeblendet.', 'Rien de masqué.', 'No hay nada oculto.');
text('objects', 'p.hint', 'objectHelp', 'Bind each model object to a Home Assistant entity. Empty means automatic; "none" leaves it unbound. Click an object in the plan to find its row.', 'Verknüpfen Sie jedes Modellobjekt mit einer Home-Assistant-Entität. Leer bedeutet automatisch; "none" lässt es unverknüpft. Klicken Sie ein Objekt im Plan an, um seine Zeile zu finden.', 'Liez chaque objet du modèle à une entité Home Assistant. Vide signifie automatique ; "none" le laisse sans lien. Cliquez sur un objet du plan pour trouver sa ligne.', 'Vincule cada objeto del modelo a una entidad de Home Assistant. Vacío significa automático; "none" lo deja sin vínculo. Pulse un objeto del plano para encontrar su fila.');
text('objects', 'p.hint', 'groupHelp', 'A group controller must be on too: a fixture is lit only while its own entity and the controller are both on.', 'Auch die Gruppensteuerung muss eingeschaltet sein: Eine Leuchte leuchtet nur, wenn ihre eigene Entität und die Steuerung eingeschaltet sind.', 'Le contrôleur de groupe doit aussi être allumé : un luminaire s’allume seulement si son entité et le contrôleur sont tous deux allumés.', 'El controlador de grupo también debe estar encendido: una lámpara solo se ilumina cuando su propia entidad y el controlador están encendidos.');
text('mower', 'p', 'calibrationPickHelp', 'Click on the plan where the mower is right now.', 'Klicken Sie im Plan dorthin, wo der Mäher jetzt ist.', 'Cliquez sur le plan à l’endroit où se trouve la tondeuse actuellement.', 'Pulse en el plano donde está ahora el cortacésped.');
text('mower', 'p.hint', 'calibrationHelp', '"Add point" takes the current reading, then you click where the mower really is. One point aligns a GPS track north-up, two fix rotation and scale, three or more also correct skew. Spread points far apart.', '"Punkt hinzufügen" übernimmt den aktuellen Messwert; anschließend klicken Sie auf die tatsächliche Mäherposition. Ein Punkt richtet eine GPS-Spur nach Norden aus, zwei korrigieren Drehung und Maßstab, drei oder mehr auch die Verzerrung. Verteilen Sie die Punkte weit auseinander.', '"Ajouter un point" prend la valeur actuelle, puis vous cliquez sur la position réelle de la tondeuse. Un point oriente une trace GPS vers le nord, deux corrigent rotation et échelle, trois ou plus corrigent aussi la déformation. Éloignez les points les uns des autres.', '"Añadir punto" toma la lectura actual y después pulsa donde está realmente el cortacésped. Un punto orienta el GPS hacia el norte, dos corrigen rotación y escala, y tres o más también la distorsión. Separe bien los puntos.');
text('views', 'p.hint', 'screenHelp', "Give each wall panel/browser a different name, e.g. kitchen-wall. This is saved only on this browser; your layout remains shared. Leave blank to use the card's screen name.", 'Geben Sie jedem Wandpanel/Browser einen anderen Namen, z. B. kitchen-wall. Dieser wird nur in diesem Browser gespeichert; das Layout bleibt gemeinsam. Lassen Sie das Feld leer, um den Bildschirmnamen der Karte zu verwenden.', 'Donnez un nom différent à chaque panneau mural/navigateur, par exemple kitchen-wall. Il est enregistré dans ce navigateur seulement ; la disposition reste partagée. Laissez vide pour utiliser le nom d’écran de la carte.', 'Asigne un nombre diferente a cada panel de pared/navegador, como kitchen-wall. Se guarda solo en este navegador; el diseño sigue siendo compartido. Déjelo vacío para usar el nombre de pantalla de la tarjeta.');
text('views', 'p.hint', 'noViews', 'No views yet.', 'Noch keine Ansichten.', 'Aucune vue pour le moment.', 'Aún no hay vistas.');
text('views', 'p.hint', 'viewHelp', 'Each view is a button on the card. Choose what it shows: click a part of the model, or use the eyes below.', 'Jede Ansicht ist eine Schaltfläche auf der Karte. Wählen Sie ihren Inhalt: Klicken Sie einen Modellteil an oder nutzen Sie die Augensymbole unten.', 'Chaque vue est un bouton de la carte. Choisissez son contenu : cliquez sur une partie du modèle ou utilisez les yeux ci-dessous.', 'Cada vista es un botón de la tarjeta. Elija qué muestra: pulse una parte del modelo o use los ojos de abajo.');
text('views', 'p.hint', 'linkedFloorHelp', 'Devices on linked floors show in this view. None checked: the view belongs to no floor (e.g. a garden view).', 'Geräte auf verknüpften Etagen erscheinen in dieser Ansicht. Keine Auswahl: Die Ansicht gehört zu keiner Etage (z. B. Gartenansicht).', 'Les appareils des étages liés apparaissent dans cette vue. Aucune case cochée : la vue n’appartient à aucun étage (par exemple le jardin).', 'Los dispositivos de las plantas vinculadas aparecen en esta vista. Sin casillas marcadas: la vista no pertenece a ninguna planta (por ejemplo, el jardín).');
text('views', 'p.hint', 'pivotHelp', 'Click where the rotation centre should be (Esc cancels).', 'Klicken Sie auf das gewünschte Drehzentrum (Esc bricht ab).', 'Cliquez à l’emplacement du centre de rotation (Échap annule).', 'Pulse donde debe estar el centro de rotación (Esc cancela).');
text('views', 'p.dim', 'noTaggedRooms', 'No tagged levels or rooms.', 'Keine markierten Ebenen oder Räume.', 'Aucun niveau ou pièce balisé.', 'No hay niveles ni habitaciones etiquetados.');
text('views', 'p.hint', 'uploadViewsHelp', 'Upload a model (Model tab) to choose which parts each view shows.', 'Laden Sie ein Modell hoch (Reiter Modell), um die sichtbaren Teile jeder Ansicht auszuwählen.', 'Importez un modèle (onglet Modèle) pour choisir les parties affichées par chaque vue.', 'Cargue un modelo (pestaña Modelo) para elegir qué partes muestra cada vista.');
text('model', 'p.hint', 'positionHelp', 'Metres in the original house coordinates. These values do not include separated-floor display spacing.', 'Meter in den ursprünglichen Hauskoordinaten. Diese Werte enthalten keine Abstände der getrennten Etagendarstellung.', 'Mètres dans les coordonnées originales de la maison. Ces valeurs n’incluent pas l’espacement d’affichage des étages séparés.', 'Metros en las coordenadas originales de la casa. Estos valores no incluyen la separación visual entre plantas.');
text('model', 'p.hint', 'scaleHelp', 'Scale 0.01 for a model made in centimetres, 0.001 for millimetres.', 'Maßstab 0.01 für ein Modell in Zentimetern, 0.001 für Millimeter.', 'Échelle 0.01 pour un modèle en centimètres, 0.001 pour les millimètres.', 'Escala 0.01 para un modelo en centímetros, 0.001 para milímetros.');
text('model', 'p.dim', 'loadingModel', 'Loading model…', 'Modell wird geladen…', 'Chargement du modèle…', 'Cargando modelo…');

// Static prose is indexed by its authored control, not by arbitrary HA names.
control('mower', 'label', 'mower-img-entity', 'imageEntity', 'Image entity', 'Bild-Entität', 'Entité image', 'Entidad de imagen');
control('mower', 'button', 'img-pick-cancel', 'imageCancel', 'Cancel', 'Abbrechen', 'Annuler', 'Cancelar');
control('mower', 'button', 'img-pick', 'pickColour', 'Pick mower colour', 'Mäherfarbe auswählen', 'Choisir la couleur de la tondeuse', 'Elegir color del cortacésped');
text('mower', 'section.box > p', 'colourHelp', 'Click the mower icon on the map overlay. Esc cancels.', 'Klicken Sie auf das Mähersymbol auf der Kartenüberlagerung. Esc bricht ab.', 'Cliquez sur l’icône de la tondeuse sur la carte superposée. Échap annule.', 'Pulse el icono del cortacésped en la capa del mapa. Esc cancela.');
text('mower', 'p.hint', 'imageAlignmentHelp', 'Align the map overlay with the plan first: the alignment maps image pixels to the plan, so no calibration points are needed. Then pick the colour of the mower icon on the map.', 'Richten Sie zuerst die Kartenüberlagerung am Plan aus: Die Ausrichtung ordnet Bildpixel dem Plan zu, daher sind keine Kalibrierpunkte erforderlich. Wählen Sie dann die Farbe des Mähersymbols auf der Karte.', 'Alignez d’abord la carte superposée sur le plan : l’alignement associe les pixels au plan, sans points d’étalonnage. Choisissez ensuite la couleur de l’icône de la tondeuse.', 'Alinee primero la capa del mapa con el plano: la alineación asigna los píxeles al plano, por lo que no necesita puntos de calibración. Después elija el color del icono del cortacésped.');
text('mower', 'p.note.warn', 'mowerMissingFloorHelp', 'The saved floor is missing. Choose its replacement deliberately before placing the mower.', 'Die gespeicherte Etage fehlt. Wählen Sie bewusst einen Ersatz, bevor Sie den Mäher platzieren.', 'L’étage enregistré est absent. Choisissez délibérément son remplacement avant de placer la tondeuse.', 'Falta la planta guardada. Elija su reemplazo de forma deliberada antes de colocar el cortacésped.');
text('rooms', 'p.note.warn', 'roomMissingFloorHelp', 'This saved room has no current floor location. Choose its replacement deliberately; its outline is retained.', 'Dieser gespeicherte Raum hat aktuell keine Etagenposition. Wählen Sie bewusst einen Ersatz; der Umriss bleibt erhalten.', 'Cette pièce enregistrée n’a pas d’emplacement d’étage actuel. Choisissez délibérément son remplacement ; son contour est conservé.', 'Esta habitación guardada no tiene una planta actual. Elija su reemplazo de forma deliberada; el contorno se conserva.');
for (const row of [
 ['doors', 'Doors', 'Türen', 'Portes', 'Puertas'],
 ['noDoors', 'No doors', 'Keine Türen', 'Aucune porte', 'Sin puertas'],
 ['roomOrphans', 'Rooms without an HA area', 'Räume ohne HA-Bereich', 'Pièces sans zone HA', 'Habitaciones sin área de HA'],
 ['advanced', 'Advanced (no model)', 'Erweitert (ohne Modell)', 'Avancé (sans modèle)', 'Avanzado (sin modelo)'],
 ['floors', 'Floors', 'Etagen', 'Étages', 'Plantas'],
 ['elevation', 'Elevation m', 'Höhe über Null m', 'Altitude m', 'Elevación m'],
 ['floorHeight', 'Height m', 'Höhe m', 'Hauteur m', 'Altura m'],
 ['groups', 'Groups', 'Gruppen', 'Groupes', 'Grupos'],
 ['position', 'Position', 'Position', 'Position', 'Posición'],
 ['mapOverlay', 'Map overlay', 'Kartenüberlagerung', 'Carte superposée', 'Capa del mapa'],
 ['mowerIcon', 'Mower icon on the map', 'Mähersymbol auf der Karte', 'Icône de la tondeuse sur la carte', 'Icono del cortacésped en el mapa'],
 ['linkedFloors', 'Linked HA floors', 'Verknüpfte HA-Etagen', 'Étages HA liés', 'Plantas de HA vinculadas'],
 ['model', 'Model', 'Modell', 'Modèle', 'Modelo'],
 ['layers', 'Layers', 'Ebenen', 'Calques', 'Capas'],
 ['modelGroups', 'Model groups', 'Modellgruppen', 'Groupes du modèle', 'Grupos del modelo'],
 ['notInModel', 'Not in this model', 'Nicht in diesem Modell', 'Absent de ce modèle', 'No está en este modelo'],
 ['section', 'Side section', 'Seitlicher Schnitt', 'Coupe latérale', 'Sección lateral'],
 ['alignment', 'Alignment', 'Ausrichtung', 'Alignement', 'Alineación'],
 ['exactPosition', 'Exact position values', 'Genaue Positionswerte', 'Valeurs de position exactes', 'Valores exactos de posición'],
 ['inModel', 'In the model', 'Im Modell', 'Dans le modèle', 'En el modelo'],
 ['levelFloors', 'Levels: belongs to HA floor', 'Ebenen: Zugehörige HA-Etage', 'Niveaux : étage HA associé', 'Niveles: planta de HA asociada'],
 ['roomsZones', 'Rooms and zones', 'Räume und Zonen', 'Pièces et zones', 'Habitaciones y zonas'],
 ['gone', 'No longer in the model', 'Nicht mehr im Modell', 'Absent du modèle désormais', 'Ya no está en el modelo'],
 ['storage', 'Storage', 'Speicher', 'Stockage', 'Almacenamiento'],
 ['savedLinks', 'Saved Home Assistant links', 'Gespeicherte Home-Assistant-Verknüpfungen', 'Liens Home Assistant enregistrés', 'Vínculos guardados de Home Assistant'],
]) add(...row);
for (const row of [
 ['drawing', 'Drawing: {name}', 'Zeichnen: {name}', 'Dessin : {name}', 'Dibujando: {name}'],
 ['picking', 'Pick: {name}', 'Auswählen: {name}', 'Choisir : {name}', 'Elegir: {name}'],
 ['pointsOne', '{count} point', '{count} Punkt', '{count} point', '{count} punto'],
 ['pointsMany', '{count} points', '{count} Punkte', '{count} points', '{count} puntos'],
 ['corners', '{count} corners', '{count} Ecken', '{count} coins', '{count} esquinas'],
 ['tracing', 'Tracing…', 'Umriss wird ermittelt…', 'Traçage…', 'Trazando…'],
 ['missingArea', '{id} (missing)', '{id} (fehlt)', '{id} (absente)', '{id} (falta)'],
 ['missingFloor', 'Missing floor: {id}', 'Fehlende Etage: {id}', 'Étage absent : {id}', 'Planta ausente: {id}'],
 ['doorNumber', 'Door {count}', 'Tür {count}', 'Porte {count}', 'Puerta {count}'],
 ['addDoor', 'Add door', 'Tür hinzufügen', 'Ajouter une porte', 'Añadir puerta'],
 ['clickWall', 'Click a wall on the plan…', 'Klicken Sie im Plan eine Wand an…', 'Cliquez sur un mur du plan…', 'Pulse una pared del plano…'],
 ['deleteRoom', 'Delete room', 'Raum löschen', 'Supprimer la pièce', 'Eliminar habitación'],
 ['reallyDelete', 'Really delete?', 'Wirklich löschen?', 'Supprimer vraiment ?', '¿Eliminar realmente?'],
 ['select', 'Select', 'Auswählen', 'Sélectionner', 'Seleccionar'],
 ['noFloor', 'No floor', 'Keine Etage', 'Aucun étage', 'Sin planta'],
 ['noFloorLower', 'no floor', 'keine Etage', 'aucun étage', 'sin planta'],
 ['modelBadge', 'model', 'Modell', 'modèle', 'modelo'],
 ['drawn', 'drawn', 'gezeichnet', 'dessiné', 'dibujado'],
 ['missing', 'missing', 'fehlt', 'absent', 'ausente'],
 ['attached', 'Attached to {name}', 'An {name} angeheftet', 'Attaché à {name}', 'Vinculado a {name}'],
 ['attachedMissing', 'Attached to {name} (not in the model)', 'An {name} angeheftet (nicht im Modell)', 'Attaché à {name} (absent du modèle)', 'Vinculado a {name} (no está en el modelo)'],
 ['pinned', 'Pinned', 'Fixiert', 'Épinglé', 'Fijado'],
 ['autoPlaced', 'Auto placed', 'Automatisch platziert', 'Placé automatiquement', 'Colocado automáticamente'],
 ['dragMarker', 'Drag any marker on the plan to pin it there. Click a marker to select it.', 'Ziehen Sie einen Marker im Plan, um ihn dort zu fixieren. Klicken Sie ihn zum Auswählen an.', 'Déplacez un repère sur le plan pour l’épingler. Cliquez dessus pour le sélectionner.', 'Arrastre un marcador en el plano para fijarlo allí. Púlselo para seleccionarlo.'],
 ['dragModelMarker', 'Drag any marker on the plan to pin it there (it sticks to the model surface; drop on a model object to attach it, hold Alt for a free drag). Click a marker to select it.', 'Ziehen Sie einen Marker im Plan, um ihn zu fixieren (er haftet an der Modelloberfläche; legen Sie ihn auf ein Modellobjekt zum Anheften, halten Sie Alt zum freien Ziehen). Klicken Sie ihn zum Auswählen an.', 'Déplacez un repère sur le plan pour l’épingler (il adhère à la surface du modèle ; posez-le sur un objet pour l’attacher, maintenez Alt pour le déplacer librement). Cliquez dessus pour le sélectionner.', 'Arrastre un marcador en el plano para fijarlo (se pega a la superficie del modelo; suéltelo en un objeto para vincularlo, mantenga Alt para arrastrar libremente). Púlselo para seleccionarlo.'],
 ['unplaced', 'Devices without a room ({count})', 'Geräte ohne Raum ({count})', 'Appareils sans pièce ({count})', 'Dispositivos sin habitación ({count})'],
 ['hiddenCount', 'Hidden ({count})', 'Ausgeblendet ({count})', 'Masqués ({count})', 'Ocultos ({count})'],
 ['noArea', 'no area', 'kein Bereich', 'aucune zone', 'sin área'],
 ['noLevel', 'No level', 'Keine Ebene', 'Aucun niveau', 'Sin nivel'],
 ['noRoom', 'No room', 'Kein Raum', 'Aucune pièce', 'Sin habitación'],
 ['entityMissing', 'entity not found', 'Entität nicht gefunden', 'entité introuvable', 'entidad no encontrada'],
 ['auto', 'auto', 'automatisch', 'auto', 'automático'],
 ['autoNone', 'auto: none', 'automatisch: keine', 'auto : aucune', 'automático: ninguna'],
 ['autoEntity', 'auto: {id}', 'automatisch: {id}', 'auto : {id}', 'automático: {id}'],
 ['autoName', 'auto ({name})', 'automatisch ({name})', 'auto ({name})', 'automático ({name})'],
 ['group', 'Group {id}', 'Gruppe {id}', 'Groupe {id}', 'Grupo {id}'],
 ['missingSelectedArea', 'Missing selected area', 'Ausgewählter Bereich fehlt', 'Zone sélectionnée absente', 'Falta el área seleccionada'],
 ['noController', 'no controller', 'keine Steuerung', 'aucun contrôleur', 'sin controlador'],
 ['filtered', 'filtered entity', 'gefilterte Entität', 'entité filtrée', 'entidad filtrada'],
 ['entityHidden', 'entity hidden in Home Assistant', 'Entität in Home Assistant ausgeblendet', 'entité masquée dans Home Assistant', 'entidad oculta en Home Assistant'],
 ['entityDisabled', 'entity disabled in Home Assistant', 'Entität in Home Assistant deaktiviert', 'entité désactivée dans Home Assistant', 'entidad desactivada en Home Assistant'],
 ['entityDiagnostic', 'diagnostic entity', 'Diagnose-Entität', 'entité de diagnostic', 'entidad de diagnóstico'],
 ['savedMowerLink', '{id}: {label}. The saved link is retained; choose a current entity to repair it.', '{id}: {label}. Die gespeicherte Verknüpfung bleibt erhalten; wählen Sie eine aktuelle Entität zur Reparatur.', '{id} : {label}. Le lien enregistré est conservé ; choisissez une entité actuelle pour le réparer.', '{id}: {label}. Se conserva el vínculo guardado; elija una entidad actual para repararlo.'],
 ['calibration', 'Calibration ({count} {points}{fit})', 'Kalibrierung ({count} {points}{fit})', 'Étalonnage ({count} {points}{fit})', 'Calibración ({count} {points}{fit})'],
 ['pointWord', 'point', 'Punkt', 'point', 'punto'],
 ['pointsWord', 'points', 'Punkte', 'points', 'puntos'],
 ['fitShift', 'shift only', 'nur Verschiebung', 'translation seule', 'solo desplazamiento'],
 ['fitScale', 'shift, rotate, scale', 'Verschiebung, Drehung, Maßstab', 'translation, rotation, échelle', 'desplazamiento, rotación, escala'],
 ['fitAffine', 'affine (least squares)', 'affin (kleinste Quadrate)', 'affine (moindres carrés)', 'afín (mínimos cuadrados)'],
 ['fitError', 'Fit error {value} m', 'Anpassungsfehler {value} m', 'Erreur d’ajustement {value} m', 'Error de ajuste {value} m'],
 ['colourTolerance', 'Colour tolerance', 'Farbtoleranz', 'Tolérance de couleur', 'Tolerancia de color'],
 ['east', 'East (m)', 'Ost (m)', 'Est (m)', 'Este (m)'],
 ['north', 'North (m)', 'Nord (m)', 'Nord (m)', 'Norte (m)'],
 ['up', 'Up (m)', 'Oben (m)', 'Haut (m)', 'Arriba (m)'],
 ['rotation', 'Rotation (°)', 'Drehung (°)', 'Rotation (°)', 'Rotación (°)'],
 ['width', 'Width (m)', 'Breite (m)', 'Largeur (m)', 'Anchura (m)'],
 ['opacity', 'Opacity', 'Deckkraft', 'Opacité', 'Opacidad'],
 ['refresh', 'Refresh every (s)', 'Aktualisieren alle (s)', 'Actualiser toutes les (s)', 'Actualizar cada (s)'],
 ['moveMap', 'Move with mouse', 'Mit Maus verschieben', 'Déplacer avec la souris', 'Mover con el ratón'],
 ['dragMap', 'Drag the map on the plan…', 'Ziehen Sie die Karte im Plan…', 'Déplacez la carte sur le plan…', 'Arrastre el mapa sobre el plano…'],
 ['sameOverlay', 'same as the overlay', 'wie die Überlagerung', 'comme la carte superposée', 'igual que la capa'],
]) add(...row);

// These attributes belong to exact editor controls; native values remain raw.
for (const [scopes, selector, kind, key, en, de, fr, es] of [
 ['objects', '[data-act="obj-test"]', 'title', 'testTitle', 'Toggle it like a tap in the view', 'Wie beim Tippen in der Ansicht umschalten', 'Basculer comme un appui dans la vue', 'Alternar como al pulsar en la vista'],
 ['objects', '[data-field="obj-entity"]', 'title', 'objectTitle', 'Empty: automatic; type none to leave it unbound', 'Leer: automatisch; none eingeben, um nicht zu verknüpfen', 'Vide : automatique ; saisissez none pour laisser sans lien', 'Vacío: automático; escriba none para dejar sin vínculo'],
 ['objects', '[data-field="grp-entity"]', 'placeholder', 'controllerPlaceholder', 'no controller', 'keine Steuerung', 'aucun contrôleur', 'sin controlador'],
 ['objects', '[data-field="grp-entity"]', 'title', 'controllerTitle', 'Empty or none: no controller', 'Leer oder none: keine Steuerung', 'Vide ou none : aucun contrôleur', 'Vacío o none: sin controlador'],
 ['views', '[data-act="vw-up"]', 'title', 'moveLeft', 'Move left', 'Nach links', 'Déplacer à gauche', 'Mover a la izquierda'],
 ['views', '[data-act="vw-down"]', 'title', 'moveRight', 'Move right', 'Nach rechts', 'Déplacer à droite', 'Mover a la derecha'],
 ['views', '[data-act="vw-pivot"]', 'title', 'pivotTitle', 'Click a point: the camera rotates and zooms around it', 'Klicken Sie einen Punkt an: Die Kamera dreht und zoomt um ihn', 'Cliquez sur un point : la caméra tourne et zoome autour de lui', 'Pulse un punto: la cámara gira y amplía a su alrededor'],
]) { add(key, en, de, fr, es); coreCaptionEntries.push({ scopes: scopes.split(' '), selector, kind, key, en }); }

for (const row of [
 ['hiddenView', '{name} (hidden)', '{name} (ausgeblendet)', '{name} (masquée)', '{name} (oculta)'],
 ['hideView', 'Hide', 'Ausblenden', 'Masquer', 'Ocultar'],
 ['unhideView', 'Unhide', 'Einblenden', 'Afficher', 'Mostrar'],
 ['deleteView', 'Delete view', 'Ansicht löschen', 'Supprimer la vue', 'Eliminar vista'],
 ['viewId', 'View ID: ', 'Ansichts-ID: ', 'ID de vue : ', 'ID de vista: '],
 ['viewIdHelp', '. Use this exact ID for Starting named view in Home Assistant’s visual card editor or for a camera automation.', '. Verwenden Sie genau diese ID für die benannte Startansicht im visuellen Karteneditor von Home Assistant oder für eine Kameraautomation.', '. Utilisez cet ID exact pour la vue nommée initiale dans l’éditeur visuel de carte Home Assistant ou une automatisation de caméra.', '. Use este ID exacto para la vista inicial con nombre en el editor visual de tarjetas de Home Assistant o una automatización de cámara.'],
 ['missingViewFloor', 'Missing floor: {id}. Uncheck to remove this saved link.', 'Fehlende Etage: {id}. Deaktivieren Sie das Kästchen, um diese gespeicherte Verknüpfung zu entfernen.', 'Étage absent : {id}. Décochez pour retirer ce lien enregistré.', 'Planta ausente: {id}. Desmarque para quitar este vínculo guardado.'],
 ['camera', 'Camera', 'Kamera', 'Caméra', 'Cámara'],
 ['cameraTop', 'Camera (top view)', 'Kamera (Draufsicht)', 'Caméra (vue de dessus)', 'Cámara (vista superior)'],
 ['savedTop', 'Top view opens with a saved centre and zoom.', 'Die Draufsicht öffnet sich mit gespeichertem Zentrum und Zoom.', 'La vue de dessus s’ouvre avec un centre et un zoom enregistrés.', 'La vista superior se abre con un centro y zoom guardados.'],
 ['currentTop', 'Top view keeps the current position.', 'Die Draufsicht behält die aktuelle Position.', 'La vue de dessus conserve la position actuelle.', 'La vista superior conserva la posición actual.'],
 ['savedCamera', 'Opens with a saved camera.', 'Öffnet sich mit einer gespeicherten Kamera.', 'S’ouvre avec une caméra enregistrée.', 'Se abre con una cámara guardada.'],
 ['framedCamera', 'Opens framing the house.', 'Öffnet sich mit dem Haus im Bild.', 'S’ouvre en cadrant la maison.', 'Se abre encuadrando la casa.'],
 ['cardDefault', 'Card default ({value})', 'Kartenvorgabe ({value})', 'Valeur par défaut de la carte ({value})', 'Valor predeterminado de la tarjeta ({value})'],
 ['centre', 'Centre', 'Zentrum', 'Centre', 'Centro'],
 ['cursor', 'Cursor', 'Mauszeiger', 'Curseur', 'Cursor'],
 ['hideObjects', 'Hide its {count} object(s)', 'Seine {count} Objekt(e) ausblenden', 'Masquer ses {count} objet(s)', 'Ocultar sus {count} objeto(s)'],
 ['showObjects', 'Show its {count} object(s)', 'Seine {count} Objekt(e) anzeigen', 'Afficher ses {count} objet(s)', 'Mostrar sus {count} objeto(s)'],
 ['partlyTitle', 'Partly shown in this view', 'In dieser Ansicht teilweise gezeigt', 'Partiellement affiché dans cette vue', 'Mostrado parcialmente en esta vista'],
 ['visibleTitle', 'Visible in this view', 'In dieser Ansicht sichtbar', 'Visible dans cette vue', 'Visible en esta vista'],
 ['hiddenTitle', 'Hidden in this view', 'In dieser Ansicht ausgeblendet', 'Masqué dans cette vue', 'Oculto en esta vista'],
 ['partly', 'partly', 'teilweise', 'partiellement', 'parcialmente'],
 ['cardOverride', 'Card override', 'Kartenvorgabe', 'Réglage de la carte', 'Ajuste de la tarjeta'],
 ['overrideTitle', 'This card has an override for this part. Use Home Assistant’s visual card editor to inspect or clear it; it takes priority over the shared layout setting.', 'Diese Karte hat eine Vorgabe für diesen Teil. Prüfen oder löschen Sie sie im visuellen Karteneditor von Home Assistant; sie hat Vorrang vor dem gemeinsamen Layout.', 'Cette carte remplace le réglage de cette partie. Inspectez ou effacez ce réglage dans l’éditeur visuel de carte Home Assistant ; il prime sur la disposition partagée.', 'Esta tarjeta tiene un ajuste para esta parte. Revíselo o bórrelo en el editor visual de tarjetas de Home Assistant; tiene prioridad sobre el diseño compartido.'],
 ['eyeDefault', 'Default (from the model); click: show', 'Vorgabe (aus dem Modell); klicken: anzeigen', 'Par défaut (du modèle) ; cliquer : afficher', 'Predeterminado (del modelo); pulsar: mostrar'],
 ['eyeShown', 'Shown here; click: hide', 'Hier angezeigt; klicken: ausblenden', 'Affiché ici ; cliquer : masquer', 'Mostrado aquí; pulsar: ocultar'],
 ['eyeHidden', 'Hidden here; click: back to default', 'Hier ausgeblendet; klicken: zur Vorgabe', 'Masqué ici ; cliquer : valeur par défaut', 'Oculto aquí; pulsar: volver al predeterminado'],
 ['sectionHelp', 'The Section button (box cutter) cuts the house here and looks at the cut face. ', 'Die Schnitt-Schaltfläche (Cutter) schneidet das Haus hier und zeigt die Schnittfläche. ', 'Le bouton Coupe (cutter) coupe la maison ici et regarde la face coupée. ', 'El botón Sección (cúter) corta la casa aquí y muestra la cara cortada. '],
 ['sectionSaved', 'Saved for this view.', 'Für diese Ansicht gespeichert.', 'Enregistré pour cette vue.', 'Guardado para esta vista.'],
 ['sectionModel', 'From the model.', 'Aus dem Modell.', 'Du modèle.', 'Del modelo.'],
 ['sectionDefault', 'Default: through the middle of the house.', 'Vorgabe: durch die Hausmitte.', 'Par défaut : au milieu de la maison.', 'Predeterminado: por el centro de la casa.'],
 ['sectionEast', 'Position (m east)', 'Position (m Ost)', 'Position (m vers l’est)', 'Posición (m este)'],
 ['sectionNorth', 'Position (m north)', 'Position (m Nord)', 'Position (m vers le nord)', 'Posición (m norte)'],
 ['hideHere', 'Hide in this view', 'In dieser Ansicht ausblenden', 'Masquer dans cette vue', 'Ocultar en esta vista'],
 ['showHere', 'Show in this view', 'In dieser Ansicht anzeigen', 'Afficher dans cette vue', 'Mostrar en esta vista'],
 ['hideAll', 'Hide in all views', 'In allen Ansichten ausblenden', 'Masquer dans toutes les vues', 'Ocultar en todas las vistas'],
 ['revealTree', 'Reveal in tree', 'Im Baum anzeigen', 'Afficher dans l’arbre', 'Mostrar en el árbol'],
 ['northView', 'North', 'Nord', 'Nord', 'Norte'],
 ['southView', 'South', 'Süd', 'Sud', 'Sur'],
 ['eastView', 'East', 'Ost', 'Est', 'Este'],
 ['westView', 'West', 'West', 'Ouest', 'Oeste'],
 ['uploading', 'Uploading {name}…', '{name} wird hochgeladen…', 'Importation de {name}…', 'Cargando {name}…'],
 ['replaceModel', 'Replace model', 'Modell ersetzen', 'Remplacer le modèle', 'Reemplazar modelo'],
 ['uploadModel', 'Upload .glb', '.glb hochladen', 'Importer .glb', 'Cargar .glb'],
 ['removeModel', 'Remove model', 'Modell entfernen', 'Retirer le modèle', 'Quitar modelo'],
 ['reallyRemove', 'Really remove?', 'Wirklich entfernen?', 'Retirer vraiment ?', '¿Quitar realmente?'],
 ['positionStale', 'The model settings or account changed. Leave this tab and reopen Model before applying exact position values.', 'Die Modelleinstellungen oder das Konto haben sich geändert. Verlassen Sie diesen Reiter und öffnen Sie Modell erneut, bevor Sie genaue Positionswerte anwenden.', 'Les paramètres du modèle ou le compte ont changé. Quittez cet onglet et rouvrez Modèle avant d’appliquer des valeurs de position exactes.', 'Cambiaron los ajustes del modelo o la cuenta. Salga de esta pestaña y vuelva a abrir Modelo antes de aplicar valores exactos de posición.'],
 ['mergeChanged', 'Draw calls: {before} → {after} (meshes {beforeMeshes} → {afterMeshes})', 'Zeichenaufrufe: {before} → {after} (Meshes {beforeMeshes} → {afterMeshes})', 'Appels de rendu : {before} → {after} (maillages {beforeMeshes} → {afterMeshes})', 'Llamadas de dibujo: {before} → {after} (mallas {beforeMeshes} → {afterMeshes})'],
 ['mergeCount', 'Draw calls: {calls} ({meshes} meshes)', 'Zeichenaufrufe: {calls} ({meshes} Meshes)', 'Appels de rendu : {calls} ({meshes} maillages)', 'Llamadas de dibujo: {calls} ({meshes} mallas)'],
 ['mergeOff', 'Draw calls: {calls} ({meshes} meshes, merging off)', 'Zeichenaufrufe: {calls} ({meshes} Meshes, Zusammenführen aus)', 'Appels de rendu : {calls} ({meshes} maillages, fusion désactivée)', 'Llamadas de dibujo: {calls} ({meshes} mallas, unión desactivada)'],
 ['reportCounts', '{errors} error(s), {warnings} warning(s)', '{errors} Fehler, {warnings} Warnung(en)', '{errors} erreur(s), {warnings} avertissement(s)', '{errors} error(es), {warnings} aviso(s)'],
 ['modelChanges', 'Since the last setup: {added} new part(s) (assigned automatically below, marked auto) and {missing} part(s) no longer in the model.', 'Seit der letzten Einrichtung: {added} neue Teile (unten automatisch zugewiesen und als automatisch markiert) und {missing} Teile nicht mehr im Modell.', 'Depuis la dernière configuration : {added} nouvelle(s) partie(s) (attribuées automatiquement ci-dessous, marquées auto) et {missing} partie(s) absentes du modèle.', 'Desde la última configuración: {added} parte(s) nueva(s) (asignadas automáticamente abajo, marcadas automático) y {missing} parte(s) que ya no están en el modelo.'],
 ['floorGone', 'floor missing — choose a replacement or no floor', 'Etage fehlt — wählen Sie einen Ersatz oder keine Etage', 'étage absent — choisissez un remplacement ou aucun étage', 'falta la planta — elija un reemplazo o sin planta'],
 ['areaGone', 'area missing — choose a replacement or no area', 'Bereich fehlt — wählen Sie einen Ersatz oder keinen Bereich', 'zone absente — choisissez un remplacement ou aucune zone', 'falta el área — elija un reemplazo o sin área'],
 ['unfloored', 'level not on a floor', 'Ebene gehört zu keiner Etage', 'niveau sans étage', 'nivel sin planta'],
 ['noOutline', 'no outline', 'kein Umriss', 'aucun contour', 'sin contorno'],
 ['noAreaOption', '— no area —', '— kein Bereich —', '— aucune zone —', '— sin área —'],
 ['missingModelArea', 'Missing area: {id}', 'Fehlender Bereich: {id}', 'Zone absente : {id}', 'Área ausente: {id}'],
 ['modelRoomsHelp', 'Rooms from the model replace rooms drawn for the same area. ', 'Räume aus dem Modell ersetzen gezeichnete Räume für denselben Bereich. ', 'Les pièces du modèle remplacent les pièces dessinées pour la même zone. ', 'Las habitaciones del modelo reemplazan las dibujadas para la misma área. '],
 ['createAreas', 'Create areas in Home Assistant', 'Bereiche in Home Assistant erstellen', 'Créer des zones dans Home Assistant', 'Crear áreas en Home Assistant'],
 ['untaggedHelp', '“{path}” is not tagged in the model, so it can’t be assigned. Ask the model builder to tag it (docs/model-builder-guide.md).', '„{path}“ ist im Modell nicht markiert und kann daher nicht zugewiesen werden. Bitten Sie den Modellbauer um Markierung (docs/model-builder-guide.md).', '« {path} » n’est pas balisé dans le modèle et ne peut pas être attribué. Demandez au créateur de le baliser (docs/model-builder-guide.md).', '«{path}» no está etiquetado en el modelo y no se puede asignar. Pida al creador que lo etiquete (docs/model-builder-guide.md).'],
 ['urlModel', 'This card shows the URL model ', 'Diese Karte zeigt das URL-Modell ', 'Cette carte affiche le modèle URL ', 'Esta tarjeta muestra el modelo de URL '],
 ['urlModelHelp', ' from its card settings. To upload a model here, open Home Assistant’s dashboard editor, edit this card, choose Show visual editor, clear Model URL and its alignment settings, then press Save. The URL and uploaded model use separate sources.', ' aus ihren Karteneinstellungen. Zum Hochladen öffnen Sie den Dashboard-Editor von Home Assistant, bearbeiten diese Karte, wählen den visuellen Editor, löschen Modell-URL und Ausrichtung und speichern. URL und hochgeladenes Modell verwenden getrennte Quellen.', ' depuis ses paramètres. Pour importer un modèle ici, ouvrez l’éditeur de tableau de bord Home Assistant, modifiez cette carte, choisissez l’éditeur visuel, effacez l’URL du modèle et son alignement, puis enregistrez. URL et modèle importé utilisent des sources distinctes.', ' desde sus ajustes. Para cargar un modelo aquí, abra el editor del panel de Home Assistant, edite esta tarjeta, elija el editor visual, borre la URL del modelo y su alineación y guarde. La URL y el modelo cargado usan fuentes separadas.'],
 ['integrationNeeded', 'Uploading a model needs the Taylor\'s 3D integration (Settings → Devices & services → Add integration). Without it, put a .glb in /config/www and enter ', 'Zum Hochladen ist die Integration Taylor\'s 3D erforderlich (Einstellungen → Geräte & Dienste → Integration hinzufügen). Ohne sie legen Sie eine .glb-Datei in /config/www ab und geben ', 'L’importation nécessite l’intégration Taylor\'s 3D (Paramètres → Appareils et services → Ajouter une intégration). Sans elle, placez un .glb dans /config/www et saisissez ', 'Para cargar un modelo necesita la integración Taylor\'s 3D (Ajustes → Dispositivos y servicios → Añadir integración). Sin ella, coloque un .glb en /config/www e introduzca '],
 ['integrationUrl', ' in Model URL in Home Assistant’s visual card editor.', ' unter Modell-URL im visuellen Karteneditor von Home Assistant ein.', ' dans URL du modèle dans l’éditeur visuel de carte Home Assistant.', ' en URL del modelo en el editor visual de tarjetas de Home Assistant.'],
 ['layoutKeyHelp', 'layout_key "{id}" can only contain letters, digits, - and _ for model uploads.', 'layout_key "{id}" darf für Modell-Uploads nur Buchstaben, Ziffern, - und _ enthalten.', 'layout_key "{id}" ne peut contenir que lettres, chiffres, - et _ pour importer des modèles.', 'layout_key "{id}" solo puede contener letras, dígitos, - y _ para cargar modelos.'],
 ['modelIntro', 'A 3D model of the house (.glb) shown under the plan. Parts tagged as levels, rooms and zones (', 'Ein 3D-Modell des Hauses (.glb) unter dem Plan. Als Ebenen, Räume und Zonen markierte Teile (', 'Un modèle 3D de la maison (.glb) sous le plan. Les parties balisées en niveaux, pièces et zones (', 'Un modelo 3D de la casa (.glb) bajo el plano. Las partes etiquetadas como niveles, habitaciones y zonas ('],
 ['modelTagHelp', ' tags, see ', '-Markierungen, siehe ', ' balises, voir ', ' etiquetas, consulte '],
 ['modelIntroEnd', ') are shown per floor and become rooms; a tagged model shows whole levels (lower floors stay, upper ones are hidden); only an untagged model is cut at the top of the selected storey. It is stored in Home Assistant and only shown to logged-in users.', ') erscheinen pro Etage und werden Räume; ein markiertes Modell zeigt ganze Ebenen (untere bleiben, obere werden ausgeblendet); nur ein unmarkiertes Modell wird am oberen Rand der gewählten Etage geschnitten. Es wird in Home Assistant gespeichert und nur angemeldeten Nutzern gezeigt.', ') s’affichent par étage et deviennent des pièces ; un modèle balisé montre des niveaux entiers (les étages inférieurs restent, les supérieurs sont masqués) ; seul un modèle non balisé est coupé en haut de l’étage choisi. Il est stocké dans Home Assistant et visible uniquement aux utilisateurs connectés.', ') se muestran por planta y se convierten en habitaciones; un modelo etiquetado muestra niveles completos (las plantas inferiores quedan y las superiores se ocultan); solo un modelo sin etiquetas se corta arriba de la planta seleccionada. Se guarda en Home Assistant y solo lo ven usuarios conectados.'],
 ['modelPartCounts', '{levels} level(s), {rooms} room(s), {zones} zone(s), {objects} object(s)', '{levels} Ebene(n), {rooms} Raum/Räume, {zones} Zone(n), {objects} Objekt(e)', '{levels} niveau(x), {rooms} pièce(s), {zones} zone(s), {objects} objeto(s)', '{levels} nivel(es), {rooms} habitación(es), {zones} zona(s), {objects} objeto(s)'],
 ['modelObjectsLater', ' (configure linked devices in Objects)', ' (verknüpfte Geräte unter Objekte einrichten)', ' (configurez les appareils liés dans Objets)', ' (configure los dispositivos vinculados en Objetos)'],
 ['modelFindHelp', '. Click a part of the model to find it here.', '. Klicken Sie einen Modellteil an, um ihn hier zu finden.', '. Cliquez sur une partie du modèle pour la trouver ici.', '. Pulse una parte del modelo para encontrarla aquí.'],
 ['storageShared', 'Shared: stored by the Taylor\'s 3D integration, every user and device sees the same layout.', 'Gemeinsam: In der Integration Taylor\'s 3D gespeichert; alle Nutzer und Geräte sehen dasselbe Layout.', 'Partagé : stocké par l’intégration Taylor\'s 3D, tous les utilisateurs et appareils voient la même disposition.', 'Compartido: guardado por la integración Taylor\'s 3D; todos los usuarios y dispositivos ven el mismo diseño.'],
 ['storageUser', 'Per user: stored in your HA user data. Other users will not see this layout. Install the Taylor\'s 3D integration to share it.', 'Pro Nutzer: In Ihren HA-Nutzerdaten gespeichert. Andere Nutzer sehen dieses Layout nicht. Installieren Sie Taylor\'s 3D zum Teilen.', 'Par utilisateur : stocké dans vos données HA. Les autres utilisateurs ne voient pas cette disposition. Installez Taylor\'s 3D pour la partager.', 'Por usuario: guardado en sus datos de HA. Otros usuarios no verán este diseño. Instale Taylor\'s 3D para compartirlo.'],
 ['storageBrowser', 'This browser only: other browsers and devices will not see this layout. Install the Taylor\'s 3D integration to share it.', 'Nur dieser Browser: Andere Browser und Geräte sehen dieses Layout nicht. Installieren Sie Taylor\'s 3D zum Teilen.', 'Ce navigateur seulement : les autres navigateurs et appareils ne voient pas cette disposition. Installez Taylor\'s 3D pour la partager.', 'Solo este navegador: otros navegadores y dispositivos no verán este diseño. Instale Taylor\'s 3D para compartirlo.'],
 ['storageLoading', 'Storage not loaded yet.', 'Speicher noch nicht geladen.', 'Stockage pas encore chargé.', 'Almacenamiento aún sin cargar.'],
 ['linksAttention', '{count} saved link(s) need attention. The layout and these choices are kept so you can repair them.', '{count} gespeicherte Verknüpfung(en) benötigen Aufmerksamkeit. Das Layout und diese Auswahl bleiben zur Reparatur erhalten.', '{count} lien(s) enregistré(s) nécessitent votre attention. La disposition et ces choix sont conservés pour les réparer.', '{count} vínculo(s) guardado(s) requieren atención. El diseño y estas opciones se conservan para repararlos.'],
 ['linksRepairHelp', 'Use Rooms or Model for area/floor links, Objects for model devices, Cameras for coverage, Overlays for sensors, Tracking for presence/vehicle/vacuum sources and positions, and Views for named-view floors. Choose the replacement deliberately, or clear the link.', 'Nutzen Sie Räume oder Modell für Bereichs-/Etagenlinks, Objekte für Modellgeräte, Kameras für Abdeckung, Überlagerungen für Sensoren, Tracking für Anwesenheits-/Fahrzeug-/Staubsaugerquellen und Positionen und Ansichten für benannte Etagenansichten. Wählen Sie bewusst einen Ersatz oder löschen Sie die Verknüpfung.', 'Utilisez Pièces ou Modèle pour les zones/étages, Objets pour les appareils du modèle, Caméras pour la couverture, Superpositions pour les capteurs, Suivi pour les sources et positions de présence/véhicules/aspirateurs, et Vues pour les étages des vues nommées. Choisissez délibérément un remplacement ou effacez le lien.', 'Use Habitaciones o Modelo para vínculos de áreas/plantas, Objetos para dispositivos del modelo, Cámaras para cobertura, Capas para sensores, Seguimiento para fuentes y posiciones de presencia/vehículos/aspiradores, y Vistas para plantas de vistas con nombre. Elija el reemplazo de forma deliberada o borre el vínculo.'],
 ['linksValid', 'No missing saved links were found in the available Home Assistant data.', 'In den verfügbaren Home-Assistant-Daten wurden keine fehlenden gespeicherten Verknüpfungen gefunden.', 'Aucun lien enregistré manquant dans les données Home Assistant disponibles.', 'No se encontraron vínculos guardados ausentes en los datos disponibles de Home Assistant.'],
]) add(...row);
// Literal apostrophes are retained in the English product name.
for (const row of [
 ['pickFloorNotice', "Click on a room's floor", 'Klicken Sie auf den Boden eines Raums', 'Cliquez sur le sol d’une pièce', 'Pulse el suelo de una habitación'],
 ['linkedNotice', 'Linked {name} to {area}', '{name} mit {area} verknüpft', '{name} lié à {area}', '{name} vinculado a {area}'],
 ['traceError', 'Could not trace this floor: {error}', 'Dieser Boden konnte nicht ermittelt werden: {error}', 'Impossible de tracer ce sol : {error}', 'No se pudo trazar este suelo: {error}'],
 ['overlayFirst', 'Set the map overlay first.', 'Richten Sie zuerst die Kartenüberlagerung ein.', 'Configurez d’abord la carte superposée.', 'Configure primero la capa del mapa.'],
 ['outsideImage', 'That point is outside the map image.', 'Dieser Punkt liegt außerhalb des Kartenbildes.', 'Ce point est hors de l’image de carte.', 'Ese punto está fuera de la imagen del mapa.'],
 ['imageError', "Can't read the map image.", 'Das Kartenbild kann nicht gelesen werden.', 'Impossible de lire l’image de carte.', 'No se puede leer la imagen del mapa.'],
 ['objectLinkNotice', 'Choose a current entity from the suggestions. A saved unavailable link is kept until you deliberately repair or clear it.', 'Wählen Sie eine aktuelle Entität aus den Vorschlägen. Eine gespeicherte, nicht verfügbare Verknüpfung bleibt erhalten, bis Sie sie bewusst reparieren oder löschen.', 'Choisissez une entité actuelle dans les suggestions. Un lien enregistré indisponible est conservé jusqu’à sa réparation ou son effacement délibéré.', 'Elija una entidad actual de las sugerencias. Un vínculo guardado no disponible se conserva hasta que lo repare o borre de forma deliberada.'],
 ['mowerLinkNotice', 'Choose a current entity from the suggestions. Hidden, disabled and diagnostic links are retained only when already saved.', 'Wählen Sie eine aktuelle Entität aus den Vorschlägen. Ausgeblendete, deaktivierte und Diagnose-Verknüpfungen bleiben nur erhalten, wenn sie bereits gespeichert sind.', 'Choisissez une entité actuelle dans les suggestions. Les liens masqués, désactivés et de diagnostic sont conservés seulement s’ils sont déjà enregistrés.', 'Elija una entidad actual de las sugerencias. Los vínculos ocultos, desactivados y de diagnóstico solo se conservan si ya están guardados.'],
 ['pickPivotNotice', 'Click on the model or the floor', 'Klicken Sie auf das Modell oder den Boden', 'Cliquez sur le modèle ou le sol', 'Pulse el modelo o el suelo'],
 ['topCentreNotice', 'Top view of "{name}" now centres here.', 'Die Draufsicht von "{name}" hat jetzt hier ihr Zentrum.', 'La vue de dessus de "{name}" est maintenant centrée ici.', 'La vista superior de "{name}" se centra aquí ahora.'],
 ['pivotNotice', 'Rotation centre of "{name}" set.', 'Drehzentrum von "{name}" festgelegt.', 'Centre de rotation de "{name}" défini.', 'Centro de rotación de "{name}" establecido.'],
 ['pickModelNotice', 'Click on a part of the model', 'Klicken Sie auf einen Modellteil', 'Cliquez sur une partie du modèle', 'Pulse una parte del modelo'],
 ['savedTopNotice', 'Saved the current top view as the start of "{name}".', 'Aktuelle Draufsicht als Start von "{name}" gespeichert.', 'Vue de dessus actuelle enregistrée comme début de "{name}".', 'Vista superior actual guardada como inicio de "{name}".'],
 ['savedCameraNotice', 'Saved the current camera as the start of "{name}".', 'Aktuelle Kamera als Start von "{name}" gespeichert.', 'Caméra actuelle enregistrée comme début de "{name}".', 'Cámara actual guardada como inicio de "{name}".'],
 ['glbNotice', 'Choose a .glb file (binary glTF). Export one with tools/export-glb.js.', 'Wählen Sie eine .glb-Datei (binäres glTF). Exportieren Sie eine mit tools/export-glb.js.', 'Choisissez un fichier .glb (glTF binaire). Exportez-en un avec tools/export-glb.js.', 'Elija un archivo .glb (glTF binario). Exporte uno con tools/export-glb.js.'],
 ['uploadedNotice', 'Uploaded {name} ({size} MB).', '{name} hochgeladen ({size} MB).', '{name} importé ({size} Mo).', '{name} cargado ({size} MB).'],
 ['screenSavedNotice', 'Screen name saved on this browser.', 'Bildschirmname in diesem Browser gespeichert.', 'Nom d’écran enregistré dans ce navigateur.', 'Nombre de pantalla guardado en este navegador.'],
 ['screenDefaultNotice', 'This browser now uses the card screen name.', 'Dieser Browser verwendet jetzt den Bildschirmnamen der Karte.', 'Ce navigateur utilise maintenant le nom d’écran de la carte.', 'Este navegador usa ahora el nombre de pantalla de la tarjeta.'],
 ['nothingToggleNotice', 'Nothing to toggle: bind a working entity first.', 'Nichts zum Umschalten: Verknüpfen Sie zuerst eine funktionierende Entität.', 'Rien à basculer : liez d’abord une entité fonctionnelle.', 'Nada que alternar: vincule primero una entidad que funcione.'],
 ['copiedNotice', 'Copied {count} line(s).', '{count} Zeile(n) kopiert.', '{count} ligne(s) copiée(s).', '{count} línea(s) copiada(s).'],
 ['clipboardNotice', 'Copy is blocked here; select the lines and copy them by hand.', 'Kopieren ist hier gesperrt; wählen Sie die Zeilen aus und kopieren Sie sie von Hand.', 'La copie est bloquée ici ; sélectionnez les lignes et copiez-les manuellement.', 'La copia está bloqueada aquí; seleccione las líneas y cópielas manualmente.'],
 ['mowerReadingNotice', 'No position reading from the mower entity right now.', 'Aktuell kein Positionswert von der Mäher-Entität.', 'Aucune position de l’entité tondeuse actuellement.', 'La entidad del cortacésped no tiene una lectura de posición ahora.'],
 ['mowerMissingFloor', 'Missing floor ', 'Fehlende Etage ', 'Étage absent ', 'Planta ausente '],
 ['mowerRepairFloor', '. Choose its replacement before placing the mower.', '. Wählen Sie einen Ersatz, bevor Sie den Mäher platzieren.', '. Choisissez son remplacement avant de placer la tondeuse.', '. Elija su reemplazo antes de colocar el cortacésped.'],
 ['pickMowerImageEntity', 'Pick the mower entity: its marker follows the icon found on the map image.', 'Wählen Sie die Mäher-Entität: Ihr Marker folgt dem gefundenen Symbol im Kartenbild.', 'Choisissez l’entité tondeuse : son repère suit l’icône trouvée sur l’image de carte.', 'Elija la entidad del cortacésped: su marcador sigue el icono encontrado en la imagen del mapa.'],
 ['pickMowerEntity', 'Pick the entity that reports the mower position.', 'Wählen Sie die Entität, die die Mäherposition meldet.', 'Choisissez l’entité qui indique la position de la tondeuse.', 'Elija la entidad que informa de la posición del cortacésped.'],
 ['missingMowerEntity', 'Entity {id} not found.', 'Entität {id} nicht gefunden.', 'Entité {id} introuvable.', 'Entidad {id} no encontrada.'],
 ['mowerNoXY', 'No numeric {x} / {y} attributes on {id}.', 'Keine numerischen Attribute {x} / {y} für {id}.', 'Aucun attribut numérique {x} / {y} sur {id}.', 'Sin atributos numéricos {x} / {y} en {id}.'],
 ['mowerNoGps', 'No latitude/longitude on {id} (state: {state}).', 'Kein Breiten-/Längengrad für {id} (Zustand: {state}).', 'Aucune latitude/longitude sur {id} (état : {state}).', 'Sin latitud/longitud en {id} (estado: {state}).'],
 ['mowerReading', 'Reading {value}', 'Messwert {value}', 'Valeur {value}', 'Lectura {value}'],
 ['mowerOnPlan', 'on plan ({x}, {y})', 'im Plan ({x}, {y})', 'sur le plan ({x}, {y})', 'en el plano ({x}, {y})'],
 ['mowerCalibrate', 'not on the plan yet: add a calibration point', 'noch nicht im Plan: Kalibrierpunkt hinzufügen', 'pas encore sur le plan : ajoutez un point d’étalonnage', 'aún no está en el plano: añada un punto de calibración'],
 ['mowerAddOverlay', 'Add the map overlay below and align it with the plan: that alignment is the calibration.', 'Fügen Sie unten die Kartenüberlagerung hinzu und richten Sie sie am Plan aus: Diese Ausrichtung ist die Kalibrierung.', 'Ajoutez la carte superposée ci-dessous et alignez-la sur le plan : cet alignement est l’étalonnage.', 'Añada la capa del mapa abajo y alinéela con el plano: esa alineación es la calibración.'],
 ['mowerPickColour', 'Pick the mower icon colour on the map (below).', 'Wählen Sie unten die Farbe des Mähersymbols auf der Karte.', 'Choisissez la couleur de l’icône de la tondeuse sur la carte ci-dessous.', 'Elija el color del icono del cortacésped en el mapa (abajo).'],
 ['mowerNotFound', 'Mower icon not found.', 'Mähersymbol nicht gefunden.', 'Icône de tondeuse introuvable.', 'Icono del cortacésped no encontrado.'],
 ['mowerLastSeen', 'Mower icon not found (last seen at {x}, {y}).', 'Mähersymbol nicht gefunden (zuletzt bei {x}, {y}).', 'Icône de tondeuse introuvable (dernière position {x}, {y}).', 'Icono del cortacésped no encontrado (última posición {x}, {y}).'],
 ['mowerFound', 'Found at {x}, {y} ({count} px)', 'Gefunden bei {x}, {y} ({count} px)', 'Trouvée à {x}, {y} ({count} px)', 'Encontrado en {x}, {y} ({count} px)'],
 ['mowerLooking', 'Looking for the mower icon…', 'Mähersymbol wird gesucht…', 'Recherche de l’icône de tondeuse…', 'Buscando el icono del cortacésped…'],
]) add(...row);

for (const row of [
 ['screenExample', 'e.g. kitchen-wall', 'z. B. kitchen-wall', 'par ex. kitchen-wall', 'p. ej. kitchen-wall'],
 ['calibrationStart', 'Calibration (', 'Kalibrierung (', 'Étalonnage (', 'Calibración ('],
 ['autoNoFloor', 'auto (no floor)', 'automatisch (keine Etage)', 'auto (aucun étage)', 'automático (sin planta)'],
 ['keepWest', 'Keep west half', 'Westhälfte behalten', 'Garder la moitié ouest', 'Mantener la mitad oeste'],
 ['keepEast', 'Keep east half', 'Osthälfte behalten', 'Garder la moitié est', 'Mantener la mitad este'],
 ['keepNorth', 'Keep north half', 'Nordhälfte behalten', 'Garder la moitié nord', 'Mantener la mitad norte'],
 ['keepSouth', 'Keep south half', 'Südhälfte behalten', 'Garder la moitié sud', 'Mantener la mitad sur'],
 ['levelOne', '{count} level', '{count} Ebene', '{count} niveau', '{count} nivel'],
 ['levelMany', '{count} levels', '{count} Ebenen', '{count} niveaux', '{count} niveles'],
 ['roomOne', '{count} room', '{count} Raum', '{count} pièce', '{count} habitación'],
 ['roomMany', '{count} rooms', '{count} Räume', '{count} pièces', '{count} habitaciones'],
 ['zoneOne', '{count} zone', '{count} Zone', '{count} zone', '{count} zona'],
 ['zoneMany', '{count} zones', '{count} Zonen', '{count} zones', '{count} zonas'],
 ['objectOne', '{count} object', '{count} Objekt', '{count} objet', '{count} objeto'],
 ['objectMany', '{count} objects', '{count} Objekte', '{count} objets', '{count} objetos'],
 ['filterMissing', 'missing', 'fehlt', 'absente', 'ausente'],
 ['filterHidden', 'hidden', 'ausgeblendet', 'masquée', 'oculta'],
 ['filterDisabled', 'disabled', 'deaktiviert', 'désactivée', 'desactivada'],
 ['filterDiagnostic', 'diagnostic', 'Diagnose', 'diagnostic', 'diagnóstico'],
 ['filterConfig', 'config', 'Konfiguration', 'configuration', 'configuración'],
 ['entityNoStateIssue', '{id} has no current state.', '{id} hat keinen aktuellen Zustand.', '{id} n’a pas d’état actuel.', '{id} no tiene estado actual.'],
]) add(...row);
for (const [kind, en, de, fr, es] of [
 ['area', 'area', 'Bereich', 'zone', 'área'], ['floor', 'floor', 'Etage', 'étage', 'planta'],
 ['entity', 'entity', 'Entität', 'entité', 'entidad'], ['device', 'device', 'Gerät', 'appareil', 'dispositivo'],
 ['room', 'room', 'Raum', 'pièce', 'habitación'], ['anchor', 'anchor', 'Anker', 'ancre', 'ancla'],
]) add(`saved${kind[0].toUpperCase()}${kind.slice(1)}Issue`, `Saved ${en} {id} is missing. Relink or clear this choice; its saved layout is preserved.`, `Gespeicherter Verweis (${de}) {id} fehlt. Verknüpfen Sie neu oder löschen Sie diese Auswahl; das gespeicherte Layout bleibt erhalten.`, `Le lien enregistré (${fr}) {id} est absent. Reliez ou effacez ce choix ; la disposition enregistrée est conservée.`, `El vínculo guardado (${es}) {id} falta. Vincule de nuevo o borre esta opción; se conserva el diseño guardado.`);

for (const row of [
 ['importedNotice', 'Imported {rooms} rooms, {pins} pins.', '{rooms} Räume und {pins} Pins importiert.', '{rooms} pièces et {pins} repères importés.', '{rooms} habitaciones y {pins} marcadores importados.'],
 ['mappedFloorsNotice', 'Floors mapped to Home Assistant: {mapping}.', 'Etagen Home Assistant zugeordnet: {mapping}.', 'Étages associés à Home Assistant : {mapping}.', 'Plantas asignadas a Home Assistant: {mapping}.'],
 ['unknownAreaNotice', '{count} area id is not in Home Assistant ({ids}): pick the area for those rooms under Rooms → "Rooms without an HA area", or create the areas.', '{count} Bereichs-ID fehlt in Home Assistant ({ids}): Wählen Sie den Bereich für diese Räume unter Räume → „Räume ohne HA-Bereich“ oder erstellen Sie die Bereiche.', '{count} ID de zone est absent de Home Assistant ({ids}) : choisissez la zone dans Pièces → « Pièces sans zone HA », ou créez les zones.', '{count} ID de área no está en Home Assistant ({ids}): elija el área en Habitaciones → «Habitaciones sin área de HA» o cree las áreas.'],
 ['unknownAreasNotice', '{count} area ids are not in Home Assistant ({ids}): pick the area for those rooms under Rooms → "Rooms without an HA area", or create the areas.', '{count} Bereichs-IDs fehlen in Home Assistant ({ids}): Wählen Sie den Bereich für diese Räume unter Räume → „Räume ohne HA-Bereich“ oder erstellen Sie die Bereiche.', '{count} ID de zones sont absents de Home Assistant ({ids}) : choisissez la zone dans Pièces → « Pièces sans zone HA », ou créez les zones.', '{count} ID de áreas no están en Home Assistant ({ids}): elija el área en Habitaciones → «Habitaciones sin área de HA» o cree las áreas.'],
 ['traceRectangleNotice', "Used the floor piece's bounding rectangle — reshape it if needed", 'Das Begrenzungsrechteck des Bodenteils wurde verwendet — passen Sie es bei Bedarf an', 'Rectangle englobant du sol utilisé — modifiez sa forme si nécessaire', 'Se usó el rectángulo delimitador del suelo; cambie su forma si es necesario'],
 ['libraryRefresh', 'Refresh library', 'Bibliothek aktualisieren', 'Actualiser la bibliothèque', 'Actualizar biblioteca'],
 ['packLicences', 'Published packs and licences', 'Veröffentlichte Pakete und Lizenzen', 'Packs et licences publiés', 'Paquetes y licencias publicados'],
 ['packLicenceHelp', 'Keep the original ZIP with its author and licence when backing up or sharing your layout. A declared licence is supplied by its author.', 'Bewahren Sie die ursprüngliche ZIP mit Autor und Lizenz auf, wenn Sie das Layout sichern oder teilen. Eine angegebene Lizenz stammt vom Autor.', 'Conservez le ZIP original avec son auteur et sa licence pour sauvegarder ou partager votre disposition. La licence déclarée est fournie par l’auteur.', 'Conserve el ZIP original con su autor y licencia al guardar o compartir el diseño. La licencia declarada la facilita su autor.'],
 ['exportPack', 'Export original ZIP', 'Ursprüngliche ZIP exportieren', 'Exporter le ZIP original', 'Exportar ZIP original'],
 ['packAuthor', 'Author: ', 'Autor: ', 'Auteur : ', 'Autor: '],
 ['declaredLicence', '. Declared licence: ', '. Angegebene Lizenz: ', '. Licence déclarée : ', '. Licencia declarada: '],
 ['licenceFile', 'Licence file in the original ZIP: ', 'Lizenzdatei in der ursprünglichen ZIP: ', 'Fichier de licence dans le ZIP original : ', 'Archivo de licencia en el ZIP original: '],
 ['notSupplied', 'Not supplied', 'Nicht angegeben', 'Non fourni', 'No facilitado'],
 ['downloadPack', 'Download original licensed ZIP', 'Ursprüngliche ZIP mit Lizenz herunterladen', 'Télécharger le ZIP original avec licence', 'Descargar ZIP original con licencia'],
 ['cornerTitle', 'Drag to move, right-click to delete', 'Ziehen zum Verschieben, Rechtsklick zum Löschen', 'Déplacer par glissement, clic droit pour supprimer', 'Arrastrar para mover, clic derecho para borrar'],
 ['midpointTitle', 'Drag to add a corner', 'Ziehen zum Hinzufügen einer Ecke', 'Déplacer pour ajouter un coin', 'Arrastrar para añadir una esquina'],
 ['calibrationPointTitle', 'Draft calibration point {label}', 'Entwurfs-Kalibrierpunkt {label}', 'Point d’étalonnage du brouillon {label}', 'Punto de calibración del borrador {label}'],
]) add(...row);

const languages = ['en', 'de', 'fr', 'es'];
const dictionary = Object.freeze(Object.fromEntries(languages.map((language, index) => [language,
  Object.freeze(Object.fromEntries(rows.map(([key, ...values]) => [`editorCore.${key}`, values[index]])))])));
export default dictionary;
for (const entry of coreCaptionEntries) { Object.freeze(entry.scopes); Object.freeze(entry); } Object.freeze(coreCaptionEntries);

const scopes = new Map(['rooms', 'devices', 'objects', 'mower', 'views', 'model', 'data', 'furniture'].map((scope) => [scope, coreCaptionEntries.filter((entry) => entry.scopes.includes(scope))]));
const excluded = '[data-room-actions-editor],[data-model-rendering-editor],[data-wall-presentation-editor],[data-floor-presentation-editor],[data-dashboard-backup-editor],[data-furniture-editor]';
const normalized = (value) => value.replace(/\s+/g, ' ').trim();
const indexes = new Map([...scopes].map(([scope, entries]) => {
  const fields = new Map(), actions = new Map(), prose = [];
  for (const entry of entries) {
    const field = entry.selector.match(/^\[data-field="([^"]+)"\]/)?.[1];
    const action = entry.selector.match(/^\[data-act="([^"]+)"\]/)?.[1];
    const target = field ? fields : action ? actions : null, key = field || action;
    if (target) { const values = target.get(key) || []; values.push(entry); target.set(key, values); } else prose.push(entry);
  }
  return [scope, { fields, actions, prose }];
}));
function mark(selected, entry) {
  const host = entry.kind === 'label' ? selected.closest('label')?.querySelector(':scope > .lab') || selected.closest('label') : selected;
  if (!host || host.closest(excluded)) return;
  if (['title', 'placeholder'].includes(entry.kind)) {
    if (host.getAttribute(entry.kind) === entry.en) host.setAttribute(`data-core-${entry.kind}`, entry.key);
  } else if (host.tagName === 'OPTION') {
    if (normalized(host.textContent) === entry.en) host.dataset.coreCaption = entry.key;
  } else {
    const direct = [...host.childNodes].find((node) => node.nodeType === 3 && normalized(node.textContent) === entry.en);
    if (!direct) return;
    const span = host.ownerDocument.createElement('span'); span.dataset.coreCaption = entry.key;
    span.dataset.coreLeading = direct.textContent.match(/^\s*/)[0]; span.dataset.coreTrailing = direct.textContent.match(/\s*$/)[0];
    span.textContent = direct.textContent; direct.replaceWith(span);
  }
}
// Mark only at a real panel render; HA updates query the small marked caption set.
export function markCoreCaptions(root, scope) {
  const index = indexes.get(scope); if (!index) return;
  for (const selected of root.querySelectorAll('[data-field],[data-act]')) {
    if (selected.closest(excluded)) continue;
    for (const entry of index.fields.get(selected.dataset.field) || []) {
      const option = entry.selector.match(/ option\[value="([^"]*)"\]$/);
      if (option && selected.tagName === 'SELECT') {
        for (const choice of selected.options) if (choice.value === option[1]) mark(choice, entry);
      } else if (!option) mark(selected, entry);
    }
    for (const entry of index.actions.get(selected.dataset.act) || []) if (selected.matches(entry.selector)) mark(selected, entry);
  }
  for (const entry of index.prose) for (const selected of root.querySelectorAll(entry.selector)) mark(selected, entry);
}
export function updateCoreCaptions(root, translate) {
  for (const node of root?.querySelectorAll('[data-core-caption],[data-core-title],[data-core-placeholder]') || []) {
    let params = {}; try { params = JSON.parse(node.dataset.coreParams || '{}'); } catch { /* authored metadata only */ }
    for (const attribute of ['title', 'placeholder']) if (node.dataset[`core${attribute[0].toUpperCase()}${attribute.slice(1)}`]) {
      const value = translate(node.dataset[`core${attribute[0].toUpperCase()}${attribute.slice(1)}`], params);
      if (node.getAttribute(attribute) !== value) node.setAttribute(attribute, value);
    }
    if (node.dataset.coreCaption) {
      const value = (node.dataset.coreLeading || '') + translate(node.dataset.coreCaption, params) + (node.dataset.coreTrailing || '');
      if (node.textContent !== value) node.textContent = value;
    }
  }
}
