routerAdd('GET', '/api/guard/temp-login-link', (e) => {
  if (!e.auth || e.auth.getString('role') !== 'commander') {
    return e.json(403, { message: 'Commander access required.' });
  }
  const settings = e.app.findFirstRecordByData('app_settings', 'key', 'main');
  const code = settings.getString('temp_login_code');
  if (!/^\d{4}$/.test(code)) return e.json(404, { message: 'Not found.' });
  return e.json(200, { code });
});

routerAdd('GET', '/api/guard/temp-login/{code}', (e) => {
  const rawSubmitted = e.request.pathValue('code');
  if (!/^\d{4}$/.test(rawSubmitted)) return e.json(404, { message: 'Not found.' });

  const settings = e.app.findFirstRecordByData('app_settings', 'key', 'main');
  const rawCurrent = settings.getString('temp_login_code');
  if (!/^\d{4}$/.test(rawCurrent)) return e.json(404, { message: 'Not found.' });
  if (rawCurrent !== rawSubmitted) {
    return e.json(404, { message: 'Not found.' });
  }

  const shifts = e.app.findRecordsByFilter('shifts', '', 'start', 0, 0);
  e.app.expandRecords(shifts, ['guard', 'position'], null);

  return e.json(200, shifts.map((shift) => {
    const guard = shift.expandedOne('guard');
    const position = shift.expandedOne('position');
    return {
      id: shift.id,
      start: shift.getString('start'),
      end: shift.getString('end'),
      guard: guard ? { id: guard.id, name: guard.getString('name') } : null,
      position: position ? { id: position.id, name: position.getString('name') } : null,
    };
  }));
});

onBootstrap((e) => {
  e.app.cron().setTimezone(new Timezone('__ROTATION_TIMEZONE__'));
  e.next();
});

cronAdd('rotate_temp_login_code', '__ROTATION_CRON__', () => {
  const settings = $app.findFirstRecordByData('app_settings', 'key', 'main');
  settings.set('temp_login_code', $security.randomStringWithAlphabet(4, '0123456789'));
  settings.set('temp_login_rotated_at', new Date().toISOString());
  $app.save(settings);
});
