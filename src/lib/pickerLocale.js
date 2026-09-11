/** Keep the device hour cycle while the app's labels remain Hebrew. */
export const uses12HourClock = new Intl.DateTimeFormat(navigator.language, { hour: 'numeric' }).resolvedOptions().hour12;
