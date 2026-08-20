import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const root = new URL('../data/', import.meta.url).pathname;
const strictAuth = process.env.MAKERLOG_STRICT_AUTH === '1';
const port = Number(process.env.MAKERLOG_PORT || 4173);
const users = [{ id:'admin', name:'Administrator', role:'admin', admin:true, active:true, projectAccessMode:'include', startPage:'home', projectSort:'status:asc', archiveSort:'createdAt:desc', defaultProjectIcon:'box', showOverviewSummary:true, showOverviewRecent:true, showOverviewNext:true, showOverviewRecentlyEdited:true, showOverviewDueSoon:true, showOverviewHighPriority:true, showOverviewActivity:true, showOverviewTimeline:true, overviewRecentRows:2, overviewNextRows:2, overviewRecentlyEditedRows:1, overviewDueSoonRows:2, overviewHighPriorityRows:2, overviewOrder:['summary','recentlyEdited','dueSoon','highPriority','next','recent','activity','timeline'], mustChangePassword:false, createdAt:'2026-08-10T08:00:00Z', lastLoginAt:new Date().toISOString(), projectIds:[], password:'admin' }];
const sessions = strictAuth ? [] : [{ id:'preview-session', token:'preview-token', userId:'admin', name:'Administrator', ip:'127.0.0.1', userAgent:'Make:Log Browser Preview', activeAgoSeconds:0, ageSeconds:300, current:true }];
const audit = [];
const deviceSettings = { wifiSsid:'Werkstatt-WLAN', wifiPassword:'preview-secret', hostname:'makerlog', timezone:'CET-1CEST,M3.5.0,M10.5.0/3', ntpPrimary:'pool.ntp.org', ntpSecondary:'time.nist.gov' };
const smtpSettings = { host:'smtp.example.com', port:465, security:'tls', username:'makerlog@example.com', password:'preview-secret', senderName:'Make:Log', senderEmail:'makerlog@example.com', testRecipient:'admin@example.com', rootCa:'-----BEGIN CERTIFICATE-----\nPREVIEW-CERTIFICATE\n-----END CERTIFICATE-----' };
const backupSchedule = { enabled:false, recipient:'admin@example.com', scope:'projects', intervalDays:7, nextRunAt:0, lastSentAt:0, lastStatus:'Noch nicht ausgeführt' };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const backupPasswordHash = (password, salt) => { let value = `${salt}:${password}`; for (let index = 0; index < 12000; index++) value = sha256(value + salt); return value; };
const validDate = value => /^20\d{2}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(value || '');
const tags = [
  { id:'tag-elektronik', name:'Elektronik', normalizedName:'elektronik', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-esp32', name:'ESP32', normalizedName:'esp32', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-3d-druck', name:'3D-Druck', normalizedName:'3d-druck', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-werkstatt', name:'Werkstatt', normalizedName:'werkstatt', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-holzwerken', name:'Holzwerken', normalizedName:'holzwerken', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-upcycling', name:'Upcycling', normalizedName:'upcycling', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-fotografie', name:'Fotografie', normalizedName:'fotografie', active:true, createdAt:'2026-08-01T08:00:00Z' },
  { id:'tag-solar', name:'Solar', normalizedName:'solar', active:true, createdAt:'2026-08-01T08:00:00Z' }
];
const normalizeTagName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');
const tagIdsForProject = id => ({
  'werkbank-7c31aa':['tag-werkstatt','tag-elektronik'], 'project-1786996729146':['tag-elektronik'],
  'cnc-absaugautomatik':['tag-werkstatt','tag-elektronik'], 'gewaechshaus-wetterstation':['tag-elektronik','tag-esp32'],
  'retro-radio-bluetooth':['tag-elektronik','tag-upcycling'], filamenttrockner:['tag-3d-druck','tag-elektronik'],
  'luftqualitaets-ampel':['tag-werkstatt','tag-elektronik','tag-esp32'], loetrauchabsauger:['tag-werkstatt','tag-3d-druck'],
  'kamera-slider':['tag-fotografie','tag-elektronik','tag-3d-druck'], 'solar-usb-station':['tag-solar','tag-elektronik'],
  'drucker-einhausung':['tag-3d-druck','tag-holzwerken','tag-werkstatt'], 'balkon-bewaesserung':['tag-esp32','tag-elektronik'],
  'led-matrix-uhr':['tag-elektronik','tag-esp32','tag-3d-druck'], 'fahrradlicht-akkupack':['tag-elektronik','tag-upcycling'],
  'mini-arcade-controller':['tag-elektronik','tag-3d-druck'], 'schreibtisch-kabelkanal':['tag-holzwerken','tag-werkstatt'],
  'akkuschrauber-zellentausch':['tag-elektronik','tag-upcycling','tag-werkstatt'], 'smart-mirror-prototyp':['tag-elektronik','tag-holzwerken']
}[id] || []);
const projects = [
  { id:'werkbank-7c31aa', title:'Mobile Elektronik-Werkbank', description:'Eine kompakte Werkbank mit Stromversorgung, Licht und gut erreichbaren Werkzeugen.', status:'active', createdAt:'2026-08-10', tagIds:tagIdsForProject('werkbank-7c31aa'), entryCount:2, latestEntryId:'entry-2', latestEntryDate:'2026-08-16', latestEntryTitle:'Kabelführung festgelegt', latestEntryBody:'Halterung montiert und LED-Leiste auf Funktion geprüft. Kabelführung auf der Rückseite festgelegt.', latestNextStep:'Kabel auf Länge schneiden, beschriften und in den Kabelkanal einziehen.' },
  { id:'project-1786995141059', title:'test', description:'asdasgasdg', status:'active', createdAt:'2026-08-17', entryCount:0 },
  { id:'project-1786996729146', title:'ScopeBuddy', description:'Oszilloskop-Trainer', status:'active', createdAt:'2026-08-17', tagIds:tagIdsForProject('project-1786996729146'), entryCount:1, latestEntryId:'entry-1786996775044', latestEntryDate:'2026-08-17', latestEntryTitle:'Auf MF Hannover gezeigt', latestEntryBody:'Gezeigt auf der MF Hannover. Sehr viel positives Feedback, vor allem von Lehrern, Dozenten etc.', latestNextStep:'' }
];
const details = {
  'werkbank-7c31aa': { ...projects[0], entries:[
    { id:'entry-1', date:'2026-08-12', title:'Grundplatte zugeschnitten', author:'admin', body:'Grundplatte zugeschnitten und alle Komponenten probeweise angeordnet. Die Netzteilhalterung passt ohne Nacharbeit.', nextStep:'Positionen anzeichnen und 4-mm-Bohrungen für die Halterung setzen.' },
    { id:'entry-2', date:'2026-08-16', title:'Kabelführung festgelegt', author:'admin', body:'Halterung montiert und LED-Leiste auf Funktion geprüft. Kabelführung auf der Rückseite festgelegt.', nextStep:'Kabel auf Länge schneiden, beschriften und in den Kabelkanal einziehen.' }
  ],
  tasks:[{ id:'task-werkbank-1', title:'Kabel auf Länge schneiden', description:'Leitungswege vorher noch einmal direkt an der Rückwand prüfen.', status:'In Arbeit', priority:'Hoch', dueDate:'2026-08-24', createdAt:'2026-08-16' }, { id:'task-werkbank-2', title:'Kabel dauerhaft beschriften', description:'Beschriftung an beiden Enden vorsehen.', status:'Offen', priority:'Normal', dueDate:'', createdAt:'2026-08-16' }, { id:'task-werkbank-3', title:'Grundplatte zuschneiden', description:'', status:'Erledigt', priority:'Normal', dueDate:'', createdAt:'2026-08-10' }],
  materials:[{ id:'material-1', name:'Aluminiumprofil 20 × 20 mm', quantity:'2 × 1 m', status:'Gekauft', price:'24,80 €', url:'https://example.com/aluminiumprofil', properties:'Nut 6, eloxiert' }, { id:'material-1786995223029', name:'', quantity:'', status:'Kommt infrage', price:'', url:'', properties:'', createdAt:'2026-08-17' }, { id:'material-1786997659778', name:'jkb', quantity:'', status:'Kommt infrage', price:'', url:'', properties:'', createdAt:'2026-08-17' }],
  contacts:[{ id:'contact-1', name:'Mara Beispiel', role:'Elektronik', company:'Maker Space', email:'mara@example.com', phone:'', notes:'Kennt sich mit der Stromversorgung aus.' }, { id:'contact-1786995230426', name:'', role:'', company:'', email:'', phone:'', notes:'', createdAt:'2026-08-17' }],
  links:[{ id:'link-1', title:'Datenblatt des Netzteils', url:'https://example.com/datenblatt', notes:'Pinbelegung und maximale Last.' }, { id:'link-1786995236987', title:'', url:'', notes:'', createdAt:'2026-08-17' }],
  ideas:[{ id:'idea-1', title:'Werkzeugleiste magnetisch befestigen', status:'Prüfen', description:'Erst mit kleinen Neodym-Magneten testen.' }, { id:'idea-1786995252980', title:'', status:'Offen', description:'', createdAt:'2026-08-17' }]
  },
  'project-1786995141059': { ...projects[1], entries:[], tasks:[], materials:[], contacts:[], links:[], ideas:[] },
  'project-1786996729146': { ...projects[2], entries:[{ id:'entry-1786996775044', author:'admin', title:'Auf MF Hannover gezeigt', body:'Gezeigt auf der MF Hannover. Sehr viel positives Feedback, vor allem von Lehrern, Dozenten etc.', nextStep:'', date:'2026-08-17' }], tasks:[{ id:'task-scopebuddy-1', title:'Feedback der Lehrkräfte priorisieren', description:'Rückmeldungen von der Maker Faire in konkrete Änderungen übersetzen.', status:'In Arbeit', priority:'Hoch', dueDate:'2026-08-28', createdAt:'2026-08-17' }, { id:'task-scopebuddy-2', title:'Zweite Übungsplatine entwerfen', description:'Messpunkte für Rechteck, PWM und verrauschte Signale vorsehen.', status:'Offen', priority:'Normal', dueDate:'2026-09-10', createdAt:'2026-08-17' }, { id:'task-scopebuddy-3', title:'Demo für die Maker Faire vorbereiten', description:'', status:'Erledigt', priority:'Normal', dueDate:'', createdAt:'2026-08-10' }], materials:[], contacts:[], links:[], ideas:[] }
};

function refreshSummary(projectId) {
  const project = projects.find(item => item.id === projectId);
  const entries = details[projectId]?.entries || [];
  const tasks = details[projectId]?.tasks || [];
  if (!project) return;
  project.entryCount = entries.length;
  project.nextTaskTitles = tasks.filter(task => task.status !== 'Erledigt').slice(0, 3).map(task => task.title);
  project.nextTaskTitle = project.nextTaskTitles[0] || '';
  const latest = [...entries].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).at(0);
  for (const key of ['latestEntryId','latestEntryDate','latestEntryTitle','latestEntryBody','latestNextStep']) delete project[key];
  if (latest) Object.assign(project, { latestEntryId:latest.id, latestEntryDate:latest.date, latestEntryTitle:latest.title, latestEntryBody:latest.body, latestNextStep:latest.nextStep });
}

