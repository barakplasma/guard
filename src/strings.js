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
  offDuty: 'פנויים',
  unavailable: 'לא זמינים',
  nobody: '—',
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
  copyLink: 'העתק קישור',
  copied: 'הועתק!',
  copyFailed: 'ההעתקה נכשלה',
  downloadCsv: 'הורד CSV',
  copyWhatsapp: 'העתק לוואטסאפ',
  includeOffDuty: 'כלול רשימת פנויים',
  longUrlWarning: 'הקישור ארוך מאוד. חלק מהאפליקציות עלולות לקצר אותו.',

  // errors and warnings
  planError: 'לא ניתן לתכנן',
  badLink: 'הקישור פגום או ישן — נפתח סידור ריק.',
  warnUnderstaffed: (name, needed, got) => `חסרים אנשים ל"${name}": נדרשו ${needed}, שובצו ${got}.`,
  warnEmployeeUnused: (name) => `${name} לא שובץ לאף משמרת.`,
  warnMissionOutside: (name) => `"${name}" חורגת מתחום התקופה וקוצצה.`,
  warnEmployeeOutside: (name) => `הזמינות של ${name} נמצאת מחוץ לתקופה.`,
  warnPinConflict: (name) => `${name} משובץ ידנית לשתי משימות חופפות — השיבוץ השני בוטל.`,
  warnPinOverflow: (name) => `אין מספיק מקומות למשימה — השיבוץ הידני של ${name} בוטל.`,
  warnPinUnavailable: (name) => `${name} לא זמין בזמן שנבחר — השיבוץ הידני בוטל.`,
};
