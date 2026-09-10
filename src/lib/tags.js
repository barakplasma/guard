/** Delete a qualification and all references in one document update. */
export function removeTag(doc, id) {
  return { ...doc, tags: doc.tags.filter((t) => t.id !== id),
    employees: doc.employees.map((e) => ({ ...e, tags: (e.tags ?? []).filter((t) => t !== id) })),
    missions: doc.missions.map((m) => ({ ...m,
      requires: (m.requires ?? []).filter((r) => r.tag !== id),
      excludes: (m.excludes ?? []).filter((t) => t !== id),
    })),
  };
}