function adjustProjectStartDate(projectId, entryDate) {
  const detail = details[projectId];
  const summary = projects.find(project => project.id === projectId);
  if (!detail || !summary) return;
  if (!validDate(detail.createdAt) || entryDate < detail.createdAt) {
    detail.createdAt = entryDate;
    summary.createdAt = entryDate;
  }
}

const demoProjectDefinitions = [
  {
    id:'cnc-absaugautomatik', title:'CNC-Fräse: Absaugautomatik', description:'Eine stromüberwachte Absaugung, die gemeinsam mit der CNC-Fräse startet und kontrolliert nachläuft.', status:'active', createdAt:'2025-11-08',
    steps:[
      ['2025-11-08','Anforderungen gesammelt','Schaltleistung, Nachlaufzeit und vorhandene Anschlüsse an Fräse und Sauger aufgenommen.'],
      ['2025-11-22','Stromsensor vermessen','Den Stromsensor mit Leerlauf und Frässpindel getestet und sichere Schaltschwellen bestimmt.'],
      ['2025-12-13','Relaisstufe aufgebaut','Schütz, Sicherung und Kleinspannungssteuerung auf einer Montageplatte verdrahtet.'],
      ['2026-01-17','Firmware-Grundfunktion getestet','Startschwelle, Entprellung und Nachlaufzeit im Werkstattbetrieb erprobt.'],
      ['2026-02-28','Gehäuse konstruiert','Ein geschlossenes Hutschienengehäuse mit getrennten Spannungsbereichen gezeichnet.'],
      ['2026-04-11','Absaugschieber gekoppelt','Einen Servo ergänzt, der den Schieber am Maschinenanschluss automatisch öffnet.'],
      ['2026-06-20','Dauertest durchgeführt','Mehrere Fräsjobs ohne Fehlschaltung absolviert und die Temperatur im Gehäuse geprüft.'],
      ['2026-08-02','Beschriftung ergänzt','Anschlüsse, Sicherung und manuellen Überbrückungsschalter dauerhaft beschriftet.']
    ],
    materials:[['Stromsensor-Modul','1','Verbaut','12,90 €','Galvanisch getrennte Messung'],['Hutschienen-Schütz 230 V','1','Verbaut','18,50 €','Spule 12 V, zweipolig'],['Servo für Absaugschieber','1','Gekauft','9,80 €','Metallgetriebe']],
    ideas:[['Nachlauf abhängig vom Fräsjob','Prüfen','Lange Jobs sollen eine längere Filterreinigung auslösen.'],['Manueller Werkstattmodus','Umgesetzt','Absaugung lässt sich unabhängig von der CNC einschalten.']],
    links:[['Datenblatt Stromsensor','https://example.com/stromsensor','Pinbelegung und zulässige Isolation.']]
  },
  {
    id:'gewaechshaus-wetterstation', title:'Gewächshaus-Wetterstation', description:'Temperatur, Luftfeuchte, Bodenfeuchte und Licht im kleinen Gewächshaus erfassen und lokal darstellen.', status:'active', createdAt:'2026-02-14',
    steps:[
      ['2026-02-14','Messgrößen festgelegt','Temperatur, Luftfeuchte, Bodenfeuchte und Beleuchtungsstärke als Kernwerte ausgewählt.'],
      ['2026-03-01','Sensoren verglichen','Drei Feuchtesensoren parallel betrieben und die Abweichungen dokumentiert.'],
      ['2026-03-28','ESP32-Messknoten aufgebaut','Sensoren auf Lochraster verdrahtet und erste Messwerte per WLAN übertragen.'],
      ['2026-05-09','Wetterschutz gedruckt','Ein belüftetes weißes Gehäuse gegen direkte Sonne und Spritzwasser montiert.'],
      ['2026-06-27','Bodenfeuchte kalibriert','Messwerte für trockene, feuchte und gesättigte Erde bestimmt.'],
      ['2026-08-09','Dashboard überarbeitet','Tagesminima, Maxima und Warnschwellen übersichtlicher dargestellt.']
    ],
    materials:[['SHT31 Temperatur-/Feuchtesensor','2','Verbaut','15,80 €','I²C, zwei Messorte'],['Kapazitiver Bodenfeuchtesensor','3','Verbaut','13,50 €','Korrosionsarm'],['UV-beständiges PETG','250 g','Vorhanden','','Weiß für Strahlungsschutz']],
    ideas:[['Lüfter automatisch steuern','Offen','Bei hoher Temperatur einen 12-V-Lüfter zuschalten.'],['Regenfass-Füllstand ergänzen','Prüfen','Ultraschallsensor am Vorratsbehälter testen.']],
    links:[['SHT31-Datenblatt','https://example.com/sht31','Messgenauigkeit und Montagehinweise.']]
  },
  {
    id:'retro-radio-bluetooth', title:'Retro-Radio mit Bluetooth', description:'Ein Röhrenradio-Gehäuse restaurieren und mit moderner, sicherer Audioelektronik weiterverwenden.', status:'active', createdAt:'2025-09-06',
    steps:[
      ['2025-09-06','Radio zerlegt','Chassis, Lautsprecher und Skalenscheibe ausgebaut und alle Teile fotografisch dokumentiert.'],
      ['2025-10-04','Gehäuse gereinigt','Furnier vorsichtig gereinigt und lose Stellen mit Knochenleim fixiert.'],
      ['2025-11-15','Lautsprecher geprüft','Originalchassis gemessen und wegen beschädigter Sicke einen Ersatz ausgewählt.'],
      ['2026-01-10','Verstärker getestet','Class-D-Verstärker mit Labornetzteil und Ersatzlautsprecher auf Störgeräusche geprüft.'],
      ['2026-03-07','Skalenbeleuchtung erneuert','Warmweiße LEDs hinter Diffusoren montiert und dimmbar gemacht.'],
      ['2026-05-16','Bedienknöpfe adaptiert','Originalknöpfe über gedruckte Kupplungen mit Encoder und Potentiometer verbunden.'],
      ['2026-07-25','Bluetooth-Antenne versetzt','Antenne außerhalb der Abschirmbleche positioniert und Reichweite verbessert.']
    ],
    materials:[['Bluetooth-Audiomodul','1','Verbaut','16,90 €','aptX-fähig'],['Class-D-Verstärker 2 × 30 W','1','Verbaut','21,00 €','Versorgung 24 V'],['Warmweiße LED-Leiste','40 cm','Verbaut','6,40 €','2700 K']],
    ideas:[['Internetradio ergänzen','Prüfen','Separates ESP32-Audiomodul über den Quellenwahlschalter anbinden.'],['Senderzeiger motorisieren','Offen','Zeiger bei Quellenwechsel auf passende Markierung fahren.']],
    links:[['Schaltplan des Originalradios','https://example.com/retro-radio-schaltplan','Nur zur Dokumentation der ursprünglichen Verdrahtung.']]
  },
  {
    id:'filamenttrockner', title:'Filamenttrockner aus Vorratsbox', description:'Eine dichte Box mit geregelter Warmluft und Feuchtemessung für empfindliche 3D-Druck-Filamente.', status:'active', createdAt:'2026-05-03',
    steps:[
      ['2026-05-03','Box ausgewählt','Dichtung, Rollengröße und mögliche Kabeldurchführungen der Vorratsbox geprüft.'],
      ['2026-05-17','Luftführung getestet','Heizmatte und Umluftlüfter provisorisch angeordnet und Temperaturverteilung gemessen.'],
      ['2026-06-07','Regelung programmiert','Temperaturregelung mit Sicherheitsabschaltung und Timer umgesetzt.'],
      ['2026-07-05','Rollenhalter montiert','Kugelgelagerte Halter für zwei Spulen eingebaut und PTFE-Ausgänge ergänzt.'],
      ['2026-08-10','PETG-Trocknung erprobt','Eine feuchte Rolle über sechs Stunden getrocknet und Druckbild vorher/nachher verglichen.']
    ],
    materials:[['Dichte Vorratsbox 22 l','1','Verbaut','19,90 €','Silikondichtung'],['PTC-Heizelement 80 W','1','Verbaut','14,20 €','Selbstbegrenzend'],['Silikagel regenerierbar','1 kg','Gekauft','11,50 €','Orange Indikator']],
    ideas:[['Gewichtsüberwachung','Offen','Spulenhalter auf Wägezellen setzen.'],['Trocknungsprofile speichern','Prüfen','Profile für PLA, PETG, PA und TPU hinterlegen.']],
    links:[['Trocknungstemperaturen','https://example.com/filament-trocknung','Richtwerte der verwendeten Materialien.']]
  },
  {
    id:'luftqualitaets-ampel', title:'Werkstatt-Luftqualitätsampel', description:'CO₂, Feinstaub und VOC messen und den Lüftungsbedarf unmittelbar per Ampelfarbe anzeigen.', status:'active', createdAt:'2026-03-12',
    steps:[
      ['2026-03-12','Sensorposition gesucht','Messorte neben Lötplatz, Tür und Fenster miteinander verglichen.'],
      ['2026-03-26','CO₂-Sensor eingebunden','NDIR-Sensor ausgelesen und automatische Baseline-Kalibrierung deaktiviert.'],
      ['2026-04-18','Feinstaubsensor ergänzt','Luftkanal und Lüfter so angeordnet, dass keine Abluft zurückgesaugt wird.'],
      ['2026-05-30','Ampellogik definiert','Grenzwerte und zeitliche Mittelung für Grün, Gelb und Rot festgelegt.'],
      ['2026-07-04','LED-Ring montiert','Diffusor gedruckt und Helligkeit für Tages- und Nachtbetrieb angepasst.'],
      ['2026-08-08','Lüftungstest ausgewertet','Stoßlüften und Absaugung anhand der Messkurven miteinander verglichen.']
    ],
    materials:[['NDIR-CO₂-Sensor','1','Verbaut','34,00 €','Messbereich bis 5000 ppm'],['Feinstaubsensor','1','Verbaut','27,50 €','PM1, PM2.5, PM10'],['RGBW-LED-Ring','1','Verbaut','8,90 €','16 LEDs']],
    ideas:[['Absaugung automatisch einschalten','Prüfen','Bei hoher Partikellast ein potentialfreies Signal ausgeben.'],['Akustische Warnung','Verworfen','In der Werkstatt zu störend.']],
    links:[['UBA-Empfehlungen Innenraumluft','https://example.com/innenraumluft','Orientierungswerte für CO₂ und Feinstaub.']]
  },
  {
    id:'loetrauchabsauger', title:'Modularer Lötrauchabsauger', description:'Ein leiser Absauger mit wechselbaren Filterkassetten und flexiblem Gelenkarm für den Lötplatz.', status:'active', createdAt:'2026-06-01',
    steps:[
      ['2026-06-01','Luftbedarf gemessen','Mit verschiedenen Lüftern die Erfassungsgeschwindigkeit am Lötplatz verglichen.'],
      ['2026-06-15','Filterkassette konstruiert','Steckbare Kassette für Vorfilter und Aktivkohle gezeichnet.'],
      ['2026-07-13','Gelenkarm aufgebaut','Drei gedruckte Segmente mit Reibgelenken und glattem Innenschlauch verbunden.'],
      ['2026-08-11','Geräusch reduziert','Lüfter entkoppelt und Ansaugkante strömungsgünstig verrundet.']
    ],
    materials:[['Radiallüfter 120 mm','1','Verbaut','29,90 €','PWM-regelbar'],['Aktivkohlevlies','4 Matten','Gekauft','12,00 €','Zuschneidbar'],['Flexschlauch 60 mm','1,5 m','Verbaut','9,50 €','Innen glatt']],
    ideas:[['Filterwechsel anzeigen','Offen','Laufzeit erfassen und Differenzdruck messen.'],['Zweiter Absaugarm','Prüfen','Y-Verteiler für zwei Arbeitsplätze testen.']],
    links:[['Filteraufbau Lötrauch','https://example.com/loetrauch-filter','Hinweise zu Partikel- und Gasfiltern.']]
  },
  {
    id:'kamera-slider', title:'Motorisierter Kamera-Slider', description:'Ein kompakter Slider für gleichmäßige Video- und Zeitrafferfahrten mit programmierbaren Endpunkten.', status:'active', createdAt:'2025-12-05',
    steps:[
      ['2025-12-05','Schienenkonzept gewählt','Aluprofil und Laufrollen für 800 Millimeter Fahrweg dimensioniert.'],
      ['2025-12-20','Wagen gefräst','Kamerawagen aus Aluminium gefertigt und Rollen spielfrei eingestellt.'],
      ['2026-01-24','Riemenantrieb montiert','Zahnriemen gespannt und Umlenkrollen fluchtend ausgerichtet.'],
      ['2026-03-14','Stepper angesteuert','Leise Mikroschritte und eine sanfte Beschleunigungsrampe implementiert.'],
      ['2026-04-25','Endschalter integriert','Magnetische Endschalter verdeckt im Profil montiert.'],
      ['2026-06-06','Bedienung ergänzt','OLED, Drehgeber und Start/Stopp-Taster in ein Handteil eingebaut.'],
      ['2026-08-01','Zeitraffer getestet','Eine zweistündige Fahrt mit 600 Auslösungen ohne Positionsverlust absolviert.']
    ],
    materials:[['Aluprofil 40 × 20 mm','800 mm','Verbaut','28,00 €','Nutprofil'],['NEMA-17-Schrittmotor','1','Verbaut','17,90 €','0,9° Schrittwinkel'],['Zahnriemen GT2','2 m','Verbaut','8,20 €','6 mm breit']],
    ideas:[['Pan-Achse ergänzen','Offen','Kamerakopf während der Fahrt auf ein Motiv ausrichten.'],['Austauschbarer Akku','Prüfen','Werkzeugakku über Adapter verwenden.']],
    links:[['Motion-Control-Grundlagen','https://example.com/motion-control','Berechnung von Rampen und Schrittfrequenzen.']]
  },
  {
    id:'solar-usb-station', title:'Solar-USB-Ladestation', description:'Eine wetterfeste Insel-Ladestation für Smartphone, Fahrradlicht und Messgeräte im Garten.', status:'active', createdAt:'2026-04-06',
    steps:[
      ['2026-04-06','Energiebedarf abgeschätzt','Typische Tagesverbräuche und Reserven für drei bewölkte Tage berechnet.'],
      ['2026-04-20','Solarmodul vermessen','Leerlaufspannung und Ladeleistung bei verschiedenen Neigungswinkeln aufgenommen.'],
      ['2026-05-18','Akkuschutz aufgebaut','LiFePO₄-Akku, Sicherung und Tiefentladeschutz verdrahtet.'],
      ['2026-06-22','USB-C-Modul getestet','Spannungsprofile und Wirkungsgrad mit mehreren Endgeräten geprüft.'],
      ['2026-07-20','Gehäuse abgedichtet','Kabelverschraubungen und Deckeldichtung mit Sprühwasser getestet.']
    ],
    materials:[['Solarmodul 30 W','1','Verbaut','42,00 €','Monokristallin'],['LiFePO₄-Akku 12 V','1','Verbaut','69,00 €','10 Ah'],['USB-C-PD-Wandler','1','Verbaut','18,90 €','Bis 45 W']],
    ideas:[['Ladestand außen anzeigen','Offen','E-Paper-Anzeige mit sehr niedrigem Ruhestrom einsetzen.'],['Bewegungsmelder für Licht','Prüfen','Kleine Orientierungsleuchte am Standort ergänzen.']],
    links:[['LiFePO₄-Ladeprofil','https://example.com/lifepo4-laden','Grenzwerte für Ladung und Lagerung.']]
  },
  {
    id:'drucker-einhausung', title:'3D-Drucker-Einhausung', description:'Eine brandsichere, leise Einhausung mit Filterung, Beleuchtung und kontrollierter Bauraumtemperatur.', status:'active', createdAt:'2025-08-02',
    steps:[
      ['2025-08-02','Bauraum vermessen','Druckerbewegungen, Rollenhalter und Wartungszugang vollständig vermessen.'],
      ['2025-08-16','Rahmen geplant','Aluprofilrahmen und Plattenzuschnitte in CAD aufgebaut.'],
      ['2025-09-13','Rahmen montiert','Profile rechtwinklig verschraubt und Stellfüße angebracht.'],
      ['2025-10-11','Seitenwände eingesetzt','Schwer entflammbare Verbundplatten zugeschnitten und abgedichtet.'],
      ['2025-11-08','Fronttür gebaut','Tür aus Polycarbonat mit verdeckten Scharnieren montiert.'],
      ['2025-12-06','Beleuchtung installiert','Blendfreie LED-Profile oben und seitlich eingebaut.'],
      ['2026-01-31','Abluftkanal ergänzt','Regelbaren Lüfter und kombinierte HEPA-/Kohlekassette montiert.'],
      ['2026-03-21','Temperaturen gemessen','Bauraum und Elektronikfach bei langen ABS-Drucken überwacht.'],
      ['2026-04-19','Elektronik ausgelagert','Netzteil und Steuerung in ein belüftetes Seitenfach versetzt.'],
      ['2026-05-24','Türkontakt eingebaut','Beleuchtung und Pausefunktion mit einem Magnetschalter gekoppelt.'],
      ['2026-07-12','Schall gedämmt','Boden entkoppelt und Resonanzflächen mit Dämmmatten beruhigt.'],
      ['2026-08-12','Sicherheitscheck abgeschlossen','Kabel, Sicherungen, Erdung und maximale Temperaturen dokumentiert.']
    ],
    materials:[['Aluprofil 20 × 20 mm','12 m','Verbaut','96,00 €','Schwarz eloxiert'],['Polycarbonat 4 mm','1 Platte','Verbaut','48,00 €','Fronttür'],['HEPA-/Aktivkohlefilter','2','Gekauft','31,80 €','Wechselkassetten']],
    ideas:[['Kamera automatisch beleuchten','Offen','Licht für Zeitraffer unabhängig dimmen.'],['Feuerlöschmodul','Prüfen','Geeignetes passives System ohne Rückstände recherchieren.']],
    links:[['Materialverhalten im Bauraum','https://example.com/drucker-einhausung','Temperaturhinweise für PLA, PETG und ABS.']]
  },
  {
    id:'balkon-bewaesserung', title:'Balkon-Bewässerungssteuerung', description:'Mehrere Pflanzkästen bedarfsgerecht aus einem Vorratsbehälter bewässern und Trockenlauf verhindern.', status:'active', createdAt:'2026-05-10',
    steps:[
      ['2026-05-10','Wasserbedarf erfasst','Verbrauch der Pflanzkästen über eine warme Woche abgeschätzt.'],
      ['2026-05-24','Tropfer verglichen','Druckkompensierte und einstellbare Tropfer bei verschiedenen Schlauchlängen getestet.'],
      ['2026-06-14','Pumpenbox aufgebaut','Pumpe, Filter, Rückschlagventil und Sicherung in einer Box montiert.'],
      ['2026-07-06','Feuchtesteuerung programmiert','Bewässerungsfenster, Mindestpause und Trockenlaufschutz implementiert.'],
      ['2026-08-07','Urlaubsbetrieb getestet','Zehn Tage automatisch bewässert und Tankreichweite dokumentiert.']
    ],
    materials:[['Membranpumpe 12 V','1','Verbaut','24,50 €','Selbstansaugend'],['Tropfschlauch 4/6 mm','15 m','Verbaut','17,00 €','UV-beständig'],['Kapazitiver Füllstandssensor','1','Verbaut','8,60 €','Außen am Tank']],
    ideas:[['Wetterprognose berücksichtigen','Prüfen','Bei angekündigtem Regen eine Bewässerung auslassen.'],['Durchfluss messen','Offen','Verstopfte Tropfer über Abweichungen erkennen.']],
    links:[['Tropfbewässerung auslegen','https://example.com/tropfbewaesserung','Druckverlust und maximale Leitungslängen.']]
  },
  {
    id:'led-matrix-uhr', title:'LED-Matrix-Wanduhr', description:'Große Wanduhr mit weichen Übergängen, automatischer Helligkeit und lokalen Wetterdaten.', status:'archived', createdAt:'2024-11-09',
    steps:[
      ['2024-11-09','Matrixlayout festgelegt','Auflösung und Gehäuseformat anhand des vorgesehenen Wandplatzes bestimmt.'],
      ['2024-12-01','LED-Panels getestet','Farben, Stromaufnahme und Pixelfehler aller Module geprüft.'],
      ['2025-01-18','Rahmen gebaut','Flachen Holzrahmen mit abnehmbarer Rückwand gefertigt.'],
      ['2025-02-22','Diffusor abgestimmt','Abstand und Material für gleichmäßig leuchtende Pixel ermittelt.'],
      ['2025-04-05','Uhrsoftware fertiggestellt','Zeitsynchronisation, Helligkeitsregelung und Wetteransicht umgesetzt.'],
      ['2025-05-17','Projekt abgeschlossen','Uhr montiert, Stromaufnahme dokumentiert und Quelldaten gesichert.']
    ],
    materials:[['RGB-Matrix 64 × 32','2','Verbaut','76,00 €','HUB75'],['Acrylglas opal 3 mm','1 Platte','Verbaut','22,00 €','Diffusor'],['Netzteil 5 V / 20 A','1','Verbaut','31,00 €','Geschlossenes Gehäuse']],
    ideas:[['Geburtstage anzeigen','Umgesetzt','Kalenderdaten werden als kleine Symbole eingeblendet.'],['Sekundenanimation','Verworfen','War aus der Entfernung zu unruhig.']],
    links:[['HUB75-Ansteuerung','https://example.com/hub75','Timing und Verkabelung der Panels.']]
  },
  {
    id:'fahrradlicht-akkupack', title:'Fahrradlicht-Akkupack', description:'Defekten proprietären Akku durch ein reparierbares, geschütztes 18650-Pack ersetzen.', status:'archived', createdAt:'2025-03-08',
    steps:[
      ['2025-03-08','Originalakku analysiert','Steckerbelegung, Abschaltspannung und Stromaufnahme der Lampe gemessen.'],
      ['2025-03-22','Zellen selektiert','Kapazität und Innenwiderstand von acht Zellen bestimmt.'],
      ['2025-04-12','Pack verschweißt','Zellenhalter, Nickelband und BMS zu einem 2S-Pack aufgebaut.'],
      ['2025-05-03','Gehäuse gedruckt','Spritzwassergeschütztes Gehäuse mit Rahmenhalterung gefertigt.'],
      ['2025-06-01','Reichweitentest abgeschlossen','Drei Helligkeitsstufen bis zur BMS-Abschaltung vermessen.']
    ],
    materials:[['18650-Zellen','8','Verbaut','32,00 €','Kapazitätsselektiert'],['2S-BMS 10 A','1','Verbaut','6,90 €','Balancing'],['Wasserdichter Stecker','2 Paare','Verbaut','8,40 €','Zweipolig']],
    ideas:[['Ladezustand per LED','Umgesetzt','Vierstufige Anzeige im Gehäusedeckel.'],['USB-Ausgang','Verworfen','Zusätzliche Öffnung hätte Abdichtung verschlechtert.']],
    links:[['Sicherer Aufbau von Akkupacks','https://example.com/akkupack-sicherheit','Sicherung, Isolation und Zellabstände.']]
  },
  {
    id:'mini-arcade-controller', title:'Mini-Arcade-Controller', description:'Kompakter USB-Controller mit echten Arcade-Tastern für Retrospiele und Workshops.', status:'archived', createdAt:'2024-07-13',
    steps:[
      ['2024-07-13','Layout aus Pappe getestet','Abstände von Stick und Tastern mit mehreren Handgrößen erprobt.'],
      ['2024-08-03','Gehäuse konstruiert','Zweiteiliges Gehäuse mit verschraubter Acryloberseite gezeichnet.'],
      ['2024-08-24','Taster montiert','Bohrungen gesetzt und Mikroschalter einheitlich ausgerichtet.'],
      ['2024-09-14','USB-Controller programmiert','Mikrocontroller als standardkonformes Gamepad eingerichtet.'],
      ['2024-10-05','Kabelbaum gefertigt','Steckbaren Kabelbaum beschriftet und Zugentlastung ergänzt.'],
      ['2024-11-02','Spieltest durchgeführt','Tastenbelegung und Diagonalen in mehreren Spielen geprüft.'],
      ['2024-11-23','Workshop-Unterlagen erstellt','Montagefolge und Fehlersuche auf zwei Seiten zusammengefasst.']
    ],
    materials:[['Arcade-Taster 30 mm','8','Verbaut','19,20 €','Verschiedene Farben'],['Digitaler Joystick','1','Verbaut','18,50 €','Kurzer Schaft'],['RP2040-Board','1','Verbaut','7,90 €','USB HID']],
    ideas:[['Wechselbare Beschriftung','Umgesetzt','Papier-Inlays liegen unter der Acrylplatte.'],['Kabelloser Betrieb','Verworfen','USB ist für Workshops robuster.']],
    links:[['USB-HID-Gamepad','https://example.com/usb-hid-gamepad','Descriptor und Tastenbelegung.']]
  },
  {
    id:'schreibtisch-kabelkanal', title:'Schreibtisch-Kabelkanal', description:'Netzteile und Kabel unter dem höhenverstellbaren Tisch geordnet und wartbar befestigen.', status:'archived', createdAt:'2025-10-12',
    steps:[
      ['2025-10-12','Kabelwege geplant','Bewegungsreserve im Steh- und Sitzbetrieb markiert.'],
      ['2025-10-18','Kanäle montiert','Zwei getrennte Kanäle für Netz- und Signalkabel verschraubt.'],
      ['2025-10-25','Beschriftung abgeschlossen','Netzteile fixiert, Kabel beschriftet und alle Tischpositionen getestet.']
    ],
    materials:[['Drahtgitter-Kabelkanal','2 × 80 cm','Verbaut','27,00 €','Untertischmontage'],['Klettband','5 m','Verbaut','9,90 €','Wiederlösbar'],['Kabeletiketten','1 Satz','Verbaut','6,50 €','Laminierbar']],
    ideas:[['Dockingstation-Halter','Umgesetzt','Gedruckte Halterung direkt am Kanal.'],['Steckdosenleiste schaltbar','Verworfen','Standby-Verbrauch bereits gering.']],
    links:[['Biegeradien von Datenkabeln','https://example.com/kabel-biegeradius','Hinweise für Netz- und Displaykabel.']]
  },
  {
    id:'akkuschrauber-zellentausch', title:'Akkuschrauber-Zellentausch', description:'Einen mechanisch guten Akkuschrauber durch neue Zellen und ein modernes Schutzboard weiterverwenden.', status:'archived', createdAt:'2025-01-11',
    steps:[
      ['2025-01-11','Defekten Akku geöffnet','Zellanordnung und Temperatursensor dokumentiert.'],
      ['2025-01-25','Ersatzzellen geprüft','Hochstromzellen vermessen und paarweise sortiert.'],
      ['2025-02-08','Zellblock erneuert','Neuen Block punktgeschweißt, isoliert und mit Sicherung versehen.'],
      ['2025-02-22','Belastungstest bestanden','Drehmomenttest und zwei vollständige Ladezyklen ohne Auffälligkeiten absolviert.']
    ],
    materials:[['Hochstromzellen 18650','10','Verbaut','45,00 €','20 A Dauerstrom'],['Isolierringe','10','Verbaut','2,50 €','Selbstklebend'],['Nickelband 0,15 mm','1 m','Verbaut','4,80 €','Reinnickel']],
    ideas:[['Kapazität außen markieren','Umgesetzt','Datum und gemessene Kapazität auf dem Gehäuse notiert.'],['USB-C-Ladegerät bauen','Verworfen','Original-Ladegerät arbeitet zuverlässig.']],
    links:[['Punktverschweißen von Zellen','https://example.com/zellen-punktschweissen','Elektrodenabstand und Prüfmethoden.']]
  },
  {
    id:'smart-mirror-prototyp', title:'Smart-Mirror-Prototyp', description:'Informationsdisplay hinter einem Spionspiegel für Uhrzeit, Termine und Wetter erproben.', status:'archived', createdAt:'2024-09-07',
    steps:[
      ['2024-09-07','Spiegelmuster verglichen','Helligkeit und Reflexion von drei Spionspiegelmaterialien getestet.'],
      ['2024-09-28','Display ausgewählt','Gebrauchten 24-Zoll-Monitor zerlegt und Einbautiefe bestimmt.'],
      ['2024-10-19','Holzrahmen gebaut','Rahmen mit Hinterlüftung und abnehmbarer Technikklappe gefertigt.'],
      ['2024-11-16','Oberfläche eingerichtet','Uhr, Kalender und Wetterdaten in einem dunklen Layout angeordnet.'],
      ['2025-01-04','Bewegungssensor ergänzt','Display schaltet bei Annäherung ein und zeitverzögert wieder aus.'],
      ['2025-02-15','Prototyp ausgewertet','Stromverbrauch und Lesbarkeit dokumentiert; Projekt zugunsten eines E-Paper-Boards beendet.']
    ],
    materials:[['Spionspiegel-Acryl','1 Platte','Verbaut','38,00 €','40 × 60 cm'],['24-Zoll-Monitor','1','Vorhanden','','Gebrauchtgerät'],['PIR-Sensor','1','Verbaut','4,20 €','Weitwinkel']],
    ideas:[['Sprachsteuerung','Verworfen','Mikrofon im Wohnraum nicht gewünscht.'],['E-Paper-Nachfolger','Offen','Weniger Energie und bessere Lesbarkeit bei Tageslicht.']],
    links:[['Display hinter Spionspiegel','https://example.com/smart-mirror-optik','Kontrast und notwendige Displayhelligkeit.']]
  }
];

