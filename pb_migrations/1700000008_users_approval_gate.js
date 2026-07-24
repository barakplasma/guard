/// <reference path="../pb_data/types.d.ts" />

// Now that the app is exposed publicly with no Cloudflare Access policy,
// require commander approval before a self-signed-up account can log in at
// all (not just be flagged inactive) - pairs with pb_hooks/users.pb.js's
// active=false default on create and its approval-only update gate.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('users');
    collection.authRule = 'active = true';
    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('users');
    collection.authRule = null;
    return app.save(collection);
  },
);
