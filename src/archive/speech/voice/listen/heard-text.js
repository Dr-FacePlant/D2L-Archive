// What the listening model hears comes as word pieces, all lower case with no punctuation
// ("▁what", "▁is", "▁due", "▁to", "mor", "row"). A piece that starts with ▁ starts a new word.
// This puts the pieces back into words and tidies them into a question Ask can read.
(function initVoiceHeardText(global) {
  const dash = global.D2LDashboard ||= {};

  const WORD_START = "▁";
  // Opening words of a question: the heard text has no "?", so one is added after these.
  const QUESTION_OPENERS = new Set(["what", "whats", "what's", "when", "whens", "when's", "where", "which", "who", "whom", "whose", "why", "how", "is", "are", "am", "was", "were", "do", "does", "did", "can", "could", "will", "would", "should", "shall", "may", "might", "has", "have", "had"]);

  // The listening model often hears "due" as "do". It is put right only where "do" can't be the verb: after
  // "is", "are" or a kind of work, right before a time word ("what is do this week"), or before "date".
  const DUE_AFTER = new Set(["is", "are", "was", "were", "be", "been", "it's", "what's", "whats", "that's", "work", "homework", "assignment", "assignments", "quiz", "quizzes", "exam", "exams", "test", "tests", "lab", "labs", "paper", "papers", "project", "projects", "reading", "readings", "anything", "something", "everything", "things", "stuff"]);
  const DUE_BEFORE = new Set(["today", "tonight", "tomorrow", "yesterday", "this", "next", "by", "before", "on", "in", "at", "soon", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

  function fixDue(words) {
    const lower = words.map((word) => word.toLowerCase());
    const meansDue = (i) => /^dates?$/.test(lower[i + 1] || "") || (DUE_AFTER.has(lower[i - 1]) && DUE_BEFORE.has(lower[i + 1]));
    return words.map((word, i) => (lower[i] === "do" && meansDue(i) ? "due" : word));
  }

  function heardWords(pieces) {
    let text = "";
    for (const piece of pieces || []) text += piece.startsWith(WORD_START) ? ` ${piece.slice(1)}` : piece;
    return text.replace(/\s+/g, " ").trim();
  }

  // "what is due tomorrow" → "What is due tomorrow?"  ("i" alone is "I".)
  function tidyHeardQuestion(text) {
    const said = fixDue(String(text || "").replace(/\s+/g, " ").trim().replace(/\bi\b/g, "I").split(" ")).join(" ");
    if (!said) return "";
    const first = said.split(" ")[0].toLowerCase();
    const sentence = said[0].toUpperCase() + said.slice(1);
    return QUESTION_OPENERS.has(first) && !/[.?!]$/.test(sentence) ? `${sentence}?` : sentence;
  }

  Object.assign(dash, { heardWords, tidyHeardQuestion });
})(globalThis);
