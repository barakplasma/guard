/// <reference path="../pb_data/types.d.ts" />

// Extends the built-in "users" auth collection with the app-specific fields
// from DESIGN.md section 3.1. `role` and `active` have no schema-level default
// (PocketBase fields don't support one) - pb_hooks/users.pb.js fills them in
// on create and forbids self-promotion to commander.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('users');

    collection.fields.add({
      name: 'role',
      type: 'select',
      values: ['guard', 'commander'],
      maxSelect: 1,
    });

    collection.fields.add({
      name: 'active',
      type: 'bool',
    });

    // Any authenticated guard can list/view every other guard (needed for the
    // roster and swap picker); only the superuser (Admin UI) can delete a user.
    collection.listRule = "@request.auth.id != ''";
    collection.viewRule = "@request.auth.id != ''";
    collection.createRule = '';
    collection.updateRule = 'id = @request.auth.id';
    collection.deleteRule = null;

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('users');
    collection.fields.removeByName('role');
    collection.fields.removeByName('active');
    return app.save(collection);
  },
);
