function formatTime(value, lang) {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function rosterAsText(grouped, lang) {
  const lines = [lang === 'he' ? '*סידור שמירות*' : '*Guard roster*'];
  for (const day of grouped) {
    lines.push('', `*${day.label}*`);
    for (const slot of day.items) {
      lines.push(`${formatTime(slot.start, lang)}–${formatTime(slot.end, lang)}`);
      for (const entry of slot.entries) {
        lines.push(`• *${entry.positionName}*: ${entry.guardName}`);
      }
    }
  }
  return lines.join('\n');
}

export async function copyRosterText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
