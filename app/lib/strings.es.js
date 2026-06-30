/* strings.es.js — RJ30.1-B: Spanish (es-MX) catalog, lazy-loaded by i18n.js
 * only when lang === 'es'. Mirrors the EN key set in i18n.js exactly (a test
 * asserts ES ⊆ EN — no orphan keys). Values are PLAIN TEXT (no HTML); callers
 * escape. File is UTF-8; accents are intentional.
 *
 * Register: Mexican-Spanish football / World Cup. Reviewed for clarity at 390px.
 * Proper nouns (team names) and abbreviations (xPts/xGF/Adv%) are NOT translated
 * here — those stay canonical and live in their owning views.
 */
export const ES = {
  // nav / tabs
  'nav.home': 'Inicio',
  'nav.schedule': 'Calendario',
  'nav.projected': 'Pronóstico',
  'nav.play': 'Jugar',
  'nav.bracket': 'Eliminatoria',
  'nav.pools': 'Quinielas',
  'nav.myBrackets': 'Mis llaves',
  'nav.myPicks': 'Mis picks',
  'nav.venues': 'Sedes',
  'nav.matches': 'Partidos',

  // document.title labels
  'title.home': 'WC26',
  'title.play': 'Jugar',
  'title.bracket': 'Eliminatoria',
  'title.pools': 'Quinielas',
  'title.my-brackets': 'Mis llaves',
  'title.my-picks': 'Mis picks',
  'title.schedule': 'Calendario',
  'title.projected': 'Llave proyectada',
  'title.venues': 'Sedes',
  'title.matches': 'Partidos',
  'title.matchup': 'Partido',
  'title.group': 'Grupo',
  'title.settings': 'Ajustes',
  'title.standings-group': 'Posiciones',
  'title.suffix': 'WC26 Tracker',

  // shell aria-labels
  'aria.back': 'Atrás',
  'aria.settings': 'Ajustes',
  'aria.account': 'Cuenta',
  'aria.app': 'App del Mundial 2026',
  'aria.dataUpdated': 'Última actualización de datos',

  // home view
  'home.hostsFallback': 'EE. UU. · Canadá · México',
  'home.datesFallback': '11 de junio – 19 de julio de 2026',
  'home.dataUpdated': 'Datos actualizados',
  'home.kicksOffIn': 'Arranca en',
  'home.tournamentStarted': 'El torneo comenzó',
  'home.dontMiss': 'No te lo pierdas',
  'home.today': 'Partidos de hoy',
  'home.upNext': 'A continuación',
  'home.fullSchedule': 'Calendario completo',
  'home.allMatches': 'Los 104 partidos',
  'home.recentResults': 'Resultados recientes',
  'home.noneYet': 'Aún no se juegan partidos',
  'home.jumpTo': 'Ir a',
  'home.yourTeam': 'Tu selección',
  'home.pickFavorite': 'Elige tu selección favorita',
  'home.makePrediction': 'Haz tu predicción',
  'home.loading': 'Cargando…',

  // countdown unit labels
  'unit.days': 'días',
  'unit.hrs': 'h',
  'unit.min': 'min',
  'unit.sec': 's',

  // stage / round labels
  'stage.r32': 'Dieciseisavos',
  'stage.r16': 'Octavos de final',
  'stage.qf': 'Cuartos de final',
  'stage.sf': 'Semifinales',
  'stage.final': 'Final',
  'stage.third': 'Tercer lugar',

  // schedule view
  'schedule.empty': 'El calendario completo del torneo aún no se publica.',
  'schedule.myMatches': 'Mis partidos',
  'schedule.showing': 'Mostrando',

  // standings view
  'standings.advanced': 'Clasificó',
  'standings.bestThird': '¿Mejor tercero?',
  'standings.bestThirdShort': 'Mejor tercero',
  'standings.eliminated': 'Eliminado',
  'standings.heading': 'Posiciones',
  'standings.group': 'Grupo',
  'standings.bestThirds': 'Mejores terceros lugares',
  'standings.team': 'Selección',

  // group view
  'group.label': 'Grupo',
  'group.team': 'Selección',
  'group.notFound': 'Grupo no encontrado.',

  // matchup-detail section headings
  'matchup.yourPick': 'Tu pick',
  'matchup.whenWhere': 'Cuándo y dónde',
  'matchup.lineups': 'Alineaciones',
  'matchup.referee': 'Árbitro',
  'matchup.h2h': 'Historial',
  'matchup.form': 'Forma',
  'matchup.scorers': 'Goleadores',
  'matchup.weather': 'Clima',
  'matchup.finalResult': 'Resultado final',

  // settings card titles + language card
  'settings.language': 'Idioma',
  'settings.english': 'English',
  'settings.spanish': 'Español',
  'settings.favorite': 'Selección favorita',
  'settings.theme': 'Tema',
  'settings.motion': 'Movimiento',
  'settings.account': 'Cuenta',
  'settings.model': 'Modelo y analítica',
  'settings.pipeline': 'Estado del pipeline',
  'settings.reset': 'Restablecer',
};