for (const definition of demoProjectDefinitions) {
  const entries = definition.steps.map(([date, title, body], index, all) => ({ id:`${definition.id}-entry-${index + 1}`, date, title, body, nextStep:all[index + 1]?.[1] || '', author:'admin' }));
  const materials = definition.materials.map(([name, quantity, status, price, properties], index) => ({ id:`${definition.id}-material-${index + 1}`, name, quantity, status, price, properties, url:'', createdAt:definition.createdAt }));
  const ideas = definition.ideas.map(([title, status, description], index) => ({ id:`${definition.id}-idea-${index + 1}`, title, status, description, createdAt:definition.createdAt }));
  const links = definition.links.map(([title, url, notes], index) => ({ id:`${definition.id}-link-${index + 1}`, title, url, notes, createdAt:definition.createdAt }));
  const tasks = definition.status === 'active' ? [{ id:`${definition.id}-task-1`, title:definition.ideas[0]?.[0] || 'Nächsten Arbeitsschritt planen', description:definition.ideas[0]?.[2] || '', status:'Offen', priority:'Normal', dueDate:'', createdAt:definition.createdAt }] : [];
    const project = { id:definition.id, title:definition.title, description:definition.description, status:definition.status, createdAt:definition.createdAt, tagIds:tagIdsForProject(definition.id), entries, tasks, materials, contacts:[], links, ideas, learnings:[] };
  projects.push(project);
  details[definition.id] = project;
  refreshSummary(definition.id);
}
for (const project of Object.values(details)) {
  project.learnings ||= [];
  project.notes ||= [];
}

