import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { getNote, listNotes, saveNote } from "./notes.server";
import { MAX_NOTE_LENGTH } from "./notes";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);
const LATER = new Date(2026, 9, 7, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonIds = [1, 2].map(
    (position) =>
      db
        .insert(schema.lessons)
        .values({ moduleId: module.id, title: `Lesson ${position}`, position })
        .returning()
        .get().id
  );
});

describe("saving a Note", () => {
  it("creates a Note with the body trimmed", () => {
    const result = saveNote(db, base.user.id, lessonIds[0], "  # not a heading  ", NOW);

    expect(result.ok).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "# not a heading",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces the body and moves the last-edited time on when saved again", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thoughts", NOW);
    saveNote(db, base.user.id, lessonIds[0], "Second thoughts", LATER);

    expect(getNote(db, base.user.id, lessonIds[0])).toMatchObject({
      body: "Second thoughts",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect(listNotes(db, base.user.id)).toHaveLength(1);
  });

  it("accepts a Note of exactly 2,000 characters", () => {
    const body = "a".repeat(MAX_NOTE_LENGTH);

    expect(saveNote(db, base.user.id, lessonIds[0], body, NOW).ok).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])?.body).toBe(body);
  });

  it("refuses a Note over 2,000 characters rather than truncating it", () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonIds[0],
      "a".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result).toEqual({
      ok: false,
      error: "A note must be 2,000 characters or fewer.",
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });

  it("deletes the Note when saved empty", () => {
    saveNote(db, base.user.id, lessonIds[0], "First thoughts", NOW);

    expect(saveNote(db, base.user.id, lessonIds[0], "   ", LATER)).toEqual({
      ok: true,
      note: null,
    });
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
    expect(listNotes(db, base.user.id)).toEqual([]);
  });

  it("saving an empty box with no Note is a no-op", () => {
    expect(saveNote(db, base.user.id, lessonIds[0], "", NOW).ok).toBe(true);
    expect(getNote(db, base.user.id, lessonIds[0])).toBeUndefined();
  });
});

describe("listing Notes", () => {
  it("lists only the Student's own Notes, last edited first, with Lesson and Course", () => {
    const other = db
      .insert(schema.users)
      .values({ name: "Other", email: "other@example.com", role: UserRole.Student })
      .returning()
      .get();

    saveNote(db, base.user.id, lessonIds[0], "On lesson one", NOW);
    saveNote(db, base.user.id, lessonIds[1], "On lesson two", NOW);
    saveNote(db, base.user.id, lessonIds[0], "On lesson one, edited", LATER);
    saveNote(db, other.id, lessonIds[0], "Someone else's", LATER);

    expect(listNotes(db, base.user.id)).toMatchObject([
      {
        body: "On lesson one, edited",
        lessonId: lessonIds[0],
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
      { body: "On lesson two", lessonId: lessonIds[1] },
    ]);
  });
});
