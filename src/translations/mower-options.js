const en = { 'mower.minimumPixels': 'Minimum matching pixels',
  'mower.minimumPixelsHint': 'Ignore matching colour patches smaller than this many pixels in the sampled map. The default is 4; 0 or 1 allows a one-pixel patch. This changes detection only.',
  'mower.minimumPixelsStale': 'This field belongs to an earlier source or permission context. Reopen Mower and review the current settings.' };
const de = { 'mower.minimumPixels': 'Mindestanzahl passender Pixel',
  'mower.minimumPixelsHint': 'Kleinere passende Farbflächen in der verkleinerten Karte ignorieren. Der Standard ist 4; 0 oder 1 erlaubt eine Fläche mit einem Pixel. Dies ändert nur die Erkennung.',
  'mower.minimumPixelsStale': 'Dieses Feld gehört zu einer früheren Quelle oder Berechtigung. Mäher erneut öffnen und die aktuellen Einstellungen prüfen.' };
const fr = { 'mower.minimumPixels': 'Nombre minimal de pixels correspondants',
  'mower.minimumPixelsHint': 'Ignorer les zones de couleur correspondantes plus petites dans la carte échantillonnée. La valeur par défaut est 4 ; 0 ou 1 autorise un seul pixel. Cela modifie uniquement la détection.',
  'mower.minimumPixelsStale': 'Ce champ appartient à une ancienne source ou autorisation. Rouvrir Tondeuse et vérifier les paramètres actuels.' };
const es = { 'mower.minimumPixels': 'Mínimo de píxeles coincidentes',
  'mower.minimumPixelsHint': 'Ignorar zonas de color coincidentes más pequeñas en el mapa muestreado. El valor predeterminado es 4; 0 o 1 permite un solo píxel. Esto solo cambia la detección.',
  'mower.minimumPixelsStale': 'Este campo pertenece a una fuente o permiso anterior. Reabrir Cortacésped y revisar los ajustes actuales.' };
export default Object.freeze(Object.fromEntries(Object.entries({ en, de, fr, es }).map(([language, messages]) => [language, Object.freeze(messages)])));
