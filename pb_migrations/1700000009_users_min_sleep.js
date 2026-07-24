/// <reference path="../pb_data/types.d.ts" />

// Adds `min_sleep_hours` to users - the minimum contiguous night sleep a person
// needs (e.g. drivers = 6). 0/unset means "no minimum". Surfaced by the Sleep
// report on the Stats page (see scheduler/sleep.js), which flags anyone the
// roster can't give that much uninterrupted sleep.
//
// Setting another person's minimum is a commander task, but the original users
// updateRule was self-only (`id = @request.auth.id`), so this also widens it to
// let commanders edit user records. The widening is locked down in
// pb_hooks/users.pb.js: `role`/`active` are superuser-only, and when a commander
// edits SOMEONE ELSE's record the only field allowed to change is
// `min_sleep_hours` (so the rule can't be used to self-promote or to reset
// another user's password/email). New migration (not an edit of
// 1700000000_users.js) so `migrate up` applies it on a provisioned instance.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('users');

    collection.fields.add(
      new NumberField({
        name: 'min_sleep_hours',
        min: 0,
      }),
    );

    collection.updateRule = "id = @request.auth.id || @request.auth.role = 'commander'";

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('users');

    collection.fields.removeByName('min_sleep_hours');
    collection.updateRule = 'id = @request.auth.id';

    return app.save(collection);
  },
);
