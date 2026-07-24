/// <reference path="../pb_data/types.d.ts" />

// A vacation keeps a guard active (and able to view their roster) while
// excluding them from newly generated shifts that overlap this period.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.add(new DateField({ name: 'vacation_start' }));
    users.fields.add(new DateField({ name: 'vacation_end' }));

    // Commanders manage the roster, including vacation periods. Guards may
    // still update their own profile as before.
    users.updateRule = "id = @request.auth.id || @request.auth.role = 'commander'";
    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('vacation_start');
    users.fields.removeByName('vacation_end');
    users.updateRule = 'id = @request.auth.id';
    return app.save(users);
  },
);
