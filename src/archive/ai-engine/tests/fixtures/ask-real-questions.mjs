// The questions a student really asked Ask on Thu, Nov 5, 2026, with a small archive shaped
// like theirs: a quiz that opens one day and is due the next (with a calendar event for each),
// checklist tasks next to the checklist's own page and a survey, final grades and a PowerPoint.
// Each question keeps the lookups the model made then (or, where it didn't look, the one it
// should have), what those lookups must find, and what a right answer says and never says.
// tests/test-ask-real-questions.mjs runs the lookups; a real-model run scores the answers.

export const NOW = new Date(2026, 10, 5, 1, 0);
const at = (days, hour, minute = 0) => new Date(2026, 10, 5 + days, hour, minute).toISOString();
const ORIGIN = "https://d2l.example.edu";

export const COURSES = [
  { courseId: "301", code: "POLS1101", title: "American Government", label: "POLS 1101" },
  { courseId: "302", code: "HIST1111", title: "World History to 1500", label: "HIST 1111" },
  { courseId: "303", code: "ARTS1107", title: "Art Appreciation", label: "ARTS 1107" },
  { courseId: "304", code: "CRJU1101", title: "Foundations of Criminal Justice", label: "CRJU 1101" }
];

export const ENTITIES = [
  { entityId: "quiz:301:8", entityType: "quizBundle", courseId: "301", canonicalTitle: "Quiz 8", timeLimitMinutes: 15, pointsPossible: 10,
    attempts: { allowed: 1, completed: 0, source: "api" }, dates: { availableFrom: at(0, 16, 30), dueAt: at(1, 23, 59) } },
  { entityId: "calendar:301:81", entityType: "calendarEvent", courseId: "301", canonicalTitle: "Quiz 8", eventLabel: "Available", targetEntityId: "quiz:301:8",
    status: "scheduled", dates: { startAt: at(0, 16, 30), endAt: null, dueAt: at(0, 16, 30) } },
  { entityId: "calendar:301:82", entityType: "calendarEvent", courseId: "301", canonicalTitle: "Quiz 8", eventLabel: "Due", targetEntityId: "quiz:301:8",
    status: "scheduled", dates: { startAt: at(1, 23, 59), endAt: null, dueAt: at(1, 23, 59) } },
  { entityId: "resource:301:70", entityType: "learningResource", courseId: "301", canonicalTitle: "Week 11 Wrap-up", resourceType: "Topic", moduleTitle: "Week 11",
    description: "Finish the Chapter 9 reading on Congress, watch the week 11 recap video, then take Quiz 8." },
  { entityId: "calendar:301:71", entityType: "calendarEvent", courseId: "301", canonicalTitle: "Week 11 Wrap-up", eventLabel: "Due", targetEntityId: "resource:301:70",
    sourceEntityType: "D2L.LE.Content.ContentObject.TopicCO", status: "scheduled", dates: { startAt: at(0, 8), endAt: at(0, 8), dueAt: at(0, 8) } },
  { entityId: "resource:301:90", entityType: "learningResource", courseId: "301", canonicalTitle: "Quiz 8 Instructions", resourceType: "Topic", moduleTitle: "Week 11" },
  { entityId: "calendar:301:91", entityType: "calendarEvent", courseId: "301", canonicalTitle: "Quiz 8 Instructions", eventLabel: "Due", targetEntityId: "resource:301:90",
    sourceEntityType: "D2L.LE.Content.ContentObject.TopicCO", status: "scheduled", dates: { startAt: at(0, 8), endAt: at(0, 8), dueAt: at(0, 8) } },
  { entityId: "grade:301:final", entityType: "gradeRecord", courseId: "301", canonicalTitle: "Final grade", kind: "final", status: "graded",
    grade: { displayed: "", pointsEarned: 344, pointsPossible: 366 } },

  { entityId: "tool:302:checklistItem:1", entityType: "courseToolItem", toolType: "checklistItem", courseId: "302", canonicalTitle: "Review chapter notes and answer study questions",
    category: "Checklist 11", description: "Answer the five study questions at the end of chapter 11 in your notes.", dates: { dueAt: at(1, 23, 59) } },
  { entityId: "tool:302:checklistItem:2", entityType: "courseToolItem", toolType: "checklistItem", courseId: "302", canonicalTitle: "Answer question from your classmate",
    category: "Checklist 11", dates: { dueAt: at(4, 23, 59) } },
  // The checklist's own page and a survey are tool items too, but not tasks.
  { entityId: "tool:302:courseToolPage:11", entityType: "courseToolItem", toolType: "courseToolPage", courseId: "302", canonicalTitle: "Checklist 11" },
  { entityId: "tool:302:survey:3", entityType: "courseToolItem", toolType: "survey", courseId: "302", canonicalTitle: "Checklist 11 feedback survey" },
  { entityId: "discussion:302:4", entityType: "discussionThread", courseId: "302", canonicalTitle: "Inca and Spanish Views on Religion", forumTitle: "Week 11",
    prompt: "Post one question about the reading, then answer a classmate's.", dates: { availableUntil: at(4, 23, 59) } },
  { entityId: "grade:302:final", entityType: "gradeRecord", courseId: "302", canonicalTitle: "Final grade", kind: "final", status: "graded",
    grade: { displayed: "62.93 %", pointsEarned: 62.93, pointsPossible: 100, weightAchieved: { numerator: 62.93, denominator: 100 } } },

  { entityId: "discussion:303:11", entityType: "discussionThread", courseId: "303", canonicalTitle: "Module 11 Ch.10: Haacke's MetroMobilitan & Music video", forumTitle: "Module 11",
    prompt: "Watch the music video, then write your opinion of Haacke's MetroMobilitan.", dates: { availableUntil: at(3, 23) } },
  { entityId: "assignment:303:5", entityType: "assignmentBundle", courseId: "303", canonicalTitle: "Museum Report", pointsPossible: 30, gradeEntityId: "grade:303:5", dates: { dueAt: at(-11, 23, 59) } },
  { entityId: "grade:303:5", entityType: "gradeRecord", courseId: "303", canonicalTitle: "Museum Report", kind: "item", status: "graded", sourceEntityId: "assignment:303:5",
    grade: { displayed: "", pointsEarned: 30, pointsPossible: 30 }, dates: { gradedAt: new Date(2026, 9, 27, 18, 25).toISOString() } },
  { entityId: "resource:303:20", entityType: "learningResource", courseId: "303", canonicalTitle: "Instructor's Art History Folder", resourceType: "Module",
    description: "Another professor put these PowerPoint presentations together for Art History. You'll find them in this folder." },
  { entityId: "resource:303:21", entityType: "learningResource", courseId: "303", canonicalTitle: "Baroque and Rococo", resourceType: "File", moduleTitle: "Instructor's Art History Folder",
    urls: { download: `${ORIGIN}/d2l/le/content/303/topics/files/download/21/DirectFileTopicDownload` } },

  { entityId: "quiz:304:11", entityType: "quizBundle", courseId: "304", canonicalTitle: "Module 11 Quiz - An Introduction to the Courts", attempts: { allowed: 1, completed: 0, source: "api" },
    dates: { dueAt: at(3, 23, 59) } }
];

