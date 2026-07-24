/// <reference path="../pb_data/types.d.ts" />

// Adds two fields to the existing "positions" collection:
//   - headcount: how many guards a position needs at once (e.g. a post that
//     must be manned by 2 people). Optional; pre-existing rows read back as 0,
//     which scheduler.js treats as 1.
//   - guards: an optional set of specific assigned guards. When non-empty, that
//     position PREFERS this list (used first; falls back to the wider pool when
//     too few are free - see scheduler.js) - used mainly for time-restricted
//     posts that usually want a few specific people.
// Written as a NEW migration (not an edit of 1700000004_positions.js) so
// `migrate up` picks it up on an already-provisioned instance. Fields are added
// to an existing collection, so they must be real core.Field instances
// (new NumberField/new RelationField), not plain object literals - see CLAUDE.md.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('positions');
    const users = app.findCollectionByNameOrId('users');

    collection.fields.add(
      new NumberField({
        name: 'headcount',
        onlyInt: true,
        min: 1,
      }),
    );
    collection.fields.add(
      new RelationField({
        name: 'guards',
        collectionId: users.id,
        maxSelect: 20,
      }),
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('positions');

    collection.fields.removeByName('headcount');
    collection.fields.removeByName('guards');

    return app.save(collection);
  },
);
