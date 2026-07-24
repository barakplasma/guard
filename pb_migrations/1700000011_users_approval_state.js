/// <reference path="../pb_data/types.d.ts" />

// `active` alone cannot distinguish a signup waiting for approval from an
// approved account that a commander deliberately disabled. Existing accounts
// are backfilled as approved; the create hook marks future public signups as
// unapproved.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new BoolField({ name: 'approved' }));
    app.save(users);

    for (const record of app.findAllRecords('users')) {
      record.set('approved', true);
      app.save(record);
    }
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('approved');
    return app.save(users);
  },
);