// Saved page text the archive search reads, as D2L showed it.
export const EVIDENCE = [
  { evidenceId: "ev:301:quiz8", courseId: "301", source: "quiz", title: "Quiz 8", description: "You have 15 minutes and 1 attempt." }
];

// An answer line that puts Quiz 8 at 4:30 PM, when it opens, without saying it opens then.
const QUIZ_DUE_AT_OPENING = /^(?=.*Quiz 8)(?=.*4:30)(?!.*open).*$/im;
// A lookup row that says Quiz 8 is due when it opens.
const ROW_DUE_AT_OPENING = /\{[^{}]*"title":"Quiz 8"[^{}]*"when":"due Thu, Nov 5[^"·]*4:30 PM|\{[^{}]*"when":"due Thu, Nov 5[^"·]*4:30 PM[^{}]*"title":"Quiz 8"/;
const QUIZ_DUE = /"title":"Quiz 8"[^{}]*"when":"due Fri, Nov 6, 2026, 11:59 PM/;
const GAVE_UP = /couldn't finish looking/i;

// newChat: the student started a new chat with this question. lookups: [tool, args].
// found: in what the lookups return (as JSON); wrong: what they never return. says / never:
// what a right answer says, and what it never says.
export const QUESTIONS = [
  { newChat: true, ask: "Hello, who is this?", lookups: [], says: [/LFM3-1\.7B/] },
  { ask: "What assignments do i have in the next 5 days?", lookups: [["upcoming_due", { days: 5 }]],
    found: [QUIZ_DUE, /Review chapter notes/, /Haacke/], says: [/Quiz 8/, /11:59\s*PM/], never: [QUIZ_DUE_AT_OPENING] },
  // The model answered from memory; item_details would have found what to do.
  { ask: "For the week 11 wrap-up, what am I supposed to be doing?", lookups: [["item_details", { title: "Week 11 wrap-up", course: "POLS 1101" }]],
    found: [/recap video/, /"when":"due Thu, Nov 5, 2026, 8:00 AM \(today\)"/], says: [/Chapter 9|recap video/i] },

  { newChat: true, ask: "do i have any assignments due soon?", lookups: [["upcoming_due", { days: 7 }]],
    found: [QUIZ_DUE], says: [/Quiz 8/, /11:59\s*PM/], never: [QUIZ_DUE_AT_OPENING] },
  { ask: "what info can you find on the POLS 1101 – Quiz 8. whats it about, how many questions?",
    lookups: [["search_archive", { course: "POLS 1101", query: "Quiz 8" }], ["search_archive", { query: "Quiz 8 POLS 1101" }], ["search_archive", { query: "POLS 1101 quiz 8 questions" }]],
    found: [/15 minutes/], wrong: [ROW_DUE_AT_OPENING], says: [/15 minutes/, /1 attempt|one attempt/i], never: [GAVE_UP, QUIZ_DUE_AT_OPENING] },
  { ask: "Whats on the quiz?",
    lookups: [["search_archive", { course: "POLS 1101", query: "Quiz 8" }], ["search_archive", { course: "POLS 1101", query: "POLS 1101 Quiz 8 questions" }], ["search_archive", { query: "POLS 1101 quiz 8 content" }]],
    found: [/15 minutes/], wrong: [ROW_DUE_AT_OPENING], says: [/15 minutes|1 attempt|one attempt/i], never: [GAVE_UP, QUIZ_DUE_AT_OPENING, /^(?=.*Quiz 8)(?=.*\bdue\b)(?=.*8:00 AM).*$/im] },

  { newChat: true, ask: "What should i focus on?", lookups: [["upcoming_due", { days: 7 }]],
    found: [QUIZ_DUE], says: [/Quiz 8/], never: [QUIZ_DUE_AT_OPENING, /Quiz 8 Instructions/] },

  { newChat: true, ask: "Yo, how are you? What's going on, bro?", lookups: [], never: [GAVE_UP] },
  { ask: "What do you have upcoming?", lookups: [["upcoming_due", { days: 7 }]], found: [QUIZ_DUE], says: [/Quiz 8/], never: [QUIZ_DUE_AT_OPENING] },
  { ask: "Okay, so are you able to read any documents?", lookups: [], says: [/PDF|Word/i] },
  { ask: "Open up a PowerPoint and see what's in it.", lookups: [["search_archive", { query: "PowerPoint" }]], found: [/Art History Folder/], says: [/PowerPoint/i], never: [GAVE_UP] },

  { newChat: true, ask: "What are my grades so far?",
    lookups: [["search_archive", { query: "grade" }], ["item_details", { course: "POLS 1101", title: "Final grade" }], ["item_details", { course: "HIST 1111", title: "Final grade" }],
      ["item_details", { course: "ARTS 1107", title: "Final grade" }], ["item_details", { course: "CRJU 1101", title: "Final grade" }]],
    found: [/344 \/ 366/, /62\.93/, /30 \/ 30/], says: [/344\s*\/\s*366|94\.0?\d*\s*%/, /62\.93/], never: [/still early|room (for|to) improve/i] },
  { ask: "What assignments do I have coming up?", lookups: [["upcoming_due", { days: 7 }]], found: [QUIZ_DUE], says: [/Quiz 8/], never: [QUIZ_DUE_AT_OPENING] },
  // The second lookup is the one that crashed the answer: the model's notes planned it, and it threw before it was saved.
  { ask: "tomorrow evening at what time?", lookups: [["item_details", { course: "POLS 1101", title: "Quiz 8" }], ["item_details", { course: "HIST 1111", title: "Checklist 11" }]],
    found: [QUIZ_DUE, /"checklist":"Checklist 11"/], says: [/11:59\s*PM/], never: [QUIZ_DUE_AT_OPENING] }
];
