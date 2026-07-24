/// <reference path="../pb_data/types.d.ts" />

// Superuser-only singleton settings edited through PocketBase Admin. No API
// rules are defined, so ordinary users and guests cannot read or mutate the
// temp-login code through the records API.
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'app_settings',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'key', type: 'text', required: true, max: 50 },
        { name: 'temp_login_code', type: 'text', required: true, min: 4, max: 4, pattern: '^\\d{4}$' },
        { name: 'temp_login_rotated_at', type: 'date', required: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (`key`)'],
    });
    app.save(collection);

    const settings = new Record(collection);
    settings.set('key', 'main');
    settings.set('temp_login_code', $security.randomStringWithAlphabet(4, '0123456789'));
    settings.set('temp_login_rotated_at', new Date().toISOString());
    return app.save(settings);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('app_settings');
    return app.delete(collection);
  },
);
