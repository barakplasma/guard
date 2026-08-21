/** All user-facing copy. Hebrew only - the app is RTL throughout. */
export const t = {
  appTitle: 'מתכנן משמרות',

  // navigation
  navEmployees: 'עובדים',
  navMissions: 'משימות',
  navSchedule: 'סידור',

  // settings bar
  planTitle: 'שם הסידור',
  planTitlePlaceholder: 'לדוגמה: סוף שבוע',
  planStart: 'תחילת התקופה',
  planEnd: 'סוף התקופה',
  shiftLength: 'אורך משמרת (דקות)',
  strategy: 'שיטת חלוקה',
  strategyBalanced: 'איזון שעות',
  strategyRotation: 'סבב קבוע',
  // The two help lines say what each method optimizes for, because the summary
  // table reads differently under each: under a fixed rotation the "פער" figure
  // is expected to be large - hours are deliberately not evened out - and the
  // number of turns is the column that matters.
  strategyBalancedHelp: 'מי שצבר הכי מעט שעות נכנס הבא. השעות מתחלקות שווה בשווה.',
  strategyRotationHelp: 'סבב מעגלי קבוע לפי סדר רשימת האנשים. כל תורנות שווה בתור, בין אם היא שעה או יום שלם, ולכן הפער בשעות עשוי להיות גדול.',
  strategyName: (id) => (id === 'rotation' ? t.strategyRotation : t.strategyBalanced),
  startOptions: 'התחלה מהירה',
  startNow: 'עכשיו',
  startNextHour: 'השעה הבאה',

  // employees
  employees: 'עובדים',
  employeeName: 'שם',
  addEmployee: 'הוסף עובד',
  addManyLabel: 'הדבקת רשימת שמות (שם בכל שורה)',
  addMany: 'הוסף רשימה',
  wholePeriod: 'כל התקופה',
  limitAvailability: 'הגבל זמינות',
  availableFrom: 'זמין מ־',
  availableUntil: 'זמין עד',
  noEmployees: 'עדיין לא הוגדרו עובדים.',
  emptyEmployeesHint: 'התחילו בהדבקת רשימת שמות למטה, שם בכל שורה.',
  remove: 'הסר',
  cancel: 'ביטול',
  confirmRemoveEmployeeTitle: 'הסרת עובד?',
  confirmRemoveEmployeeBody: (name, pinCount) => (pinCount > 0
    ? `להסיר את ${name}? ${pinCount} שיבוצים ידניים שלו יבוטלו.`
    : `להסיר את ${name}?`),

  // missions
  missions: 'משימות',
  missionName: 'שם המשימה',
  addMission: 'הוסף משימה',
  missionType: 'סוג',
  typeRemote: 'מרוחקת',
  typeLocal: 'מקומית',
  typeRemoteHelp: 'אותם אנשים לכל אורך המשימה',
  typeLocalHelp: 'מתחלפים בכל משמרת',
  headcount: 'כמה אנשים',
  missionStart: 'התחלה',
  missionEnd: 'סיום',
  assignedPeople: 'משובצים קבועים',
  assignedHelp: 'אנשים שישובצו למשימה הזו לכל אורכה. השאר ריק לשיבוץ אוטומטי.',
  missionReturnedNow: 'חזרו עכשיו',
  missionReturnedNowHelp: 'מעדכן את שעת הסיום לשעה העגולה הקרובה, ומשחרר את האנשים לשיבוץ במשימות אחרות מאותה שעה.',
  // A mission with no chosen end. Deliberately not "ללא זמן סיום": the mission
  // really does end at the plan's end - there is no unbounded schedule here -
  // and this must read distinctly from `wholePeriod`, which means *both* the
  // start and the end are inherited.
  missionNoEnd: 'עד סוף התקופה',
  missionNoEndHelp: 'המשימה נמשכת עד סוף התקופה, וזזה איתה אם התקופה תוארך.',
  noMissions: 'עדיין לא הוגדרו משימות.',
  emptyMissionsHint: 'לחצו על "הוסף משימה" כדי להתחיל.',
  confirmRemoveMissionTitle: 'הסרת משימה?',
  confirmRemoveMissionBody: (name, pinCount) => (pinCount > 0
    ? `להסיר את "${name}"? ${pinCount} שיבוצים ידניים בה יבוטלו.`
    : `להסיר את "${name}"?`),

  // schedule
  schedule: 'סידור',
  shiftTime: 'שעות',
  planNow: 'תכנן',
  replan: 'תכנן מחדש',
  onDuty: 'במשמרת',
  unavailable: 'לא זמינים',
  pinned: 'שיבוץ ידני',
  clearPin: 'בטל שיבוץ ידני',
  clearAllPins: 'נקה שיבוצים ידניים',
  confirmClearPinsTitle: 'ניקוי כל השיבוצים הידניים?',
  confirmClearPinsBody: 'כל השיבוצים הידניים בסידור יבוטלו. לא ניתן לבטל פעולה זו.',
  emptySchedule: 'אין משמרות. הוסיפו עובדים ומשימות ולחצו על "תכנן".',
  needEmployees: 'צריך לפחות עובד אחד כדי לתכנן.',
  needMissions: 'צריך לפחות משימה אחת כדי לתכנן.',
  now: 'כעת',
  today: 'היום',
  jumpToNow: 'קפוץ לעכשיו',

  // summary
  summary: 'סיכום',
  totalTime: 'סה״כ',
  stints: 'משמרות',
  minGap: 'הפסקה מזערית',
  spread: 'פער בין העמוס לפנוי ביותר',

  // sharing
  shareSection: 'שיתוף וייצוא',
  copyLink: 'העתק קישור',
  copied: 'הועתק!',
  copyFailed: 'ההעתקה נכשלה',
  downloadCsv: 'הורד CSV',
  copyWhatsapp: 'העתק לוואטסאפ',
  longUrlWarning: 'הקישור ארוך מאוד. חלק מהאפליקציות עלולות לקצר אותו.',
  calendarSection: 'ייצוא ליומן (iCal)',
  downloadIcsOverview: 'יומן כלל הצוות',
  downloadIcsEmployee: 'יומן אישי',
  icsEmployeeSelect: 'עובד ליומן אישי',

  // errors and warnings
  planError: 'לא ניתן לתכנן',
  badLink: 'הקישור פגום או ישן — נפתח סידור ריק.',
  warnUnderstaffed: (name, needed, got) => `חסרים אנשים ל"${name}": נדרשו ${needed}, שובצו ${got}.`,
  warnEmployeeUnused: (name) => `${name} לא שובץ לאף משמרת.`,
  warnMissionOutside: (name) => `"${name}" חורגת מתחום התקופה וקוצצה.`,
  warnEmployeeOutside: (name) => `הזמינות של ${name} נמצאת מחוץ לתקופה.`,
  warnPinConflict: (name) => `${name} משובץ ידנית לשתי משימות חופפות — השיבוץ הישן בוטל.`,
  warnPinOverflow: (name) => `אין מספיק מקומות למשימה — השיבוץ הידני של ${name} בוטל.`,
  // A manual assignment now outranks a stale availability window instead of
  // being cancelled by one, so this is informational: the shift stands, and the
  // availability is the thing that looks wrong. No repair button is offered -
  // the only "repair" would be deleting the assignment the planner insisted on.
  warnPinAvailabilityOverridden: (name) => `${name} מסומן כלא זמין בזמן הזה — השיבוץ הידני נשמר בכל זאת.`,
  // The one case a manual assignment genuinely cannot be honoured: it falls
  // outside the mission's own window, so there is no shift to give anyone.
  warnPinUnavailable: (name) => `השיבוץ הידני של ${name} נמצא מחוץ לחלון המשימה ולא ניתן ליישום.`,
  removeBadPin: 'הסר שיבוץ זה',

  // debug section
  // The warning count rides in the toggle label: the section is collapsed by
  // default, and the only path to `removeBadPin` is inside it, so the label has
  // to advertise that there is something in there to fix.
  debugToggle: (n) => (n === 0 ? 'מידע לניפוי שגיאות' : `מידע לניפוי שגיאות — ${n} אזהרות`),
  warningsTitle: 'אזהרות',
  noWarnings: 'אין אזהרות.',
  copyPlanData: 'העתק טקסט',
  planDataTitle: 'תוכן הסידור (מהקישור)',
  scheduleTextTitle: 'הסידור המחושב',
  pinsSection: 'שיבוצים ידניים',
  noPins: 'אין שיבוצים ידניים.',
  wholeMission: 'כל המשימה',
  frozenPinNote: 'הוקפא אוטומטית מהעבר',
};