const send = (res, status, data, type='application/json; charset=utf-8') => { const jsonObject = type.startsWith('application/json') && typeof data !== 'string' && !Buffer.isBuffer(data); res.writeHead(status, {'Content-Type':type, ...(jsonObject ? {'Cache-Control':'no-store'} : {})}); res.end(jsonObject ? JSON.stringify(data) : data); };
const body = req => new Promise(resolve => { let value=''; req.on('data', chunk => value += chunk); req.on('end', () => resolve(value ? JSON.parse(value) : {})); });
const cookie = (req, name) => String(req.headers.cookie || '').split(';').map(value => value.trim().split('=')).find(([key]) => key === name)?.[1] || '';
const requestSession = req => {
  const token = cookie(req, 'makerlog_session');
  if (token) return sessions.find(session => session.token === token);
  return strictAuth ? null : sessions[0];
};
const requestUser = req => {
  const session = requestSession(req);
  const user = session && users.find(candidate => candidate.id === session.userId && candidate.active);
  return user ? { session, user } : null;
};
const canAccessProject = (user, projectId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.projectAccessMode === 'all') return true;
  const listed = (user.projectIds || []).includes(projectId);
  return user.projectAccessMode === 'exclude' ? !listed : listed;
};
const validTagIds = ids => Array.isArray(ids) && ids.length <= 20 && new Set(ids).size === ids.length && ids.every(id => tags.some(tag => tag.id === id));
const validProjectPriority = value => ['Hoch','Mittel','Gering'].includes(value);
const validProjectFlag = value => typeof value === 'boolean';
const tagUsage = (tagId, user) => projects.filter(project => canAccessProject(user, project.id) && (project.tagIds || []).includes(tagId)).reduce((count, project) => {
  if (project.status === 'archived') count.archivedProjectCount++;
  else if (['active','paused','completed'].includes(project.status)) count.activeProjectCount++;
  return count;
}, { activeProjectCount:0, archivedProjectCount:0 });
const publicUser = user => { const { password, passwordHash, salt, ...result } = user; return result; };
const userPreferences = user => ({ startPage:user.startPage || 'home', projectSort:user.projectSort || 'status:asc', archiveSort:user.archiveSort || 'createdAt:desc', defaultProjectIcon:user.defaultProjectIcon || 'box', showOverviewSummary:user.showOverviewSummary !== false, showOverviewRecent:user.showOverviewRecent !== false, showOverviewNext:user.showOverviewNext !== false, showOverviewRecentlyEdited:user.showOverviewRecentlyEdited !== false, showOverviewDueSoon:user.showOverviewDueSoon !== false, showOverviewHighPriority:user.showOverviewHighPriority !== false, showOverviewActivity:user.showOverviewActivity !== false, showOverviewTimeline:user.showOverviewTimeline !== false, overviewRecentRows:Number(user.overviewRecentRows) || 2, overviewNextRows:Number(user.overviewNextRows) || 2, overviewRecentlyEditedRows:Number(user.overviewRecentlyEditedRows) || 1, overviewDueSoonRows:Number(user.overviewDueSoonRows) || 2, overviewHighPriorityRows:Number(user.overviewHighPriorityRows) || 2, overviewOrder:Array.isArray(user.overviewOrder) ? user.overviewOrder : ['summary','recentlyEdited','dueSoon','highPriority','next','recent','activity','timeline'] });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/login') {
    const input = await body(req); const user = users.find(candidate => candidate.id === input.user && (candidate.password === input.password || (candidate.passwordHash && backupPasswordHash(input.password, candidate.salt) === candidate.passwordHash)) && candidate.active);
    if (user) {
      user.lastLoginAt = new Date().toISOString();
      const token = randomBytes(24).toString('hex');
      sessions.push({ id:randomBytes(6).toString('hex'), token, userId:user.id, name:user.name || user.id, ip:req.socket.remoteAddress || '127.0.0.1', userAgent:req.headers['user-agent'] || 'Unbekannt', activeAgoSeconds:0, ageSeconds:0 });
      res.setHeader('Set-Cookie', `makerlog_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
      return send(res, 200, { id:user.id, name:user.name || user.id, role:user.role, projectAccessMode:user.projectAccessMode, ...userPreferences(user), admin:user.role === 'admin', mustChangePassword:user.mustChangePassword });
    }
    return send(res, 401, { error:'Benutzername oder Passwort falsch' });
  }
  const auth = requestUser(req);
  if (url.pathname === '/api/logout') {
    if (auth) sessions.splice(sessions.indexOf(auth.session), 1);
    res.setHeader('Set-Cookie', 'makerlog_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
    res.writeHead(204); return res.end();
  }
  if (url.pathname.startsWith('/api/') && !auth) return send(res, 401, { error:'Anmeldung erforderlich' });
  const actor = auth?.user;
  if (url.pathname === '/api/me') return send(res, 200, { id:actor.id, name:actor.name || actor.id, role:actor.role, projectAccessMode:actor.projectAccessMode, ...userPreferences(actor), admin:actor.role === 'admin', mustChangePassword:actor.mustChangePassword });
  if (actor?.mustChangePassword && url.pathname !== '/api/account/password') return send(res, 428, { error:'Passwortänderung erforderlich' });
  if (url.pathname === '/api/system') return send(res, 200, { hostname:deviceSettings.hostname, baseUrl:`http://${req.headers.host}` });
  const adminOnly = /^\/api\/(users(?:\/|$)|sessions(?:\/|$)|audit$|settings(?:\/|$)|system\/(?:content|users)$|backup\/users$|import\/(?:users|project)$|projects\/trash$)/.test(url.pathname);
  if (adminOnly && actor.role !== 'admin') return send(res, 403, { error:'Admin-Rechte erforderlich' });
  if (url.pathname === '/api/projects' && req.method === 'POST' && !['admin','editor'].includes(actor.role)) return send(res, 403, { error:'Bearbeitungsrechte erforderlich' });
  const securedProjectMatch = url.pathname === '/api/projects/trash' ? null : url.pathname.match(/^\/api\/projects\/([^/]+)/);
  if (securedProjectMatch) {
    const projectId = decodeURIComponent(securedProjectMatch[1]);
    if (!canAccessProject(actor, projectId)) return send(res, 403, { error:'Kein Zugriff auf dieses Projekt' });
    if (req.method !== 'GET' && !['admin','editor'].includes(actor.role)) return send(res, 403, { error:'Bearbeitungsrechte erforderlich' });
  }
  if (url.pathname === '/api/account/password' && req.method === 'POST') {
    const input = await body(req); const user = actor;
    const passwordMatches = input.currentPassword === user.password || (user.passwordHash && backupPasswordHash(input.currentPassword, user.salt) === user.passwordHash);
    if (!passwordMatches) return send(res, 401, { error:'Aktuelles Passwort ist falsch' });
    if (!input.newPassword || input.newPassword.length < 8) return send(res, 422, { error:'Das neue Passwort muss mindestens 8 Zeichen haben' });
    user.password = input.newPassword; user.mustChangePassword = false; audit.push({ at:new Date().toISOString(), actor:user.id, action:'password.changed', target:user.id }); res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/account/preferences' && req.method === 'PATCH') {
    const input = await body(req);
    if (input.startPage !== undefined && !['home','projects','archive'].includes(input.startPage)) return send(res, 422, { error:'Ungültige Startseite' });
    const projectSorts = ['status:asc','priority:desc','priority:asc','dueDate:asc','dueDate:desc','createdAt:desc','createdAt:asc','latestEntryDate:desc','latestEntryDate:asc','title:asc','title:desc'];
    if (input.projectSort !== undefined && !projectSorts.includes(input.projectSort)) return send(res, 422, { error:'Ungültige Standardsortierung für Projekte' });
    if (input.archiveSort !== undefined && (!projectSorts.includes(input.archiveSort) || input.archiveSort === 'status:asc')) return send(res, 422, { error:'Ungültige Standardsortierung für das Archiv' });
    if (input.defaultProjectIcon !== undefined && (typeof input.defaultProjectIcon !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.defaultProjectIcon))) return send(res, 422, { error:'Ungültiges Standard-Projektsymbol' });
    for (const key of ['showOverviewSummary','showOverviewRecent','showOverviewNext','showOverviewRecentlyEdited','showOverviewDueSoon','showOverviewHighPriority','showOverviewActivity','showOverviewTimeline']) if (input[key] !== undefined && typeof input[key] !== 'boolean') return send(res, 422, { error:'Ungültige Übersichts-Einstellung' });
    for (const key of ['overviewRecentRows','overviewNextRows','overviewRecentlyEditedRows','overviewDueSoonRows','overviewHighPriorityRows']) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 6)) return send(res, 422, { error:'Es können 1–6 Zeilen angezeigt werden' });
    const allowedOverviewSections = ['summary','recentlyEdited','dueSoon','highPriority','next','recent','activity','timeline'];
    if (input.overviewOrder !== undefined && (!Array.isArray(input.overviewOrder) || input.overviewOrder.length !== allowedOverviewSections.length || new Set(input.overviewOrder).size !== allowedOverviewSections.length || input.overviewOrder.some(section => !allowedOverviewSections.includes(section)))) return send(res, 422, { error:'Ungültige Reihenfolge der Übersichtsbereiche' });
    for (const key of ['startPage','projectSort','archiveSort','defaultProjectIcon','showOverviewSummary','showOverviewRecent','showOverviewNext','showOverviewRecentlyEdited','showOverviewDueSoon','showOverviewHighPriority','showOverviewActivity','showOverviewTimeline','overviewRecentRows','overviewNextRows','overviewRecentlyEditedRows','overviewDueSoonRows','overviewHighPriorityRows','overviewOrder']) if (input[key] !== undefined) actor[key] = input[key];
    return send(res, 200, userPreferences(actor));
  }
  if (url.pathname === '/api/tags' && req.method === 'GET') {
    const visible = tags.map(({ active, ...tag }) => ({ ...tag, ...tagUsage(tag.id, actor) }));
    return send(res, 200, { tags:visible });
  }
  if (url.pathname === '/api/tags' && req.method === 'POST') {
    if (!['admin','editor'].includes(actor.role)) return send(res, 403, { error:'Bearbeitungsrechte erforderlich' });
    const input = await body(req); const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) return send(res, 422, { error:'Ein Tag muss 2–40 Zeichen lang sein' });
    const existing = tags.find(tag => tag.normalizedName === normalizeTagName(name));
    if (existing) return send(res, 200, { ...existing, ...tagUsage(existing.id, actor) });
    const stem = normalizeTagName(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tag';
    const tag = { id:`tag-${stem}-${randomBytes(2).toString('hex')}`, name, normalizedName:normalizeTagName(name), active:true, createdAt:new Date().toISOString() };
    tags.push(tag); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'tag.created', target:name });
    return send(res, 201, { ...tag, activeProjectCount:0, archivedProjectCount:0 });
  }
  const tagMergeMatch = url.pathname.match(/^\/api\/tags\/([^/]+)\/merge$/);
  if (tagMergeMatch && req.method === 'POST') {
    if (actor.role !== 'admin') return send(res, 403, { error:'Admin-Rechte erforderlich' });
    const input = await body(req); const source = tags.find(tag => tag.id === tagMergeMatch[1]); const target = tags.find(tag => tag.id === input.targetId);
    if (!source || !target || source.id === target.id) return send(res, 422, { error:'Ungültige Zusammenführung' });
    for (const project of projects) if ((project.tagIds || []).includes(source.id)) project.tagIds = [...new Set(project.tagIds.map(id => id === source.id ? target.id : id))];
    for (const detail of Object.values(details)) if ((detail.tagIds || []).includes(source.id)) detail.tagIds = [...new Set(detail.tagIds.map(id => id === source.id ? target.id : id))];
    tags.splice(tags.indexOf(source), 1); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'tag.merged', target:source.name, details:`target=${target.name}` });
    return send(res, 200, { ...target, ...tagUsage(target.id, actor) });
  }
  const tagMatch = url.pathname.match(/^\/api\/tags\/([^/]+)$/);
  if (tagMatch && req.method === 'PATCH') {
    if (actor.role !== 'admin') return send(res, 403, { error:'Admin-Rechte erforderlich' });
    const input = await body(req); const tag = tags.find(candidate => candidate.id === tagMatch[1]);
    if (!tag) return send(res, 404, { error:'Tag nicht gefunden' });
    if (input.name !== undefined) {
      const name = String(input.name).trim().replace(/\s+/g, ' '); const duplicate = tags.find(candidate => candidate.id !== tag.id && candidate.normalizedName === normalizeTagName(name));
      if (name.length < 2 || name.length > 40) return send(res, 422, { error:'Ein Tag muss 2–40 Zeichen lang sein' });
      if (duplicate) return send(res, 409, { error:'Ein Tag mit diesem Namen existiert bereits' });
      tag.name = name; tag.normalizedName = normalizeTagName(name);
    }
    if (input.active !== undefined) return send(res, 422, { error:'Tags können nicht deaktiviert werden' });
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'tag.updated', target:tag.name });
    return send(res, 200, { ...tag, ...tagUsage(tag.id, actor) });
  }
  if (tagMatch && req.method === 'DELETE') {
    if (actor.role !== 'admin') return send(res, 403, { error:'Admin-Rechte erforderlich' });
    const input = await body(req); const tag = tags.find(candidate => candidate.id === tagMatch[1]);
    if (!tag) return send(res, 404, { error:'Tag nicht gefunden' });
    const usage = projects.filter(project => (project.tagIds || []).includes(tag.id)).length;
    if (usage && !input.removeFromProjects) return send(res, 409, { error:'Tag ist noch Projekten zugewiesen' });
    for (const project of projects) project.tagIds = (project.tagIds || []).filter(id => id !== tag.id);
    for (const detail of Object.values(details)) detail.tagIds = (detail.tagIds || []).filter(id => id !== tag.id);
    tags.splice(tags.indexOf(tag), 1); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'tag.deleted', target:tag.name });
    res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/settings/device' && req.method === 'GET') return send(res, 200, { wifiSsid:deviceSettings.wifiSsid, wifiPasswordSet:Boolean(deviceSettings.wifiPassword), hostname:deviceSettings.hostname, timezone:deviceSettings.timezone, ntpPrimary:deviceSettings.ntpPrimary, ntpSecondary:deviceSettings.ntpSecondary, connected:true, ip:'192.168.178.42', rssi:-51, currentTime:new Date().toISOString() });
  if (url.pathname === '/api/settings/device' && req.method === 'PATCH') {
    const input = await body(req);
    const wifiSsid = String(input.wifiSsid ?? deviceSettings.wifiSsid).trim();
    const hostname = String(input.hostname ?? deviceSettings.hostname).trim();
    const timezone = String(input.timezone ?? deviceSettings.timezone).trim();
    const ntpPrimary = String(input.ntpPrimary ?? deviceSettings.ntpPrimary).trim();
    const ntpSecondary = String(input.ntpSecondary ?? deviceSettings.ntpSecondary).trim();
    const wifiPassword = String(input.wifiPassword || '');
    if (!wifiSsid || wifiSsid.length > 32) return send(res, 422, { error:'Der WLAN-Name muss 1 bis 32 Zeichen lang sein' });
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/.test(hostname)) return send(res, 422, { error:'Der Gerätename darf nur Buchstaben, Zahlen und Bindestriche enthalten' });
    if (!timezone || timezone.length > 96 || !ntpPrimary || ntpPrimary.length > 96 || ntpSecondary.length > 96 || wifiPassword.length > 63) return send(res, 422, { error:'Ungültige Geräte- oder Zeiteinstellung' });
    const restartRequired = wifiSsid !== deviceSettings.wifiSsid || hostname !== deviceSettings.hostname || Boolean(wifiPassword);
    Object.assign(deviceSettings, { wifiSsid, hostname, timezone, ntpPrimary, ntpSecondary });
    if (wifiPassword) deviceSettings.wifiPassword = wifiPassword;
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'device.settings_updated', target:hostname });
    return send(res, 200, { saved:true, restartRequired });
  }
  if (url.pathname === '/api/settings/smtp' && req.method === 'GET') return send(res, 200, { host:smtpSettings.host, port:smtpSettings.port, security:smtpSettings.security, username:smtpSettings.username, passwordSet:Boolean(smtpSettings.password), senderName:smtpSettings.senderName, senderEmail:smtpSettings.senderEmail, testRecipient:smtpSettings.testRecipient, rootCa:smtpSettings.rootCa, configured:Boolean(smtpSettings.host && smtpSettings.password && smtpSettings.rootCa) });
  if (url.pathname === '/api/settings/smtp' && req.method === 'PATCH') {
    const input = await body(req);
    const next = { host:String(input.host || '').trim(), port:Number(input.port), security:String(input.security || ''), username:String(input.username || '').trim(), password:String(input.password || ''), senderName:String(input.senderName || '').trim(), senderEmail:String(input.senderEmail || '').trim(), testRecipient:String(input.testRecipient || '').trim(), rootCa:String(input.rootCa || '').trim() };
    const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!next.host || next.host.length > 253 || /\s/.test(next.host) || !Number.isInteger(next.port) || next.port < 1 || next.port > 65535 || !['tls','starttls'].includes(next.security)) return send(res, 422, { error:'Ungültiger SMTP-Server, Port oder Verschlüsselungsmodus' });
    if (!next.username || !next.senderName || !validEmail(next.senderEmail) || !validEmail(next.testRecipient) || !next.rootCa.includes('-----BEGIN CERTIFICATE-----') || !next.rootCa.includes('-----END CERTIFICATE-----')) return send(res, 422, { error:'Die SMTP-Konfiguration ist unvollständig' });
    const storedPassword = smtpSettings.password;
    Object.assign(smtpSettings, next);
    if (!next.password) smtpSettings.password = storedPassword;
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'smtp.settings_updated', target:next.host });
    return send(res, 200, { saved:true, configured:Boolean(smtpSettings.password) });
  }
  if (url.pathname === '/api/settings/smtp/test' && req.method === 'POST') {
    if (!smtpSettings.host || !smtpSettings.password || !smtpSettings.rootCa) return send(res, 422, { error:'Die SMTP-Konfiguration ist unvollständig' });
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'smtp.test_sent', target:smtpSettings.testRecipient });
    return send(res, 200, { sent:true, recipient:smtpSettings.testRecipient });
  }
  if (url.pathname === '/api/settings/backup' && req.method === 'GET') return send(res, 200, backupSchedule);
  if (url.pathname === '/api/settings/backup' && req.method === 'PATCH') {
    const input = await body(req);
    const recipient = String(input.recipient || '').trim();
    const intervalDays = Number(input.intervalDays);
    const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (!validEmail(recipient) || !['projects','users','both'].includes(input.scope) || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) return send(res, 422, { error:'Ungültiger Backup-Zeitplan' });
    const reschedule = Boolean(input.enabled) && (!backupSchedule.enabled || recipient !== backupSchedule.recipient || input.scope !== backupSchedule.scope || intervalDays !== backupSchedule.intervalDays);
    Object.assign(backupSchedule, { enabled:Boolean(input.enabled), recipient, scope:input.scope, intervalDays });
    if (reschedule) backupSchedule.nextRunAt = Math.floor(Date.now() / 1000) + intervalDays * 86400;
    if (!backupSchedule.enabled) backupSchedule.nextRunAt = 0;
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'backup.schedule_updated', target:backupSchedule.enabled ? 'aktiv' : 'inaktiv' });
    return send(res, 200, { saved:true, nextRunAt:backupSchedule.nextRunAt });
  }
  if (url.pathname === '/api/settings/backup/send' && req.method === 'POST') {
    if (!smtpSettings.host || !smtpSettings.password) return send(res, 422, { error:'SMTP ist nicht vollständig eingerichtet' });
    backupSchedule.lastSentAt = Math.floor(Date.now() / 1000);
    backupSchedule.lastStatus = 'Erfolgreich versendet';
    if (backupSchedule.enabled) backupSchedule.nextRunAt = backupSchedule.lastSentAt + backupSchedule.intervalDays * 86400;
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'backup.sent', target:backupSchedule.recipient });
    return send(res, 200, { sent:true, recipient:backupSchedule.recipient });
  }
  if (url.pathname === '/api/sessions' && req.method === 'GET') return send(res, 200, { sessions:sessions.map(({ token, ...session }) => ({ ...session, current:session.id === auth.session.id })) });
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && req.method === 'DELETE') {
    const index = sessions.findIndex(session => session.id === sessionMatch[1]);
    if (index < 0) return send(res, 404, { error:'Sitzung nicht gefunden' });
    if (sessions[index].id === auth.session.id) return send(res, 422, { error:'Die aktuelle Sitzung wird über Abmelden beendet' });
    const [removed] = sessions.splice(index, 1); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'session.revoked', target:removed.userId }); res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, 200, { events:audit });
  if (url.pathname === '/api/system/content' && req.method === 'DELETE') {
    const removed = projects.length;
    projects.splice(0);
    for (const id of Object.keys(details)) delete details[id];
    tags.splice(0);
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'system.content_cleared', target:String(removed) });
    return send(res, 200, { removed });
  }
  if (url.pathname === '/api/system/users' && req.method === 'DELETE') {
    const activeAdmin = actor;
    const removed = users.length - 1;
    users.splice(0, users.length, activeAdmin);
    sessions.splice(0, sessions.length, ...sessions.filter(session => session.userId === activeAdmin.id));
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'system.users_cleared', target:String(removed) });
    return send(res, 200, { removed });
  }
  if (url.pathname === '/api/users' && req.method === 'GET') return send(res, 200, { users:users.map(user => ({ ...publicUser(user), projectIds:user.role === 'admin' ? projects.map(project => project.id) : user.projectIds })) });
  if (url.pathname === '/api/users' && req.method === 'POST') {
    const input = await body(req);
    if (users.some(user => user.id === input.id)) return send(res, 409, { error:'Benutzername ist bereits vergeben' });
    if (!input.password || input.password.length < 8) return send(res, 422, { error:'Passwort muss mindestens 8 Zeichen haben' });
    if (!['admin','editor','viewer'].includes(input.role || 'editor') || !['include','exclude','all'].includes(input.projectAccessMode || 'include')) return send(res, 422, { error:'Ungültige Rolle oder ungültiger Zugriffsmodus' });
    const user = { id:input.id, name:input.id, role:input.role || 'editor', admin:input.role === 'admin', active:true, projectAccessMode:input.projectAccessMode || 'include', startPage:'home', projectSort:'status:asc', archiveSort:'createdAt:desc', defaultProjectIcon:'box', showOverviewSummary:true, showOverviewRecent:true, showOverviewNext:true, showOverviewRecentlyEdited:true, showOverviewDueSoon:true, showOverviewHighPriority:true, showOverviewActivity:true, showOverviewTimeline:true, overviewRecentRows:2, overviewNextRows:2, overviewRecentlyEditedRows:1, overviewDueSoonRows:2, overviewHighPriorityRows:2, overviewOrder:['summary','recentlyEdited','dueSoon','highPriority','next','recent','activity','timeline'], mustChangePassword:input.mustChangePassword ?? true, createdAt:new Date().toISOString(), lastLoginAt:'', projectIds:input.projectIds || [], password:input.password };
    users.push(user); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'user.created', target:user.id }); return send(res, 201, publicUser(user));
  }
  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') {
    const input = await body(req); const user = users.find(candidate => candidate.id === userMatch[1]);
    if (!user) return send(res, 404, { error:'Benutzer nicht gefunden' });
    if (user.id === actor.id && (input.active === false || (input.role && input.role !== 'admin'))) return send(res, 422, { error:'Der eigene Administratorzugang kann nicht deaktiviert oder herabgestuft werden' });
    if (input.role && !['admin','editor','viewer'].includes(input.role)) return send(res, 422, { error:'Ungültige Rolle' });
    if (input.projectAccessMode && !['include','exclude','all'].includes(input.projectAccessMode)) return send(res, 422, { error:'Ungültiger Zugriffsmodus' });
    const revokeSessions = input.active === false || input.role !== undefined || input.projectAccessMode !== undefined || Boolean(input.password);
    for (const key of ['role','active','projectAccessMode','mustChangePassword','projectIds']) if (input[key] !== undefined) user[key] = input[key];
    if (input.password) { user.password = input.password; delete user.passwordHash; delete user.salt; }
    user.admin = user.role === 'admin';
    if (revokeSessions) for (let index = sessions.length - 1; index >= 0; index--) if (sessions[index].userId === user.id && sessions[index].id !== auth.session.id) sessions.splice(index, 1);
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'user.updated', target:user.id }); return send(res, 200, publicUser(user));
  }
  if (userMatch && req.method === 'DELETE') {
    if (userMatch[1] === actor.id) return send(res, 422, { error:'Der eigene Benutzer kann nicht gelöscht werden' });
    const index = users.findIndex(user => user.id === userMatch[1]);
    if (index < 0) return send(res, 404, { error:'Benutzer nicht gefunden' }); users.splice(index, 1); for (let sessionIndex = sessions.length - 1; sessionIndex >= 0; sessionIndex--) if (sessions[sessionIndex].userId === userMatch[1]) sessions.splice(sessionIndex, 1); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'user.deleted', target:userMatch[1] }); res.writeHead(204); return res.end();
  }
  if (url.pathname === '/api/backup/users' && req.method === 'GET') {
    const accounts = users.map(user => {
      const salt = user.salt || sha256(`preview:${user.id}`).slice(0, 32);
      const passwordHash = user.passwordHash || backupPasswordHash(user.password, salt);
      return { id:user.id, name:user.name || user.id, role:user.role, active:user.active, projectAccessMode:user.projectAccessMode || 'include', mustChangePassword:Boolean(user.mustChangePassword), createdAt:user.createdAt || '', lastLoginAt:user.lastLoginAt || '', salt, passwordHash, projectIds:user.role === 'admin' ? projects.map(project => project.id) : (user.projectIds || []) };
    });
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'data.users_exported', target:String(accounts.length) });
    return send(res, 200, { accounts });
  }
  if (url.pathname === '/api/import/users' && req.method === 'POST') {
    const input = await body(req); const accounts = input.accounts;
    if (!Array.isArray(accounts) || !accounts.length || accounts.some(account => !account?.id || !/^(include|exclude|all)$/.test(account.projectAccessMode || 'include') || !/^[a-f0-9]{32}$/i.test(account.salt || '') || !/^[a-f0-9]{64}$/i.test(account.passwordHash || ''))) return send(res, 422, { error:'Ungültige Benutzerkonten im Backup' });
    let imported = 0; let skipped = 0;
    for (const account of accounts) {
      const index = users.findIndex(user => user.id === account.id);
      if (index >= 0 && !input.replace) { skipped++; continue; }
      if (account.id === 'admin' && (account.role !== 'admin' || account.active === false)) return send(res, 422, { error:'Der angemeldete Administrator muss aktiv bleiben' });
      const restored = { ...account, name:account.name || account.id, admin:account.role === 'admin' }; delete restored.password;
      if (index >= 0) users[index] = restored; else users.push(restored);
      const selected = account.projectIds || [];
      for (const userProject of projects) {
        if (!details[userProject.id].accessUsers) details[userProject.id].accessUsers = [];
        details[userProject.id].accessUsers = details[userProject.id].accessUsers.filter(id => id !== account.id);
        if (selected.includes(userProject.id)) details[userProject.id].accessUsers.push(account.id);
      }
      imported++;
    }
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'data.users_imported', target:String(imported) });
    return send(res, 200, { imported, skipped });
  }
  if (url.pathname === '/api/import/project' && req.method === 'POST') {
    const input = await body(req); const project = input.project; const collections = ['entries','tasks','materials','contacts','links','ideas','learnings','notes'];
    if (project && !Array.isArray(project.tasks)) project.tasks = [];
    if (project && !Array.isArray(project.learnings)) project.learnings = [];
    if (project && !Array.isArray(project.notes)) project.notes = [];
    if (!project?.id || !/^[A-Za-z0-9_-]{3,64}$/.test(project.id) || typeof project.title !== 'string' || project.title.length < 2 || !collections.every(collection => Array.isArray(project[collection]))) return send(res, 422, { error:'Ungültige Projektdaten im Backup' });
    if (collections.some(collection => project[collection].some(item => !item?.id || !/^[A-Za-z0-9_-]{3,64}$/.test(item.id)))) return send(res, 422, { error:'Ungültige Einträge im Backup' });
    const restored = structuredClone(project);
    restored.tagIds ||= [];
    if (!Array.isArray(restored.tagIds) || restored.tagIds.length > 20) return send(res, 422, { error:'Ungültige Tag-Auswahl im Backup' });
    const mappedTagIds = [];
    for (const sourceId of restored.tagIds) {
      let target = tags.find(tag => tag.id === sourceId);
      if (!target) {
        const definition = (input.tags || []).find(tag => tag.id === sourceId);
        const name = String(definition?.name || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 40) return send(res, 422, { error:'Für einen Projekt-Tag fehlt eine gültige Definition' });
        target = tags.find(tag => tag.normalizedName === normalizeTagName(name));
        if (!target) {
          target = { id:sourceId, name, normalizedName:normalizeTagName(name), active:definition.active !== false, createdAt:new Date().toISOString() };
          tags.push(target);
        }
      }
      if (!mappedTagIds.includes(target.id)) mappedTagIds.push(target.id);
    }
    restored.tagIds = mappedTagIds;
    restored.priority = validProjectPriority(project.priority) ? project.priority : 'Mittel';
    restored.flagged = validProjectFlag(project.flagged) ? project.flagged : false;
    restored.icon = /^[a-z0-9][a-z0-9-]{0,63}$/.test(project.icon || '') ? project.icon : 'box';
    restored.iconInherited = validProjectFlag(project.iconInherited) ? project.iconInherited : restored.icon === 'box';
    const existing = projects.findIndex(item => item.id === project.id);
    if (existing >= 0 && !input.replace) return send(res, 200, { id:project.id, skipped:true });
    details[project.id] = restored;
    const status = ['active','paused','completed','archived','trashed'].includes(project.status) ? project.status : 'active';
    const summary = { id:project.id, title:project.title, description:project.description || '', status, priority:restored.priority, flagged:restored.flagged, createdAt:project.createdAt || '', tagIds:mappedTagIds };
    if (existing >= 0) projects[existing] = summary; else projects.push(summary);
    for (const user of users.filter(user => user.role !== 'admin')) {
      user.projectIds = (user.projectIds || []).filter(id => id !== project.id);
      if ((input.accessUsers || []).includes(user.id)) user.projectIds.push(project.id);
    }
    refreshSummary(project.id); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'data.project_imported', target:project.id });
    return send(res, 201, { id:project.id, skipped:false });
  }
  if (url.pathname === '/api/overview' && req.method === 'GET') return send(res, 200, { projects:projects.filter(project => project.status === 'active' && canAccessProject(actor, project.id)).map(project => ({ ...project, ...(details[project.id] || {}), entries:details[project.id]?.entries || [], tasks:details[project.id]?.tasks || [] })), completedProjects:projects.filter(project => project.status === 'completed' && canAccessProject(actor, project.id)).map(project => ({ id:project.id, title:project.title, createdAt:project.createdAt, completedAt:project.completedAt || project.updatedAt || project.latestEntryDate || '' })) });
  if (url.pathname === '/api/project-browser' && req.method === 'GET') return send(res, 200, { projects:projects.filter(project => canAccessProject(actor, project.id)), tags:tags.map(tag => ({ ...tag, ...tagUsage(tag.id, actor) })), folders:[] });
  const projectViewMatch = url.pathname.match(/^\/api\/project-view\/([^/]+)$/);
  if (projectViewMatch && req.method === 'GET') {
    const project = details[projectViewMatch[1]];
    if (!project || !canAccessProject(actor, projectViewMatch[1])) return send(res, project ? 403 : 404, { error:project ? 'Kein Zugriff' : 'Projekt nicht gefunden' });
    return send(res, 200, { project, tags, folders:[] });
  }
  if (url.pathname === '/api/projects' && req.method === 'GET') return send(res, 200, { projects:projects.filter(project => canAccessProject(actor, project.id)) });
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const input = await body(req); const id = `project-${Date.now()}`;
    if (!validDate(input.createdAt)) return send(res, 422, { error:'Ein gültiges Startdatum ist erforderlich' });
    if (!validTagIds(input.tagIds || [])) return send(res, 422, { error:'Ungültige Tag-Auswahl' });
    if (!validProjectPriority(input.priority || 'Mittel')) return send(res, 422, { error:'Ungültige Projektpriorität' });
    if (!validProjectFlag(input.flagged ?? false)) return send(res, 422, { error:'Ungültige Projektmarkierung' });
    if (!validProjectFlag(input.iconInherited ?? input.icon === undefined)) return send(res, 422, { error:'Ungültige Symbolvererbung' });
    if (input.icon !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.icon)) return send(res, 422, { error:'Ungültiges Projektsymbol' });
    const project = { id, title:input.title, description:input.description, status:'active', priority:input.priority || 'Mittel', flagged:input.flagged ?? false, icon:input.icon || 'box', iconInherited:input.iconInherited ?? input.icon === undefined, createdAt:input.createdAt, tagIds:input.tagIds || [], entries:[], tasks:[], materials:[], contacts:[], links:[], ideas:[], learnings:[], notes:[] };
    projects.push(project); details[id] = project; if (actor.role !== 'admin' && actor.projectAccessMode === 'include') actor.projectIds.push(id); return send(res, 201, project);
  }
  if (url.pathname === '/api/projects/trash' && req.method === 'DELETE') {
    const trashed = projects.filter(project => project.status === 'trashed');
    for (const project of trashed) { projects.splice(projects.indexOf(project), 1); delete details[project.id]; }
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'trash.emptied', target:String(trashed.length) });
    return send(res, 200, { removed:trashed.length });
  }
  const permanentProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/permanent$/);
  if (permanentProjectMatch && req.method === 'DELETE' && details[permanentProjectMatch[1]]) {
    const project = projects.find(item => item.id === permanentProjectMatch[1]);
    if (project?.status !== 'trashed') return send(res, 409, { error:'Nur Projekte im Papierkorb können endgültig gelöscht werden' });
    projects.splice(projects.indexOf(project), 1); delete details[project.id];
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'project.deleted', target:project.id });
    res.writeHead(204); return res.end();
  }
  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === 'PATCH' && details[projectMatch[1]]) {
    const input = await body(req); if (input.createdAt !== undefined && !validDate(input.createdAt)) return send(res, 422, { error:'Ein gültiges Startdatum ist erforderlich' }); if (input.tagIds !== undefined && !validTagIds(input.tagIds)) return send(res, 422, { error:'Ungültige Tag-Auswahl' }); if (input.priority !== undefined && !validProjectPriority(input.priority)) return send(res, 422, { error:'Ungültige Projektpriorität' }); if (input.flagged !== undefined && !validProjectFlag(input.flagged)) return send(res, 422, { error:'Ungültige Projektmarkierung' }); if (input.iconInherited !== undefined && !validProjectFlag(input.iconInherited)) return send(res, 422, { error:'Ungültige Symbolvererbung' }); if (input.icon !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.icon)) return send(res, 422, { error:'Ungültiges Projektsymbol' }); if (input.status !== undefined && !['active','paused','completed','archived','trashed'].includes(input.status)) return send(res, 422, { error:'Ungültiger Projektstatus' }); const previousStatus = details[projectMatch[1]].status; Object.assign(details[projectMatch[1]], input); Object.assign(projects.find(item => item.id === projectMatch[1]), input); if (input.status === 'completed' && previousStatus !== 'completed') { const completedAt = new Date().toISOString(); details[projectMatch[1]].completedAt = completedAt; projects.find(item => item.id === projectMatch[1]).completedAt = completedAt; } if (['active','paused'].includes(input.status)) { delete details[projectMatch[1]].completedAt; delete projects.find(item => item.id === projectMatch[1]).completedAt; } if (input.status && input.status !== 'trashed') { delete details[projectMatch[1]].deletedAt; delete projects.find(item => item.id === projectMatch[1]).deletedAt; }
    return send(res, 200, details[projectMatch[1]]);
  }
  if (projectMatch && req.method === 'DELETE' && details[projectMatch[1]]) {
    const deletedAt = Math.floor(Date.now() / 1000); details[projectMatch[1]].status = 'trashed'; details[projectMatch[1]].deletedAt = deletedAt; const summary = projects.find(item => item.id === projectMatch[1]); summary.status = 'trashed'; summary.deletedAt = deletedAt; audit.push({ at:new Date().toISOString(), actor:actor.id, action:'project.trashed', target:projectMatch[1] }); return send(res, 200, details[projectMatch[1]]);
  }
  const entryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries$/);
  if (entryMatch && req.method === 'POST') {
    const input = await body(req); if (!validDate(input.date)) return send(res, 422, { error:'Ein gültiges Eintragsdatum ist erforderlich' }); const id = `entry-${Date.now()}-${randomBytes(2).toString('hex')}`; const entry = { id, author:actor.id, ...input };
    details[entryMatch[1]].entries.push(entry);
    adjustProjectStartDate(entryMatch[1], input.date);
    refreshSummary(entryMatch[1]);
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'log.created', target:`${details[entryMatch[1]].title} · ${entry.title || id}`, details:`entryId=${id}, date=${entry.date}` });
    return send(res, 201, entry);
  }
  const reorderMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(entries|tasks|materials|contacts|links|ideas|learnings|notes)\/reorder$/);
  if (reorderMatch && req.method === 'POST') {
    const input = await body(req);
    const [projectId, collection] = reorderMatch.slice(1).map(decodeURIComponent);
    const ids = input.ids;
    const items = details[projectId]?.[collection] || [];
    if (!Array.isArray(ids) || ids.length > 500 || new Set(ids).size !== ids.length) return send(res, 422, { error:'Ungültige Reihenfolge' });
    if (ids.some(id => !items.some(item => item.id === id))) return send(res, 404, { error:'Ein Eintrag der Reihenfolge wurde nicht gefunden' });
    ids.forEach((id, sortOrder) => { items.find(item => item.id === id).sortOrder = sortOrder; });
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:collection === 'entries' ? 'logs.reordered' : `${collection}.reordered`, target:projectId, details:`count=${ids.length}` });
    return send(res, 200, { ok:true });
  }
  const reopenMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries\/([^/]+)\/reopen$/);
  if (reopenMatch && req.method === 'POST') {
    const [projectId, entryId] = reopenMatch.slice(1).map(decodeURIComponent);
    const project = details[projectId];
    const entryIndex = project?.entries?.findIndex(entry => entry.id === entryId) ?? -1;
    if (entryIndex < 0) return send(res, 404, { error:'Erledigter Schritt nicht gefunden' });
    const entry = project.entries[entryIndex];
    let task = project.tasks.find(candidate => candidate.id === entry.sourceTaskId);
    if (!task) {
      const taskId = `task-entry-${sha256(entry.id).slice(0, 12)}`;
      task = project.tasks.find(candidate => candidate.id === taskId);
      if (!task) {
        task = { id:taskId, createdAt:entry.date || '', author:actor.id, title:entry.title || 'Schritt fortsetzen', description:entry.body || '', priority:'Normal' };
        project.tasks.push(task);
      }
    }
    task.status = 'Offen';
    delete task.completedAt;
    delete task.completedEntryId;
    delete task.sortOrder;
    project.entries.splice(entryIndex, 1);
    refreshSummary(projectId);
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'log.reopened', target:`${project.title} · ${entry.title || entry.id}`, details:`entryId=${entry.id}, taskId=${task.id}` });
    return send(res, 200, task);
  }
  const entryDetailMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/entries\/([^/]+)$/);
  if (entryDetailMatch && req.method === 'PATCH') {
    const input = await body(req); if (input.date !== undefined && !validDate(input.date)) return send(res, 422, { error:'Ein gültiges Eintragsdatum ist erforderlich' }); const entries = details[entryDetailMatch[1]]?.entries || []; const entry = entries.find(item => item.id === entryDetailMatch[2]);
    if (!entry) return send(res, 404, { error:'Eintrag nicht gefunden' }); Object.assign(entry, input); if (input.date) adjustProjectStartDate(entryDetailMatch[1], input.date); refreshSummary(entryDetailMatch[1]); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'log.updated', target:`${details[entryDetailMatch[1]].title} · ${entry.title || entry.id}`, details:`entryId=${entry.id}, date=${entry.date}` }); return send(res, 200, entry);
  }
  if (entryDetailMatch && req.method === 'DELETE') {
    const entries = details[entryDetailMatch[1]]?.entries || []; const index = entries.findIndex(item => item.id === entryDetailMatch[2]);
    if (index < 0) return send(res, 404, { error:'Eintrag nicht gefunden' }); const [entry] = entries.splice(index, 1); refreshSummary(entryDetailMatch[1]); audit.push({ at:new Date().toISOString(), actor:actor.id, action:'log.deleted', target:`${details[entryDetailMatch[1]].title} · ${entry.title || entry.id}`, details:`entryId=${entry.id}` }); res.writeHead(204); return res.end();
  }
  const taskCompleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/complete$/);
  if (taskCompleteMatch && req.method === 'POST') {
    const input = await body(req);
    if (!validDate(input.date)) return send(res, 422, { error:'Ein gültiges Abschlussdatum ist erforderlich' });
    const [projectId, taskId] = taskCompleteMatch.slice(1).map(decodeURIComponent);
    const project = details[projectId];
    const task = project?.tasks?.find(candidate => candidate.id === taskId);
    if (!task) return send(res, 404, { error:'Aufgabe nicht gefunden' });
    const entryId = `entry-task-${sha256(taskId).slice(0, 12)}`;
    const existing = project.entries.find(entry => entry.id === entryId);
    if (task.status === 'Erledigt' && existing) return send(res, 200, existing);
    const entry = { id:entryId, date:input.date, title:task.title || 'Aufgabe erledigt', body:task.description || '', nextStep:'', author:actor.id, sourceTaskId:task.id };
    project.entries.push(entry);
    task.status = 'Erledigt';
    task.completedAt = input.date;
    task.completedEntryId = entryId;
    adjustProjectStartDate(projectId, input.date);
    refreshSummary(projectId);
    audit.push({ at:new Date().toISOString(), actor:actor.id, action:'log.created', target:`${project.title} · ${entry.title}`, details:`entryId=${entryId}, sourceTaskId=${taskId}, date=${input.date}` });
    return send(res, 201, entry);
  }
  const collectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(tasks|materials|contacts|links|ideas|learnings|notes)$/);
  if (collectionMatch && req.method === 'POST') {
    const input = await body(req); const collection = collectionMatch[2]; const item = { id:`${collection.slice(0,-1)}-${Date.now()}-${randomBytes(2).toString('hex')}`, ...input };
    if (collection === 'tasks') { item.status ||= 'Offen'; item.priority ||= 'Normal'; }
    details[collectionMatch[1]][collection] ||= []; details[collectionMatch[1]][collection].push(item); return send(res, 201, item);
  }
  const itemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(tasks|materials|contacts|links|ideas|learnings|notes)\/([^/]+)$/);
  if (itemMatch && req.method === 'PATCH') {
    const input = await body(req); const item = details[itemMatch[1]]?.[itemMatch[2]]?.find(candidate => candidate.id === itemMatch[3]);
    if (!item) return send(res, 404, { error:'Eintrag nicht gefunden' }); Object.assign(item, input); return send(res, 200, item);
  }
  if (itemMatch && req.method === 'DELETE') {
    const items = details[itemMatch[1]]?.[itemMatch[2]] || []; const index = items.findIndex(item => item.id === itemMatch[3]);
    if (index < 0) return send(res, 404, { error:'Eintrag nicht gefunden' }); items.splice(index, 1); res.writeHead(204); return res.end();
  }
  if (projectMatch && details[projectMatch[1]]) return send(res, 200, details[projectMatch[1]]);
  try {
    const path = ['/styles.css','/app.js','/favicon.svg','/demo-data.json'].includes(url.pathname) ? url.pathname.slice(1) : 'index.html';
    const content = await readFile(join(root, path));
    send(res, 200, content, ({'.css':'text/css','.js':'application/javascript','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'}[extname(path)] || 'text/plain') + '; charset=utf-8');
  } catch { send(res, 404, 'Not found', 'text/plain'); }
}).listen(port, '127.0.0.1', () => console.log(`Make:Log preview: http://127.0.0.1:${port}`));
