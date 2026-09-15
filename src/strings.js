/** All user-facing copy. Hebrew only - the app is RTL throughout. */
export const t = {
  noMatchingEmployees: 'לא נמצאו עובדים',
  replaceEmployee: 'חיפוש עובד להחלפה',
  clearValue: 'ניקוי',
  decreaseNumber: (label) => `הקטנת ${label}`,
  increaseNumber: (label) => `הגדלת ${label}`,
  missingQualification: (mission, tag, n) => `${mission}: נדרשים ${n} בעלי הסמכת ${tag}; הכיסוי אינו מלא.`,
  // The shortfall is against the *total* night rest; the longest continuous
  // block is quoted alongside it so a split night never reads as a failure of
  // the total, and a genuinely broken night still shows its worst stretch.
  restShortfall: (person, needed, got, longest) => `${person}: מנוחת לילה כוללת ${got} דקות במקום ${needed}`
    + (longest != null && longest < needed ? ` (הרצף הארוך ביותר: ${longest} דקות)` : '')
    + '. המשימות אוישו למרות החריגה.',
  restIncomplete: (person) => `${person}: הלילה מכוסה חלקית בתקופה או בזמינות; אי אפשר לאשר מנוחה מלאה.`,
  pinExcluded: (person, mission) => `${person} שובץ ידנית ל${mission} למרות פטור לפי הסמכה.`,
  contradictoryTag: (mission, tag) => `${mission}: הסמכת ${tag} גם נדרשת וגם פטורה מהמשימה.`,
  findingWindows: (n) => `הצגת ${n} טווחי זמן`,
  qualifications: 'הסמכות',
  qualificationName: 'שם ההסמכה',
  addQualification: 'הוספת הסמכה',
  removeQualification: 'מחיקת הסמכה',
  removeQualificationBody: (name, people, missions) => `למחוק את ${name}? ההסמכה תוסר מ־${people} אנשים ומ־${missions} משימות.`,
  nightRestMinutes: 'מנוחת לילה כוללת (דקות)',
  restUnitsHelp: '6 שעות = 360 דקות · 3 שעות = 180 דקות',
  restUseHours: (hours) => `התכוונת ל־${hours} שעות? הגדרה ל־${hours * 60} דקות`,
  requiredQualifications: 'הסמכות נדרשות בכל משמרת',
  excludedQualifications: 'פטורים מהמשימה לפי הסמכה',
  combinedQualificationsHelp: 'עדיפות לאנשים שונים לכל תפקיד. כשצריך, אדם אחד יכול למלא כמה תפקידים.',
  restHelp: 'עדיפות למנוחת לילה כוללת באורך הזה — היא יכולה להתפצל. מועדף לא להעסיק בלילה מי שנדרשת לו מנוחה כשאפשר להחליף. אם אין מספיק אנשים, המשימות יאוישו ותוצג חריגת המנוחה.',
  engineProblem: 'זוהתה שגיאה בחישוב הסידור. יש לבדוק את הפרטים לפני שימוש; אפשר לשמור ולשתף את הקישור.',
  qualityNoRest: (name, n) => `${name}: ${n} מעברים בין משמרות ללא הפסקה`,
  qualitySameMission: (name, n) => `${name}: ${n} משמרות רצופות באותה משימה`,
  qualityLongRun: (name, n) => `${name}: רצף של ${n} תורנויות ללא הפסקה`,
  typeDaily: 'יומית',
  typeDailyHelp: 'אותם אנשים לכל התורנות. שעות זהות מציינות יום ולילה מלאים, עד למחרת.',
  dailyFrom: 'תחילת תורנות',
  dailyTo: 'סיום תורנות',
  dailyNextDay: 'הסיום למחרת',
  dailyIncomplete: 'יש למלא שעת התחלה ושעת סיום',
  headcountPerOccurrence: 'אנשים לתורנות',
  onCall: 'יכול לישון',
  onCallHelp: 'אפשר לישון בזמן המשימה: הזמן בה נחשב מנוחה, ולא עבודה שמפסיקה אותה.',

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
  // "ברירת מחדל" because a mission may now set its own length and ignore this.
  shiftLength: 'אורך משמרת כברירת מחדל (דקות)',
  nightStart: 'תחילת הלילה',
  nightEnd: 'סוף הלילה',
  nightWindowHelp: 'טווח שעות הלילה. משימה שהוגדר לה מספר אנשים שונה בלילה תשתמש בו בשעות האלה.',
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
  // The count is a checksum: you read it against the list you copied from to
  // see whether anyone was left out.
  employeeCount: (n) => (n === 1 ? 'איש אחד' : `${n} אנשים`),
  // Adding a name that is already on the list is refused, not silently
  // duplicated - and said out loud, so a paste that lands short is explained.
  duplicateSkippedOne: (name) => `${name} כבר ברשימה — לא נוסף שוב.`,
  duplicateSkippedMany: (names) => `${names.length} שמות כבר היו ברשימה ולא נוספו שוב: ${names.join(', ')}`,
  duplicateName: 'שם כפול',
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
  duplicateMission: 'שכפול משימה',
  // A copy keeps every setting but not the roster - two missions with the same
  // name are unreadable in the agenda, so the copy says what it is.
  missionCopyName: (name) => `${name} (עותק)`,
  missionType: 'סוג',
  typeRemote: 'מרוחקת',
  typeLocal: 'מקומית',
  typeRemoteHelp: 'אותם אנשים לכל אורך המשימה',
  typeLocalHelp: 'מתחלפים בכל משמרת',
  headcount: 'כמה אנשים',
  headcountDay: 'כמה ביום',
  headcountNight: 'כמה בלילה',
  headcountNightHelp: 'מספר האנשים בשעות הלילה. משפיע רק על משימות מקומיות.',
  shiftLengthDay: 'אורך משמרת ביום (דקות)',
  shiftLengthNight: 'אורך משמרת בלילה (דקות)',
  shiftLengthDayHelp: 'אורך משמרת במשימה הזו. השאר ריק כדי להשתמש באורך ברירת המחדל של הסידור.',
  // Says out loud that the night length is not capped by the night itself, so a
  // number longer than the night reads as a deliberate choice rather than a bug.
  shiftLengthNightHelp: 'אורך משמרת במשימה הזו בשעות הלילה. השאר ריק כדי להשתמש באורך שביום. אורך גדול מהלילה עצמו פשוט ייתן משמרת אחת שנגמרת עם עלות השחר.',
  // Unit suffix for the shift lengths printed beside a mission in the text
  // export, e.g. "(מקומית, 1, 120/60 דק׳)".
  minutesShort: 'דק׳',
  missionStart: 'התחלה',
  missionEnd: 'סיום',
  assignedPeople: 'משובצים קבועים',
  assignedHelp: 'אנשים שישובצו למשימה הזו לכל אורכה. השאר ריק לשיבוץ אוטומטי.',
  assignedPartially: 'חלקי',
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
  // Filtering the agenda to one person. The summary table deliberately stays
  // whole underneath it: the question this answers is "why does this person
  // have more time on duty than the others", and that needs the others.
  filterEmployee: 'סינון לפי אדם',
  allEmployees: 'כולם',
  filterNoShifts: (name) => `${name} לא משובץ לאף משמרת בסידור.`,

  // summary
  summary: 'סיכום',
  totalTime: 'סה״כ',
  stints: 'משמרות',
  minGap: 'הפסקה מזערית',
  spread: 'פער בין העמוס לפנוי ביותר',

  // sharing
  shareSection: 'שיתוף וייצוא',
  // The share window. Deliberately says which actions it touches: the link and
  // the CSV deliberately carry the whole plan, and a range control that looked
  // like it applied to all four would read as a bug the first time someone
  // opened a "trimmed" link and found the whole rota in it.
  shareWindow: 'טווח לשיתוף',
  shareWindowFrom: 'החל מ־',
  shareWindowHelp: 'ההודעה לוואטסאפ וקובצי היומן כוללים עד 24 שעות מהמועד הזה. ברירת המחדל היא שלוש שעות אחורה — אין צורך לשלוח את מה שכבר עבר.',
  shareWindowRange: (range) => `נשלח: ${range}`,
  shareWindowCount: (n) => (n === 0 ? 'אין משמרות בטווח הזה.'
    : n === 1 ? 'משמרת אחת בטווח.' : `${n} משמרות בטווח.`),
  copyLink: 'העתק קישור',
  copied: 'הועתק!',
  copyFailed: 'ההעתקה נכשלה',
  downloadCsv: 'הורד CSV',
  copyWhatsapp: 'העתק לוואטסאפ',
  shareLinkNative: 'שתף קישור',
  shareWhatsappNative: 'שתף הודעה',
  shareFailed: 'השיתוף נכשל',
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
  // Counted, not listed: rolling the period forward a few days leaves dozens
  // of these behind, and one alert per pin reads as a malfunction rather than
  // the harmless residue it is. The wording says "ignored", not "failed" -
  // nothing is broken, the plan simply no longer covers those hours.
  warnPinOutOfPeriod: (count) => (count === 1
    ? 'שיבוץ ידני אחד נמצא מחוץ לתקופת הסידור ולכן לא נלקח בחשבון.'
    : `${count} שיבוצים ידניים נמצאים מחוץ לתקופת הסידור ולכן לא נלקחו בחשבון.`),
  removeStalePins: 'נקה שיבוצים ישנים',

  // assignment badges: a manual assignment is a locked decision, an
  // automatically preserved elapsed one is history - the two must never read
  // as the same kind of lock.
  pinnedLocked: 'שיבוץ ידני נעול',
  frozenHistory: 'שיבוץ עבר שנשמר אוטומטית',
  releaseFrozen: 'שחרור שיבוץ עבר שנשמר',

  // corrections for a missing required qualification
  correctionProposal: (mission, driver) => `${mission}: הצעה — לשבץ את ${driver} לטווח החסר ולשחרר את שיבוצי העבר השמורים שלו:`,
  correctionRelease: (mission, substitute) => (substitute
    ? `${mission} — במקומו: ${substitute}`
    : `${mission} — יוחזר לשיבוץ אוטומטי`),
  correctionRestImpact: (before, after, needed) => `השפעה על מנוחת הלילה: ${before} דקות כוללות לפני, ${after} אחרי (נדרש ${needed}).`,
  correctionApply: 'החלת התיקון',
  correctionBlocked: (mission, driver) => `${mission}: התיקון היה לשבץ את ${driver}, אך הוא משובץ ידנית (נעול) למשימה אחרת בטווח זה. שיבוץ ידני אינו מוחלף אוטומטית.`,

  // debug section
  // The warning count rides in the toggle label: the section is collapsed by
  // default, and the only path to `removeBadPin` is inside it, so the label has
  // to advertise that there is something in there to fix.
  debugToggle: (n) => (n === 0 ? 'מידע לניפוי שגיאות' : `מידע לניפוי שגיאות — ${n} אזהרות`),
  debugVersion: 'גרסה',
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
